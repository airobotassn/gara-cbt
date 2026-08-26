// 마지막에 본 '내 모습'을 브라우저에 적어 둔다 — 첫 그림이 기본값으로 튀는 걸 막으려고.
//
// 왜 필요한가 (2026-08-26)
//   화면은 서버 응답을 기다려주지 않는다. 그래서 응답이 오기 전 한 박자 동안 **초기값**이 그려지고,
//   응답이 도착하면 그 위에 덮인다. 값이 비어 있으면(빈 목록 등) 티가 안 나지만, 초기값이
//   '그럴듯한 다른 것'이면 틀린 화면이 먼저 보였다가 바뀐다:
//     · /hub  — 기본 배경(초원) + 기본 UI + 폴백 캐릭터 + Lv.1 이 떴다가 내 것으로 덮임
//               (게다가 그때부터 진짜 배경 PNG 를 받기 시작해서 더 오래 버틴다)
//     · 떠 있는 FAB — 색 젬이 떴다가 내가 올린 사진으로 바뀜
//     · 허브 HUD 이름 — 'CARI' 가 떴다가 내 닉네임으로 바뀜
//   마지막에 본 값으로 먼저 그리면 거의 항상 맞으므로 그 깜빡임이 사라진다.
//
// ⛔ **판정에 쓰면 안 된다. 화면에 미리 그리는 용도뿐이다.**
//    (캐릭터 선택·튜토리얼 완료·닉네임 확정 같은 게이트를 localStorage 로 판정하면 브라우저를
//     바꾸거나 지운 순간 이미 끝낸 사람에게 첫 화면이 다시 강제된다 — 그건 서버가 답할 문제다.)
//    여기 값은 서버 응답이 오면 **무조건 덮인다.** 없거나 틀려도 그때 고쳐진다.
// ⚠️ **uid 로 묶는다.** 한 브라우저에서 계정을 바꿔 쓰면 앞사람 모습이 먼저 뜬다.
//    아직 uid 를 모르는 시점(인증 하이드레이트 전)에는 그냥 쓴다 — 틀려도 응답이 고쳐주고,
//    지금(언제나 기본값으로 시작)보다 나빠질 수는 없다.
// ⚠️ **부분 갱신이다.** 쓰는 자리가 둘(허브 응답 · 프로필 조회)이라 통째로 덮으면 서로 지운다.

const KEY = 'gara_last_look'

export interface LastLook {
  uid: string
  /** 장착한 스킨의 part_key (`/hub` 배경·UI 한 벌) */
  skin?: string
  /** 장착한 캐릭터 키. 아직 안 골랐으면 null */
  char?: string | null
  /** 시즌 총점 — 캐릭터 레벨(ARENA 레벨)이 여기서 파생된다 */
  score?: number
  /** `profiles.avatar_url` 원문(`gem:`·`img:`·`mascot:` 접두사 그대로) */
  avatar?: string | null
  /** `profiles.display_name` — 허브 HUD 이름과 FAB 이름 */
  name?: string | null
}

function read(): LastLook | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<LastLook>
    return typeof v?.uid === 'string' ? (v as LastLook) : null
  } catch {
    return null
  }
}

/** 적어 둔 모습. uid 를 알고 있는데 주인이 다르면 안 준다. */
export function lastLook(uid: string | null | undefined): LastLook | null {
  const v = read()
  if (!v) return null
  return uid && v.uid !== uid ? null : v
}

/** 아는 것만 골라 덮어쓴다. 주인이 바뀌었으면 통째로 새로 시작한다. */
export function saveLook(uid: string | null | undefined, patch: Omit<Partial<LastLook>, 'uid'>): void {
  if (!uid) return
  try {
    const cur = read()
    const base: LastLook = cur && cur.uid === uid ? cur : { uid }
    localStorage.setItem(KEY, JSON.stringify({ ...base, ...patch, uid }))
  } catch {
    /* 사파리 프라이빗 등에서 막힐 수 있다. 못 적어도 화면은 예전처럼 동작한다. */
  }
}
