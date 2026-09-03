// term-pool: 미니게임 용어 퀴즈 3종(버텨라·쏴라·골라라)이 쓰는 **용어 문항**을 화면 언어로 내려준다.
//
// ⛔ 이 함수가 생기기 전까지 문항은 코드에 박혀 있었다 — 게임 HTML 3벌의 `POOL` + `src/lib/terms.ts`,
//    관리자 화면(term_questions)은 아무도 안 읽어서 무용지물이었다.
//    이제 단일 출처는 DB 다. 코드 쪽 문항은 **폴백**으로만 남는다(이 함수가 죽어도 게임은 돌아간다).
//
// 요청(POST): { gameId: 'beat-cari'|'shoot-cari'|'pick-cari', lang?: 'ko'|'en'|... }
//
// ⛔ **DAILY QUIZ 는 이 은행을 쓰지 않는다(2026-09-03 지시).** 게임 문제은행과 별개다 —
//    `/daily` 는 `src/lib/terms.ts` 의 문항을 그대로 쓴다. 여기 'daily' 를 다시 넣지 말 것.
// 응답:       { items: [{ id, code, field, desc, answer, distractors: [3개] }] }
//
// · 로그인 불필요(게스트도 게임을 한다) — anon 키만 있으면 된다. `--no-verify-jwt` 로 올리지 말 것.
// · 정답이 그대로 실려 나가지만 이건 원래 클라이언트에서 채점하는 퀴즈 게임이다(시험이 아니다).
//   시험 문항(questions.correct_index)과 달리 숨길 게 없다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, pickLang, projText, projOptions } from '../_shared/lib.ts'

interface TermRow {
  id: string
  code: string | null
  field: string
  desc_i18n: Record<string, string>
  answer_i18n: Record<string, string>
  distractors_i18n: Record<string, string[]>
}

/** 이 문항을 쓰는 게임. 화면(`lib/minigames.ts` 의 TERM_GAME_IDS)과 같은 목록이어야 한다. */
const TARGETS = ['beat-cari', 'shoot-cari', 'pick-cari']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const gameId = String(body?.gameId ?? '')
    if (!TARGETS.includes(gameId)) return json({ error: '알 수 없는 대상입니다.' }, 400)
    const lang = pickLang(body?.lang)
    const admin = adminClient()

    // ⛔ **게임별 세트는 안 본다(2026-09-03).** 네 곳이 같은 용어 문제를 보여주는 방식만 다르고,
    //    문항을 갈라 쓸 이유가 없어서 선택 기능을 걷어냈다 — 은행에 살아 있는 문항이 곧 나가는 문항이다.
    //    문항 하나를 빼려면 관리자 화면에서 '사용'을 끈다(그러면 세 게임에서 같이 빠진다).
    //    ⚠️ gameId 는 계속 받는다 — 나중에 갈라야 할 일이 생겼을 때 호출부를 안 고치려고 남겨 둔 자리다.
    const { data, error } = await admin
      .from('term_questions')
      .select('id, code, field, desc_i18n, answer_i18n, distractors_i18n')
      .is('deleted_at', null)
      .eq('active', true)
      .order('sort_order')
      .limit(2000)
    if (error) return json({ error: error.message }, 500)

    // 투영: 그 언어 번역이 있으면 번역본, 없으면 한국어(projText 가 ko 로 떨어진다).
    // ⚠️ 오답이 3개가 아닌 언어는 **그 문항만** 한국어로 되돌린다 — 보기 하나가 빈 채로 나가면
    //    그 문제는 아무도 못 푼다(개수가 곧 보기 4칸이다).
    const items = ((data ?? []) as TermRow[])
      .map((r) => {
        let desc = projText(r.desc_i18n, lang)
        let answer = projText(r.answer_i18n, lang)
        let distractors = projOptions(r.distractors_i18n, lang)
        if (!desc || !answer || distractors.length !== 3 || distractors.some((s) => !s)) {
          desc = projText(r.desc_i18n, 'ko')
          answer = projText(r.answer_i18n, 'ko')
          distractors = projOptions(r.distractors_i18n, 'ko')
        }
        return { id: r.id, code: r.code, field: r.field, desc, answer, distractors }
      })
      .filter((it) => it.desc && it.answer && it.distractors.length === 3 && it.distractors.every(Boolean))

    return json({ items })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
