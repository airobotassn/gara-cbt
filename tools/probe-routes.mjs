// 배포된 검색 라우터를 라이브로 찔러본다 — 대표 검색어가 실제로 어디로 가는지.
//   `hit:true` = 임베딩 앵커가 답한 것(LLM 안 부름). 앵커가 낡았으면 여기서 옛 목적지가 보인다.
//
// 실행:  node tools/probe-routes.mjs
import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const BASE = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY

// [검색어, 가야 할 곳]
const CASES = [
  ['시험 언제야', '/plan'], ['시험 일정 알려줘', '/plan'], ['접수 기간 언제', '/plan'], ['다음 시험 날짜', '/plan'],
  ['원서접수 하고싶어', '/exam/apply'], ['응시료 얼마야', '/exam/apply'],
  ['내 점수', '/mypage/attempts'], ['응시 이력', '/mypage/attempts'], ['내 성적 확인', '/mypage/attempts'],
  ['강의 사고싶어', '/ebooks'], ['인강 듣고싶어', '/ebooks'], ['이북 사고 싶어', '/ebooks'],
  ['내 강의', '/mypage/ebooks'], ['구매한 강의 어디서 봐', '/mypage/ebooks'], ['내 서재', '/mypage/ebooks'],
  ['의견 보내기', '/faq'], ['건의사항 있어', '/faq'], ['환불 어떻게 해', '/faq'],
  ['응시 자격이 뭐야', '/guide'], ['어떤 시험 있어', '/guide'], ['급수가 어떻게 돼', '/guide'],
  ['시험 보러 왔어', '/exam'], ['모의고사', '/exam/check'], ['자격증 발급', '/certificate'],
  ['랭킹', '/ranking'], ['아레나', '/arena'], ['미니게임', '/games'], ['오늘의 학습', '/daily'],
  ['캐릭터 바꾸고싶어', '/hub'], ['레벨테스트 하고싶어', '/test/select'],
  ['로그인', '/login'], ['공지사항', '/notice'], ['이용약관', '/terms'], ['개인정보', '/privacy'], ['협회 소개', '/about'],
]

let bad = 0
for (const [q, want] of CASES) {
  const res = await fetch(`${BASE}/functions/v1/route-query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ query: q }),
  })
  const j = await res.json().catch(() => ({}))
  const ok = j.dest === want
  if (!ok) bad++
  const how = j.hit ? 'anchor' : j.fallback ? j.fallback : 'llm'
  console.log(`${ok ? 'OK  ' : 'X   '}${q.padEnd(22)} → ${String(j.dest).padEnd(18)} (${how})${ok ? '' : `  want ${want}`}`)
}
console.log(`\n${CASES.length - bad}/${CASES.length} ok`)
process.exit(bad ? 1 : 0)
