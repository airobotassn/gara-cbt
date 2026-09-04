// 문항 변경 이력 — 세 제도(CARIS 자격검정 · 레벨테스트 · 미니게임 용어)가 **한 표**를 쓴다.
// 옛 표 3개(cbt_question_events · question_events · term_question_events)를 합친 것이 `question_history` 다.
//
// ⛔ **읽고 쓰는 자리는 이 파일 하나여야 한다 — `question_history` 를 직접 from() 하지 말 것.**
//    합치기 전 세 표는 서로 남남이라 필터를 빠뜨려도 남의 문항이 섞일 수가 없었다. 지금은 한 표라
//    `kind` 를 한 번 빠뜨리는 순간 **CARIS 이력 탭에 레벨테스트 문항이 뜬다** — 에러도 안 나고
//    화면도 멀쩡해 보여서(그냥 모르는 번호가 늘어날 뿐) 아무도 못 알아챈다.
//    그래서 아래 두 함수는 `kind` 를 **첫 번째 필수 인자**로 받는다. 빠뜨리면 타입에서 걸린다.
//    (2026-09-03 term 마이그레이션 머리에 "같은 표에 세 제도를 섞으면 이력 탭이 남의 문항을 보여준다"
//     라고 적어 표를 나눴던 그 위험이다. 표를 합친 지금은 이 게이트가 그 자리를 대신한다.)

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

/** 어느 제도의 문항인가. `translate-questions` 의 지갑 구분(`caris`/`leveltest`)과 같은 낱말을 쓴다. */
export type QuestionKind = 'caris' | 'leveltest' | 'term'

/** 한 줄 적재할 내용. `label`·`scope` 는 제도마다 담는 것이 다르다(아래 표). */
export interface QuestionEventInput {
  question_id: string | null
  /**
   * 사람이 읽는 문항 이름표 — 관리자가 이걸로 검색한다.
   *   caris `120` · leveltest `L3-045` · term `T-001`
   * ⚠️ 옛 CARIS `number` 는 int 였다. 합치면서 text 로 접었으므로 숫자를 넘겨도 문자열로 저장된다.
   */
  label: string | number | null
  /**
   * 어느 묶음 소속인가 — 옛 `bank_id`·`level` 자리.
   *   caris = 문제은행 uuid · leveltest = 레벨 숫자(1~7) · term = 없음(null)
   */
  scope?: string | number | null
  action: string
  actor: string | null
  detail?: unknown
}

/** null·빈 문자열은 전부 null 로 접는다 — 옛 표들이 셋 다 nullable 이었다. */
function textOrNull(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/**
 * 이력 한 줄 적재. **실패해도 본 작업은 막지 않는다** — 옛 세 표의 로거가 모두 그랬다.
 * (문항을 고쳤는데 로그 적재가 실패했다고 수정 자체를 되돌리면 관리자가 이유를 못 찾는다.)
 */
export async function logQuestionEvent(
  admin: SupabaseClient,
  kind: QuestionKind,
  e: QuestionEventInput,
): Promise<void> {
  try {
    await admin.from('question_history').insert({
      kind,
      question_id: e.question_id,
      label: textOrNull(e.label),
      scope: textOrNull(e.scope),
      action: e.action,
      actor: e.actor || null,
      detail: e.detail ?? null,
    })
  } catch { /* 로그 실패는 무시 */ }
}

/** 돌려주는 한 줄. 세 화면이 그대로 쓴다(`label`·`scope` 가 옛 `number`/`code`·`bank_id`/`level` 자리다). */
export interface QuestionHistoryRow {
  id: string
  question_id: string | null
  label: string | null
  scope: string | null
  action: string
  actor: string | null
  detail: unknown
  created_at: string
}

export interface HistoryQuery {
  /** 소속 필터 — CARIS 이력 탭이 문제은행으로 거른다. */
  scope?: string | null
  /** 작업 종류 필터(edit·delete…). 레벨테스트 이력 탭의 `filter`. */
  action?: string | null
  /** 문항 번호 정확일치 — 용어 이력 탭이 쓴다. */
  label?: string | null
  limit?: number
}

/**
 * 그 제도의 이력만 최신순으로. 돌려주는 모양은 세 화면이 그대로 쓴다
 * (`label`·`scope` 가 옛 `number`/`code`·`bank_id`/`level` 자리다).
 */
export async function readQuestionHistory(
  admin: SupabaseClient,
  kind: QuestionKind,
  opts: HistoryQuery = {},
): Promise<{ rows: QuestionHistoryRow[]; error: string | null }> {
  // ⚠️ 필터(.eq)를 **먼저** 걸고 .order/.limit 은 마지막에 붙인다 — .order 가 돌려주는 빌더는
  //    타입이 달라서(Transform) 그 뒤에 조건부로 .eq 를 재대입하면 타입이 어긋난다.
  let q = admin
    .from('question_history')
    .select('id, question_id, label, scope, action, actor, detail, created_at')
    .eq('kind', kind)
  if (opts.scope) q = q.eq('scope', String(opts.scope))
  if (opts.action && opts.action !== 'all') q = q.eq('action', opts.action)
  if (opts.label) q = q.eq('label', String(opts.label))
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 1000)
  return { rows: (data ?? []) as QuestionHistoryRow[], error: error ? error.message : null }
}
