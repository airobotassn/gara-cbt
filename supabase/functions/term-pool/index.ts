// term-pool: 미니게임(버텨라·쏴라·골라라)과 DAILY QUIZ 가 쓰는 **용어 문항**을 화면 언어로 내려준다.
//
// ⛔ 이 함수가 생기기 전까지 문항은 코드에 박혀 있었다 — 게임 HTML 3벌의 `POOL` + `src/lib/terms.ts`,
//    즉 **같은 50문항이 네 벌** 복제돼 있었고, 관리자 화면(term_questions)은 아무도 안 읽어서 무용지물이었다.
//    이제 단일 출처는 DB 다. 코드 쪽 문항은 **폴백**으로만 남는다(이 함수가 죽어도 게임은 돌아간다).
//
// 요청(POST): { gameId: 'beat-cari'|'shoot-cari'|'pick-cari'|'daily', lang?: 'ko'|'en'|... }
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

/** 이 문항을 쓰는 곳. 관리자 화면(TERM_TARGETS)과 같은 목록이어야 한다. */
const TARGETS = ['beat-cari', 'shoot-cari', 'pick-cari', 'daily']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json().catch(() => ({}))
    const gameId = String(body?.gameId ?? '')
    if (!TARGETS.includes(gameId)) return json({ error: '알 수 없는 대상입니다.' }, 400)
    const lang = pickLang(body?.lang)
    const admin = adminClient()

    // ⚠️ 세트가 **비어 있으면 그 게임은 은행 전체를 쓴다**(minigame_question_sets 마이그레이션의 규칙).
    //    빈 세트는 "아직 안 골랐다"는 뜻이지 "문항 없음"이 아니다 — 여기서 빈 배열을 돌려주면
    //    관리자가 세트를 건드리는 순간 게임이 통째로 빈다.
    const { data: setRows } = await admin
      .from('minigame_question_sets').select('question_id').eq('game_id', gameId)
    const ids = ((setRows ?? []) as { question_id: string }[]).map((r) => r.question_id)

    let q = admin
      .from('term_questions')
      .select('id, code, field, desc_i18n, answer_i18n, distractors_i18n')
      .is('deleted_at', null)
      .eq('active', true)
      .order('sort_order')
      .limit(2000)
    if (ids.length) q = q.in('id', ids)
    const { data, error } = await q
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
        // answerKo = 한국어 정답 원문. DAILY QUIZ 의 해설(TERM_THEORY)이 이 값을 키로 찾는다 —
        // 번역된 정답으로 찾으면 한국어 외 언어에서 해설이 통째로 안 붙는다.
        return { id: r.id, code: r.code, field: r.field, desc, answer, distractors, answerKo: projText(r.answer_i18n, 'ko') }
      })
      .filter((it) => it.desc && it.answer && it.distractors.length === 3 && it.distractors.every(Boolean))

    return json({ items })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : '오류' }, 500)
  }
})
