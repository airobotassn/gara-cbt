// 1:1 문의 '새 답변' 빨간 점의 **단일 출처**(2026-08-12).
//
// 화면 세 군데가 같은 숫자를 봐야 한다: FAB(로그인한 모든 화면) · FAB 패널의 마이페이지 버튼 ·
// 마이페이지 '1:1 문의' 탭. 각자 세면 점이 서로 다른 말을 한다(FAB 엔 떠 있는데 탭엔 없음).
//
// 세는 방법은 질의 한 줄이다 — RLS(inquiries_own_read)가 본인 행만 보여주므로 user_id 조건을 걸지 않는다.
// 읽음 처리만 RPC 를 쓴다(사용자에게 UPDATE 를 열면 자기 문의의 answer·status 까지 쓸 수 있다 —
// 마이그레이션 20260812090000 주석 참고).
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

let count = 0
let lastAt = 0
let inflight: Promise<void> | null = null
const subs = new Set<() => void>()

function set(n: number) {
  if (n === count) return
  count = n
  for (const f of subs) f()
}

function subscribe(f: () => void) {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}
const snapshot = () => count

/** 미확인(답변이 왔는데 아직 안 펼쳐본) 문의 수. 0 이면 점을 그리지 않는다. */
export function useInquiryAlert(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * 서버에서 다시 센다.
 * ⚠️ 기본은 30초 스로틀 — 창 포커스마다 부르는데 탭을 오가면 그때마다 질의가 나간다.
 *    로그인 직후·읽음 처리 직후처럼 **즉시 맞아야 하는 자리**에서만 force 로 부른다.
 */
export async function refreshInquiryAlert(force = false): Promise<void> {
  if (inflight) return inflight
  if (!force && Date.now() - lastAt < 30_000) return
  inflight = (async () => {
    const { count: n, error } = await supabase
      .from('inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'answered')
      .is('answer_seen_at', null)
    // 실패(비로그인·네트워크)는 0 으로 접는다. 점은 있으면 좋은 것이지, 못 셌다고 화면에
    // 오류를 띄우거나 옛 숫자를 붙들고 있을 물건이 아니다.
    set(error ? 0 : (n ?? 0))
    lastAt = Date.now()
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** 로그아웃·익명 전환 시. 다음 사람 화면에 앞사람 점이 남지 않게 스로틀 시각도 같이 지운다. */
export function clearInquiryAlert() {
  lastAt = 0
  set(0)
}

/** 그 문의를 펼쳐본 순간 = 읽음. 성공하면 개수를 즉시 다시 센다(점이 그 자리에서 꺼져야 한다). */
export async function markInquirySeen(id: string): Promise<void> {
  const { error } = await supabase.rpc('inquiry_mark_seen', { p_id: id })
  if (!error) await refreshInquiryAlert(true)
}
