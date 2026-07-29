// 승급 결과창 미리보기 — 실제로 승급하지 않고 '승급 → 다음 레벨 도전 → 응시 전 경고' 흐름을 눈으로 확인하는 용도.
//
//   node scripts/preview-promoted.mjs                 # 로컬 dev(5173) · 승급(up) 상태
//   node scripts/preview-promoted.mjs stay            # 유지 상태(버튼이 안 나오는 걸 확인)
//   node scripts/preview-promoted.mjs down            # 강등 상태
//   node scripts/preview-promoted.mjs up http://localhost:5176
//   node scripts/preview-promoted.mjs up https://gara-cbt.airobotassn.workers.dev   # 배포본에도 그대로 쓴다
//
// 동작: 크롬 창을 띄우고 (1) 가짜 정식회원 세션을 심고 (2) Edge Function 응답(get-result·start-test·ebooks)만
//       가로채 가짜 값으로 답한다. 화면·라우팅·버튼은 전부 진짜 코드가 돈다. 창을 닫으면 스크립트가 끝난다.
//       ⚠️ 서버에 아무것도 쓰지 않는다(응시 기록이 생기지 않음). 로그인도 실제로 하지 않는다.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const MODE = (process.argv[2] ?? 'up').toLowerCase() // up | stay | down
const BASE = process.argv[3] ?? 'http://localhost:5173'
const LEVEL = 3 // 응시한 레벨(= 승급 전 등급)

// 세션 키는 프로젝트 ref 로 만들어진다 → .env.local 의 VITE_SUPABASE_URL 에서 뽑는다.
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const ref = env.match(/VITE_SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!ref) throw new Error('.env.local 에서 VITE_SUPABASE_URL 을 못 찾았습니다')

const AXES = ['prompt', 'model', 'verify', 'automation', 'data', 'ethics']
const axisMap = (vals) => Object.fromEntries(AXES.map((k, i) => [k, vals[i]]))
const rankAfter = MODE === 'up' ? LEVEL + 1 : MODE === 'down' ? LEVEL - 1 : LEVEL

const browser = await chromium.launch({ headless: process.env.PREVIEW_HEADLESS === '1' })
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } })

// (1) 가짜 정식회원 세션 — 이게 없으면 결과창이 '로그인하면 열림' 잠금 화면으로 뜬다.
await page.addInitScript(({ ref }) => {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
    access_token: 'fake-access', token_type: 'bearer', expires_in: 3600, expires_at: expires,
    refresh_token: 'fake-refresh',
    user: {
      id: 'preview-user', aud: 'authenticated', role: 'authenticated', email: 'preview@example.com',
      is_anonymous: false, app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: '미리보기' },
      identities: [{ id: 'g1', user_id: 'preview-user', provider: 'google', identity_data: {} }],
      created_at: '2020-01-01T00:00:00Z',
    },
  }))
}, { ref })

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

// (2) 서버 응답 가로채기 — auth 검증이 세션을 비우지 않게 스텁
await page.route('**/auth/v1/**', (r) => r.fulfill(json({ id: 'preview-user', is_anonymous: false })))

await page.route('**/functions/v1/get-result', (r) => r.fulfill(json({
  attemptId: 'preview', level: LEVEL, totalCorrect: 17, totalQuestions: 20, locked: false,
  tierKey: 'gold', overall: 62, placed: true,
  rating: axisMap([62, 55, 48, 66, 52, 58]),
  perf: axisMap([70, 60, 55, 72, 58, 64]),
  prevPerf: axisMap([58, 57, 44, 61, 55, 52]),
  deltas: axisMap([3, -2, 5, 1, 0, 2]),
  tierAvg: axisMap([50, 50, 50, 50, 50, 50]),
  rankDir: MODE, rankBefore: LEVEL, rankAfter, warnStrikes: 0,
  answers: [],
})))

// 다음 레벨 응시 생성 — 실제 문항 대신 더미 25개(경고 게이트까지 확인하는 게 목적).
let startedLevel = null
await page.route('**/functions/v1/start-test', (r) => {
  try { startedLevel = JSON.parse(r.request().postData() ?? '{}').level } catch { /* noop */ }
  console.log(`  → start-test 호출: level=${startedLevel}`)
  return r.fulfill(json({
    attemptId: 'preview-next', level: startedLevel ?? rankAfter, startedAt: new Date().toISOString(),
    questions: Array.from({ length: 25 }, (_, i) => ({
      id: `q${i}`, category: AXES[i % 6],
      prompt: `[미리보기] 문항 ${i + 1} — 실제 문항이 아닙니다.`,
      options: ['선택지 A', '선택지 B', '선택지 C', '선택지 D'],
    })),
  }))
})

await page.route('**/functions/v1/ebooks', (r) => r.fulfill(json({ items: [] })))

await page.goto(`${BASE}/test/result/preview`, { waitUntil: 'domcontentloaded' })
console.log(`\n미리보기: ${MODE}  (Lv.${LEVEL} 응시 → 등급 Lv.${rankAfter})`)
console.log(MODE === 'up'
  ? '  결과창 아래 "Lv.%d 도전하기 →" 를 눌러 응시 전 경고 화면까지 확인하세요.'.replace('%d', rankAfter)
  : '  이 상태에서는 다음 레벨 버튼이 나오지 않아야 정상입니다.')
console.log('  창을 닫으면 종료됩니다.\n')

if (process.env.PREVIEW_HEADLESS === '1') {
  await page.waitForTimeout(2500)
  console.log('  버튼 개수 =', await page.locator('.result-actions button').count())
  await browser.close()
} else {
  await new Promise((resolve) => page.on('close', resolve))
  await browser.close().catch(() => {})
}
