// 검색 라우터 지도 검사 — 메인 검색창이 **실재하는 페이지**로 보내는지, 그리고 그 규칙이
// 네 곳에서 같은 말을 하는지 본다.
//
// 왜 필요한가 (2026-08-25 점검에서 나온 것):
//   몇 주 동안 페이지가 생기고(/plan · /test/record) 기본 탭이 바뀌고(/mypage) 파는 물건이 늘었는데
//   (강의) 검색 라우터만 한 번도 안 건드렸다. 네 곳이 서로 완벽하게 동기화된 채로 **다 같이 옛
//   사이트 지도**를 들고 있었다 — "시험 언제야" 가 일정이 한 줄도 없는 /guide 로 가고 있었다.
//   사람 눈으로는 못 잡는다(네 곳이 서로 일치하니까). 그래서 **실제 라우트와 대조**하는 검사가 필요하다.
//
// 검사 셋:
//   1) 네 곳 동기화 — DEST 키 ↔ responseSchema enum, DEST 목적지 ↔ route-seed dest ↔ VALID_DESTS
//   2) ⭐ 목적지가 App.tsx 에 **실재하는 라우트**인가 (라우트를 지우거나 옮기면 여기서 걸린다)
//   3) 키워드 폴백 — 서버·클라가 글자까지 같은지 + 대표 검색어가 맞는 곳으로 가는지
import { readFileSync } from 'node:fs'

const RQ = readFileSync('supabase/functions/route-query/index.ts', 'utf8')
const RS = readFileSync('supabase/functions/route-seed/index.ts', 'utf8')
const LD = readFileSync('src/pages/Landing.tsx', 'utf8')
const APP = readFileSync('src/App.tsx', 'utf8')

const out = []
const rec = (name, pass, detail) => out.push({ name, pass, detail })
const eq = (name, got, want) =>
  rec(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

// ── 뽑아내기 ────────────────────────────────────────────────────────────────
const destPairs = [...RQ.matchAll(/^ {2}(\w+): '([^']+)',/gm)].map((m) => [m[1], m[2]])
const destKeys = destPairs.map((d) => d[0])
const dests = [...new Set(destPairs.map((d) => d[1]))].sort()

const enumList = [...RQ.slice(RQ.indexOf('enum: ['), RQ.indexOf(']', RQ.indexOf('enum: [')))
  .matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((k) => k !== 'unknown')

const seedDests = [...new Set([...RS.matchAll(/dest: '([^']+)'/g)].map((m) => m[1]))].sort()

const vdStart = LD.indexOf('VALID_DESTS')
const validDests = [...LD.slice(vdStart, LD.indexOf('])', vdStart)).matchAll(/'([^']+)'/g)]
  .map((m) => m[1]).sort()

// App.tsx 의 라우트 → 매칭기. `:param` 자리는 한 조각짜리 아무 값이나 받는다
// (`/mypage/attempts` 는 `/mypage/:section` 이 받는 정상 주소다).
const matchers = [...APP.matchAll(/<Route path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== '*')
  .map((p) => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$'))
const routeExists = (d) => matchers.some((re) => re.test(d))

// `/mypage/<탭>` 목적지는 그 탭이 실제로 있는지까지 본다 — `/mypage/:section` 은 없는 탭을
// 받아도 조용히 기본 탭으로 떨어뜨리므로, 탭 key 를 바꾸면 검색만 말없이 엉뚱한 화면으로 간다.
const MYPAGE_TABS = [...readFileSync('src/pages/MyPage.tsx', 'utf8')
  .matchAll(/\{ key: '([^']+)', labelKey:/g)].map((m) => m[1])

// ── 1) 네 곳 동기화 ─────────────────────────────────────────────────────────
eq('1a DEST 키 == responseSchema enum', [...destKeys].sort(), [...enumList].sort())
eq('1b DEST 목적지 == route-seed dest', dests, seedDests)
eq('1c DEST 목적지 == Landing VALID_DESTS', dests, validDests)

// ── 2) ⭐ 목적지가 실재하는 라우트인가 ──────────────────────────────────────
// 이게 이 파일의 존재 이유다. 페이지를 옮기거나 지우면 검색만 조용히 옛 주소로 계속 보낸다.
for (const d of dests) rec(`2a ⭐ ${d} 라우트 실재`, routeExists(d), `App.tsx 에 이 주소를 받는 <Route> 가 없음`)
for (const d of dests.filter((x) => x.startsWith('/mypage/'))) {
  const tab = d.slice('/mypage/'.length)
  rec(`2b ⭐ ${d} 탭 실재`, MYPAGE_TABS.includes(tab), `MyPage 의 TABS 에 '${tab}' 없음 (있는 것: ${MYPAGE_TABS.join(', ')})`)
}

// ── 3) 키워드 폴백 ──────────────────────────────────────────────────────────
// 임베딩·LLM 이 둘 다 죽었을 때 쓰는 최후 규칙. 서버와 클라가 **글자까지 같아야** 한다 —
// 다르면 장애 상황에서 서버와 브라우저가 서로 다른 페이지로 보낸다.
function rulesOf(src, fnName) {
  const i = src.indexOf(`function ${fnName}`)
  const body = src.slice(i, src.indexOf('\n}', src.indexOf('return null', i)))
  return body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('if (h('))
}
const serverRules = rulesOf(RQ, 'keywordRoute')
const clientRules = rulesOf(LD, 'clientKeywordRoute')
eq('3a 서버 keywordRoute == 클라 clientKeywordRoute', serverRules, clientRules)

const compiled = clientRules.map((l) => {
  const m = l.match(/^if \(h\((\/.*\/)\)\) return '([^']+)'$/)
  if (!m) throw new Error(`규칙을 못 읽었다: ${l}`)
  return [new RegExp(m[1].slice(1, -1)), m[2]]
})
const route = (q) => {
  const s = q.toLowerCase()
  for (const [re, d] of compiled) if (re.test(s)) return d
  return null
}

// 대표 검색어 → 가야 할 곳. **사람이 실제로 칠 만한 말**로만 적는다.
const CASES = [
  // 시험 일정 — 2026-07 에 /guide 에서 분리됐다. 여기가 /guide 로 돌아가면 일정 없는 페이지로 간다.
  ['시험 언제야', '/plan'], ['시험 일정 알려줘', '/plan'], ['접수 기간 언제', '/plan'], ['다음 시험 날짜', '/plan'],
  // 접수는 일정과 다른 곳 — '접수 기간'(일정) 과 '접수하기'(원서) 가 안 섞여야 한다.
  ['원서접수 하고싶어', '/exam/apply'], ['시험 신청', '/exam/apply'], ['응시료 얼마야', '/exam/apply'],
  // 내 점수 — /mypage 기본 탭이 이북 서재가 된 뒤로 응시 현황 탭이 목적지다.
  ['내 점수', '/mypage/attempts'], ['응시 이력', '/mypage/attempts'], ['마이페이지', '/mypage/attempts'],
  ['내 성적 확인', '/mypage/attempts'],
  // 강의도 파는 물건이다(2026-08-25). 사는 것과 이미 산 것이 갈려야 한다.
  ['강의 사고싶어', '/ebooks'], ['인강', '/ebooks'], ['온라인 강의', '/ebooks'], ['이북', '/ebooks'], ['교재 사기', '/ebooks'],
  ['내 강의', '/mypage/ebooks'], ['구매한 강의 어디서 봐', '/mypage/ebooks'], ['내 서재', '/mypage/ebooks'],
  // 의견·건의는 고객센터로 보낸다 — 의견함(/feedback)은 2026-08-28 에 없어졌다.
  ['의견 보내기', '/faq'], ['건의사항', '/faq'], ['피드백', '/faq'], ['환불', '/faq'],
  // '응시 자격' 은 정보다 — 아래 '응시' 규칙에 잡히면 시험장 입구로 간다.
  ['응시 자격', '/guide'], ['응시자격이 뭐야', '/guide'], ['어떤 시험 있어', '/guide'], ['급수가 어떻게 돼', '/guide'],
  // 나머지 대표값
  ['시험 보러 왔어', '/exam'], ['모의고사', '/exam/check'], ['자격증 발급', '/certificate'],
  ['랭킹', '/ranking'], ['순위 추이', '/ranking'], ['아레나', '/arena'], ['우리 지역 순위', '/arena'],
  // /daily 는 2026-08-27 에 이름이 'DAILY QUIZ' 가 됐다 — 옛 이름도 계속 닿아야 한다.
  ['미니게임', '/games'], ['DAILY QUIZ', '/daily'], ['데일리 퀴즈', '/daily'], ['오늘의 학습', '/daily'],
  ['캐릭터', '/hub'], ['코인', '/hub'], ['출석', '/hub'],
  ['레벨테스트', '/test/select'], ['내 실력 몇점', '/test/select'],
  ['로그인', '/login'], ['공지사항', '/notice'], ['이용약관', '/terms'], ['개인정보', '/privacy'], ['협회 소개', '/about'],
]
for (const [q, want] of CASES) {
  const got = route(q)
  rec(`3b "${q}" → ${want}`, got === want, `got ${got}`)
}

// ── 4) 재시드가 학습분도 비우는가 ───────────────────────────────────────────
// seed 행만 지우면 목적지를 고쳐도 예전에 학습된 질의(source='llm')는 옛 페이지로 계속 간다.
rec(
  "4 ⭐ reset 이 학습분(llm)까지 지운다",
  /\.in\('source',\s*\[[^\]]*'llm'[^\]]*\]\)/.test(RS),
  "route-seed 의 reset 이 source='seed' 만 지우고 있다",
)

// ── 리포트 ──────────────────────────────────────────────────────────────────
let fail = 0
for (const r of out) {
  if (!r.pass) fail++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  — ${r.detail}`}`)
}
console.log(`\nROUTE-MAP: ${out.length - fail}/${out.length} passed`)
process.exit(fail ? 1 : 0)
