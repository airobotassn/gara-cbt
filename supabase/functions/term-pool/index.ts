// term-pool: 미니게임 용어 퀴즈 3종(버텨라·쏴라·골라라)과 DAILY QUIZ 가 쓰는 **용어 문항**을 화면 언어로 내려준다.
//
// ⛔ 이 함수가 생기기 전까지 문항은 코드에 박혀 있었다 — 게임 HTML 3벌의 `POOL` + `src/lib/terms.ts`,
//    관리자 화면(term_questions)은 아무도 안 읽어서 무용지물이었다.
//    이제 단일 출처는 DB 다. 코드 쪽 문항은 **폴백**으로만 남는다(이 함수가 죽어도 게임·DAILY 는 돌아간다).
//
// 요청(POST): { gameId: 'beat-cari'|'shoot-cari'|'pick-cari'|'daily', lang?: 'ko'|'en'|... }
//
// **은행이 둘이다(2026-09-08)** — 게임 3종은 게임 은행(a1), DAILY QUIZ 는 DAILY 은행(a2). 같은 표를 bank_id 로 가른다.
//   2026-09-03 에 "DAILY 는 이 은행을 쓰지 않는다" 였던 이유는 게임 은행을 같이 읽으면 관리자가 게임 문항을 고칠 때
//   DAILY 도 따라 바뀌기 때문이었다. 은행을 갈랐으니 그 이유가 없어졌고, 이제 DAILY 문항도 관리자 화면에서 고친다.
//   ⛔ 'daily' 를 게임 은행에 물리지 말 것 — 매핑은 `_shared/term-banks.ts` 하나다.
// 응답:       { items: [{ id, code, field, desc, answer, answerKo, distractors: [3개] }] }
//
// ⛔ **`answerKo`(한국어 정답)를 언어와 무관하게 같이 내려준다.** DAILY QUIZ 의 해설(글·그림)은 코드에 있고
//    **한국어 정답 표기가 그 열쇠**다 — 영어로 보는 사람에게 `answer` 는 'Neural network' 로 투영되므로
//    그걸로 해설을 찾으면 못 찾고 해설 카드가 통째로 안 뜬다(2026-09-08 실측: 외국어에선 해설이 안 나왔다).
//    화면에 보이는 정답은 `answer`, 해설을 찾는 열쇠는 `answerKo` — 두 자리를 섞지 말 것.
//
// · 로그인 불필요(게스트도 게임을 한다) — anon 키만 있으면 된다. `--no-verify-jwt` 로 올리지 말 것.
// · 정답이 그대로 실려 나가지만 이건 원래 클라이언트에서 채점하는 퀴즈 게임이다(시험이 아니다).
//   시험 문항(questions.correct_index)과 달리 숨길 게 없다.
import { corsHeaders, json } from '../_shared/cors.ts'
import { adminClient, pickLang, projText, projOptions } from '../_shared/lib.ts'
import { TERM_BANKS, type TermBankKey } from '../_shared/term-banks.ts'

interface TermRow {
  id: string
  code: string | null
  field: string
  desc_i18n: Record<string, string>
  answer_i18n: Record<string, string>
  distractors_i18n: Record<string, string[]>
}

/** 대상 → 은행. 게임 목록은 화면(`lib/minigames.ts` 의 TERM_GAME_IDS)과 같아야 한다. */
const TARGETS: Record<string, TermBankKey> = {
  'beat-cari': 'game', 'shoot-cari': 'game', 'pick-cari': 'game',
  daily: 'daily',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const gameId = String(body?.gameId ?? '')
    const bank = TARGETS[gameId]
    if (!bank) return json({ error: '알 수 없는 대상입니다.' }, 400)
    const lang = pickLang(body?.lang)
    const admin = adminClient()

    // ⛔ **게임별 세트는 안 본다(2026-09-03).** 세 게임은 같은 용어 문제를 보여주는 방식만 다르고,
    //    문항을 갈라 쓸 이유가 없어서 선택 기능을 걷어냈다 — 은행에 살아 있는 문항이 곧 나가는 문항이다.
    //    문항 하나를 빼려면 관리자 화면에서 '사용'을 끈다(그러면 세 게임에서 같이 빠진다).
    // ⚠️ 순서는 **결정론적**이어야 한다(sort_order → code). DAILY QUIZ 가 "오늘의 문제 = epochDay % N 번째" 로
    //    고르기 때문에, 같은 sort_order 가 둘이면 새로고침마다 다른 문제가 뜬다.
    const { data, error } = await admin
      .from('term_questions')
      .select('id, code, field, desc_i18n, answer_i18n, distractors_i18n')
      .eq('bank_id', TERM_BANKS[bank].id)
      .is('deleted_at', null)
      .eq('active', true)
      .order('sort_order')
      .order('code')
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
        // answerKo 는 투영을 거치지 않은 원본이다(해설을 찾는 열쇠라 언어가 바뀌어도 그대로여야 한다).
        return { id: r.id, code: r.code, field: r.field, desc, answer, answerKo: projText(r.answer_i18n, 'ko'), distractors }
      })
      .filter((it) => it.desc && it.answer && it.distractors.length === 3 && it.distractors.every(Boolean))

    return json({ items })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
