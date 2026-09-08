// 관리자 금칙어 — `banned_words` 표를 채팅 검사에 실제로 물린다(2026-09-07 지시).
//
// ⛔ **여태는 아무 효과도 없었다.** 서버에 목록·저장 기능(`bannedWordList`/`bannedWordSave`)이
//    만들어져 있었는데 **그걸 부르는 화면이 0곳**이라 넣을 방법조차 없었고, 설령 넣어도
//    `chat-post` 는 코드에 박힌 목록(`badwords_ko.ts` 의 KO_BADWORDS)만 봤다.
//    이제 관리자 화면(WORLD ARENA › 채팅 관리 › 금칙어)과 이 로더가 그 자리를 잇는다.
//
// ⚠️ **코드 목록을 대체하지 않고 합친다.** KO_BADWORDS 는 경계 앵커링·allowlist 예외까지
//    다듬어 둔 기본 방어선이다. 관리자 목록은 거기에 얹는 것이지 갈아치우는 게 아니다 —
//    표가 비었다고 욕설 차단이 풀리면 안 된다.
//
// ⚠️ **조회를 캐시한다.** 글 하나 쓸 때마다 DB 를 한 번 더 왕복하면 채팅 쓰기가 그만큼 느려진다.
//    금칙어는 자주 바뀌는 값이 아니라 60초면 충분하다 — 관리자가 추가하면 **최대 1분 뒤**부터 걸린다
//    (그 지연은 화면에 적어 둔다. 안 적으면 "추가했는데 안 걸린다" 로 읽힌다).
//    ⛔ 캐시를 없애지 말 것: 도배 시도는 초당 여러 건이 들어오는 경로다.
//    ⚠️ 엣지 함수는 인스턴스가 여럿이라 각자 캐시를 든다 — 1분은 인스턴스별이다.
//
// ⚠️ **조회 실패는 빈 목록이다(차단을 늘리지도 줄이지도 않는다).** 코드 목록은 그대로 도므로
//    "DB 가 안 되면 욕설이 통과" 가 아니다. 반대로 실패를 이유로 전부 차단하면 채팅이 죽는다.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const TTL_MS = 60_000

let cache: string[] = []
let cachedAt = 0

/** 관리자가 등록한 활성 금칙어. 60초 캐시. 실패하면 마지막 값(없으면 빈 배열)을 그대로 쓴다. */
export async function loadBannedWords(admin: SupabaseClient): Promise<string[]> {
  const now = Date.now()
  if (now - cachedAt < TTL_MS) return cache
  const { data, error } = await admin.from('banned_words').select('word').eq('active', true)
  if (error || !data) {
    // 실패해도 캐시 시각을 갱신한다 — 안 하면 DB 가 아픈 동안 요청마다 재시도해 더 느려진다.
    cachedAt = now
    return cache
  }
  cache = (data as { word: string }[]).map((r) => String(r.word ?? '').trim()).filter(Boolean)
  cachedAt = now
  return cache
}

/** 관리자가 목록을 고친 직후 캐시를 버린다 — 저장하고 바로 확인해 보는 게 자연스럽다. */
export function invalidateBannedWords(): void {
  cachedAt = 0
}
