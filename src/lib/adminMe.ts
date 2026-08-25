// "내가 관리자인가" 한 번만 물어보고 나눠 쓴다.
//
// 예전엔 세 화면이 서로 모르고 각자 `admin { action:'me' }` 를 불렀다
// (Layout 의 FAB · /admin 진입 게이트 · /test/select 의 전 레벨 해금).
// 한 세션에 같은 질문이 최대 3회 나갔고, **일반 회원은 그 셋이 전부 403 으로 떨어지는 왕복**이었다.
//
// ⚠️ 캐시 키는 uid 다. 계정을 바꾸면 다시 물어본다 — 안 그러면 관리자로 로그아웃한 브라우저에서
//    다음 사람이 관리자 메뉴를 본다(권한 자체는 서버가 막지만, 화면에 링크가 뜨는 것만으로도 틀렸다).
// ⚠️ 실패(403·네트워크)도 결과로 캐시한다. 일반 회원이 화면을 옮길 때마다 403 을 다시 받을 이유가 없다.
//    관리자 권한을 방금 부여받은 사람은 새로고침해야 보인다 — 하루 몇 번 있는 일이라 그 편이 낫다.
import { callFunction } from './supabase'

export interface AdminMe {
  isAdmin: boolean
  /** 루트 관리자(최상위). 루트 전용 메뉴 노출 판정에 쓴다. */
  isRoot: boolean
}

const NOBODY: AdminMe = { isAdmin: false, isRoot: false }

let cache: AdminMe | null = null
let inflight: Promise<AdminMe> | null = null
let cachedUid: string | null = null

/**
 * uid 가 null(비로그인·익명)이면 서버에 묻지 않고 바로 '아님'을 준다.
 * 같은 uid 로 동시에 여러 화면이 불러도 요청은 한 번만 나간다.
 */
export async function loadAdminMe(uid: string | null): Promise<AdminMe> {
  if (!uid) return NOBODY
  if (cachedUid !== uid) {
    // 계정이 바뀌었다 — 앞 사람 답을 버린다.
    cache = null
    inflight = null
    cachedUid = uid
  }
  if (cache) return cache
  if (inflight) return inflight
  inflight = (async () => {
    let me: AdminMe
    try {
      const r = await callFunction<{ ok: boolean; isRoot?: boolean }>('admin', { action: 'me' })
      me = { isAdmin: !!r.ok, isRoot: !!r.isRoot }
    } catch {
      me = NOBODY // 403(관리자 아님) 또는 네트워크 실패 — 둘 다 '아님'으로 다룬다.
    }
    cache = me
    inflight = null
    return me
  })()
  return inflight
}
