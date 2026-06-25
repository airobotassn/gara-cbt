// 촬영 — 화면 한 장을 base64 PNG로. 데이터 화면은 가짜 세션 + 함수 목킹으로 렌더.
// (tests/responsive.spec.ts 의 목킹 패턴 재사용)

const SUPABASE_REF = 'jfvldoywvzvqhitcgalr'
const AXES = ['prompt', 'model', 'verify', 'automation', 'data', 'ethics']
const axisMap = (vals) => Object.fromEntries(AXES.map((k, i) => [k, vals[i]]))
// 레벨별 실제 6축 코드(레이더가 제대로 그려지도록)
const L1 = ['l1_principle', 'l1_security', 'l1_ethics', 'l1_responsibility', 'l1_llm_eco', 'l1_prompt']
const L2 = ['l2_genai', 'l2_api', 'l2_algo', 'l2_sensor', 'l2_block', 'l2_python']
const L3 = ['l3_rag', 'l3_llm_ctrl', 'l3_vision_eval', 'l3_vision_data', 'l3_c_basic', 'l3_c_adv']
const mapBy = (keys, vals) => Object.fromEntries(keys.map((k, i) => [k, vals[i]]))

const DEVICES = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
}

async function seedAuthAndMocks(context) {
  await context.addInitScript(
    ({ ref }) => {
      const future = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({
        access_token: 'fake-access', token_type: 'bearer', expires_in: 3600,
        expires_at: future, refresh_token: 'fake-refresh',
        user: {
          id: 'demo-user', aud: 'authenticated', role: 'authenticated',
          email: 'demo@example.com', is_anonymous: false,
          app_metadata: { provider: 'google', providers: ['google'] },
          user_metadata: { full_name: 'Demo User' },
          identities: [{ id: 'g1', user_id: 'demo-user', provider: 'google', identity_data: {} }],
          created_at: '2020-01-01T00:00:00Z',
        },
      }))
    },
    { ref: SUPABASE_REF },
  )

  await context.route('**/auth/v1/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 'demo-user', is_anonymous: false }) }))

  await context.route('**/functions/v1/get-result', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        attemptId: 'demo', level: 3, totalCorrect: 3, totalQuestions: 20, locked: false,
        rating: mapBy(L3, [52, 45, 58, 40, 50, 38]), deltas: mapBy(L3, [-3, -5, -2, -4, -1, -3]),
        perf: mapBy(L3, [48, 40, 55, 35, 47, 33]), prevPerf: mapBy(L3, [60, 52, 50, 44, 41, 39]),
        placed: true, rankBefore: 3, rankAfter: 3, rankDir: 'stay',
        warnStrikes: 2, // ← 강등 경고 2/3 (목)
        answers: Array.from({ length: 6 }, (_, i) => ({
          questionId: `q${i}`, category: L3[i % L3.length],
          prompt: `샘플 문항 ${i + 1}`, options: ['A', 'B', 'C', 'D'],
          selectedIndex: 0, correctIndex: 1, isCorrect: i < 2,
          explanation: '해설',
        })),
      }) }))

  await context.route('**/functions/v1/list-attempts', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        attempts: Array.from({ length: 5 }, (_, i) => ({
          attemptId: `a${i}`, level: 3, totalCorrect: i < 2 ? 3 : 9, totalQuestions: 20,
          rankAfter: 3, rankDir: 'stay', deltas: mapBy(L3, [-3, -5, -2, -4, -1, -3]),
          submittedAt: `2026-0${(i % 6) + 1}-15T10:00:00Z`,
        })),
        currentRank: 3,
        currentPoints: 3214, // ← 랭킹 점수(목)
        demotionStrikes: 2, // ← 강등 경고 2/3(목)
        levelSkills: [
          { level: 2, ratings: mapBy(L2, [70, 65, 60, 72, 58, 68]), attemptsCount: 3 },
          { level: 3, ratings: mapBy(L3, [72, 45, 58, 40, 57, 38]), attemptsCount: 5 }, // 잘함/평균/부족 섞이게(데모)
        ],
      }) }))

  // 리더보드(랭킹 화면) — 구버전(users)·신버전(top/me) 필드를 모두 담아 Before/After 둘 다 렌더되게.
  const lbNames = ['김에이아이', '이로보', '박프롬프트', '최데이터', '정모델', '한비전', '오엣지', '서로스', '윤피엘씨', '임데브']
  const lbColors = ['#a566e0', '#4aa0e8', '#3fb8ad', '#aeb9c8', '#b8763e', '#86efac', '#ff9bb0', '#c7a3ff', '#9fe0d8', '#ffd29b']
  const lbLevels = [7, 7, 6, 6, 6, 5, 5, 5, 4, 4]
  const lbRatings = [96, 92, 88, 85, 83, 80, 78, 75, 72, 70]
  await context.route('**/functions/v1/leaderboard', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        // 신버전(명예의 전당)
        top: lbNames.map((name, i) => ({
          rank: i + 1, name, level: lbLevels[i], rating: lbRatings[i], color: lbColors[i], image: null, me: false,
        })),
        me: { rank: 171, level: 2, rating: 14, name: '나 (Demo)', color: '#e3b23c', image: null, me: true },
        total: 980,
        // 구버전(리그 리스트) 호환 필드
        users: lbNames.slice(0, 6).map((name, i) => ({ name, rating: lbRatings[i], color: lbColors[i], me: i === 3 })),
        myRank: 4, myGlobalRank: 171, globalTotal: 980,
      }) }))

  // start-test (시험 시작) — 레벨 선택 → 퀴즈 진입용. 레벨 1, 20문항.
  await context.route('**/functions/v1/start-test', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        attemptId: 'demo', level: 1, lang: 'ko', startedAt: '2026-06-18T10:00:00Z',
        questions: Array.from({ length: 20 }, (_, i) => ({
          id: `q${i}`, category: L1[i % L1.length],
          prompt: `생성형 AI를 활용할 때 가장 적절한 접근은 무엇인가요? (샘플 문항 ${i + 1})`,
          options: ['첫 번째 선택지', '두 번째 선택지', '세 번째 선택지', '네 번째 선택지'],
        })),
      }) }))
}

export async function shoot(browser, url, s) {
  const context = await browser.newContext({
    viewport: DEVICES[s.device] || DEVICES.desktop,
    colorScheme: s.theme === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: 2,
    isMobile: s.device === 'mobile',
  })
  await context.addInitScript((l) => localStorage.setItem('lang', l), s.lang || 'ko')
  if (s.authed) await seedAuthAndMocks(context)
  const page = await context.newPage()
  try {
    await page.goto(url + s.path, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(700)
    if (s.steps) await s.steps(page) // 진입 후 클릭 흐름(예: 시험 시작)
    const buf = await page.screenshot({ fullPage: true })
    return { ok: true, dataUri: `data:image/png;base64,${buf.toString('base64')}` }
  } catch (e) {
    return { ok: false, error: String(e) }
  } finally {
    await context.close()
  }
}
