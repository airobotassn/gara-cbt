// 촬영 — 화면 한 장을 base64 PNG로. 데이터 화면은 가짜 세션 + 함수 목킹으로 렌더.
// (tests/responsive.spec.ts 의 목킹 패턴 재사용)

// ⚠️ .env.local 의 VITE_SUPABASE_URL 프로젝트 ref 와 같아야 가짜 세션이 먹는다(다르면 로그아웃 화면이 찍힘).
const SUPABASE_REF = 'lditytpxuuojfznwfnep'
const AXES = ['prompt', 'model', 'verify', 'automation', 'data', 'ethics']
const axisMap = (vals) => Object.fromEntries(AXES.map((k, i) => [k, vals[i]]))
// 레벨별 실제 6축 코드(레이더가 제대로 그려지도록). 2026-07 사다리 한 칸 밀기 반영 — L1 변수 = 지금의 Lv.2 축.
const L1 = ['l2_principle', 'l2_security', 'l2_ethics', 'l2_responsibility', 'l2_llm_eco', 'l2_prompt']
const L2 = ['l3_genai', 'l3_api', 'l3_algo', 'l3_sensor', 'l3_block', 'l3_python']
const L3 = ['l4_rag', 'l4_llm_ctrl', 'l4_vision_eval', 'l4_vision_data', 'l4_c_basic', 'l4_c_adv']
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
        attemptId: 'demo', level: 4, totalCorrect: 3, totalQuestions: 20, locked: false,
        rating: mapBy(L3, [52, 45, 58, 40, 50, 38]), deltas: mapBy(L3, [-3, -5, -2, -4, -1, -3]),
        perf: mapBy(L3, [48, 40, 55, 35, 47, 33]), prevPerf: mapBy(L3, [60, 52, 50, 44, 41, 39]),
        placed: true, rankBefore: 4, rankAfter: 4, rankDir: 'stay',
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
        // 대시보드 하단이 '승급 기록'(rankDir==='up' 만)이라 승급 행이 섞여 있어야 빈 패널이 안 나온다.
        attempts: [
          { attemptId: 'a0', level: 4, totalCorrect: 9, totalQuestions: 20, rankAfter: 4, rankDir: 'stay', deltas: mapBy(L3, [-3, -5, -2, -4, -1, -3]), submittedAt: '2026-06-15T10:00:00Z' },
          { attemptId: 'a1', level: 3, totalCorrect: 17, totalQuestions: 20, rankAfter: 4, rankDir: 'up', deltas: mapBy(L3, [4, 5, 3, 6, 2, 4]), submittedAt: '2026-05-15T10:00:00Z' },
          { attemptId: 'a2', level: 3, totalCorrect: 3, totalQuestions: 20, rankAfter: 3, rankDir: 'stay', deltas: mapBy(L2, [-3, -5, -2, -4, -1, -3]), submittedAt: '2026-04-15T10:00:00Z' },
          { attemptId: 'a3', level: 2, totalCorrect: 18, totalQuestions: 20, rankAfter: 3, rankDir: 'up', deltas: mapBy(L2, [5, 4, 6, 3, 5, 4]), submittedAt: '2026-03-15T10:00:00Z' },
          { attemptId: 'a4', level: 1, totalCorrect: 16, totalQuestions: 20, rankAfter: 2, rankDir: 'up', deltas: mapBy(L2, [3, 3, 4, 2, 3, 3]), submittedAt: '2026-02-15T10:00:00Z' },
        ],
        currentRank: 4,
        currentPoints: 3214, // ← 랭킹 점수(목)
        levelSkills: [
          { level: 3, ratings: mapBy(L2, [70, 65, 60, 72, 58, 68]), attemptsCount: 3 },
          { level: 4, ratings: mapBy(L3, [72, 45, 58, 40, 57, 38]), attemptsCount: 5 }, // 잘함/평균/부족 섞이게(데모)
        ],
      }) }))

  // 허브/대시보드 공용 — 티어 히어로 + 활동 기록 달력(출석일). 이게 없으면 대시보드 잔디가 텅 빈다.
  //   ⚠️ attendanceDays 는 get-hub 가 daily_activity.did_attendance 로 채우는 실제 필드다(형태 바뀌면 여기도 수정).
  const thisMonth = '2026-07'
  await context.route('**/functions/v1/get-hub', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        authed: true, level: 4, tier: 'gold', percentile: 0.18,
        seasonTotal: 5100, skillScore: 4200, activityScore: 900, pointsToPass: 120,
        attendanceDays: [1, 2, 3, 6, 7, 10, 14, 15, 16, 20, 24, 27, 28, 29].map(
          (d) => `${thisMonth}-${String(d).padStart(2, '0')}`,
        ),
        points: 1200, dust: 30, cosmetics: [], baseKey: 'default', equipped: {},
        stamps: 3, pity: 0, dailyDone: true, learnDone: false, minigameDone: false, leveltestDone: false,
        // 허브 '초대하기' 모달 — get-hub 가 ensure_referral_code 로 채우는 실제 필드.
        //   referralUsed = 초대코드를 이미 등록했는지(true 면 입력칸이 영구 잠김).
        referralCode: 'CARIK7M2', referralUsed: false,
      }) }))

  // 리더보드(랭킹 화면) — 구버전(users)·신버전(top/me) 필드를 모두 담아 Before/After 둘 다 렌더되게.
  const lbNames = ['김에이아이', '이로보', '박프롬프트', '최데이터', '정모델', '한비전', '오엣지', '서로스', '윤피엘씨', '임데브']
  const lbColors = ['#a566e0', '#4aa0e8', '#3fb8ad', '#aeb9c8', '#b8763e', '#86efac', '#ff9bb0', '#c7a3ff', '#9fe0d8', '#ffd29b']
  const lbLevels = [7, 7, 6, 6, 6, 5, 5, 5, 4, 4]
  const lbRatings = [96, 92, 88, 85, 83, 80, 78, 75, 72, 70]
  // 집계 리더보드 목(지역·국가·학교) — 새 버킷 응답 { buckets, scope, window }. 탭마다 화면이 비지 않게.
  const regionBuckets = [
    { code: 'KR-11', member_count: 412, avg_level: 4.8, active_today: 173, participation: 0.42, score: 2.02 },
    { code: 'KR-41', member_count: 388, avg_level: 4.6, active_today: 151, participation: 0.39, score: 1.79 },
    { code: 'KR-26', member_count: 205, avg_level: 4.4, active_today: 72, participation: 0.35, score: 1.54 },
    { code: 'KR-28', member_count: 164, avg_level: 4.3, active_today: 51, participation: 0.31, score: 1.33 },
    { code: 'KR-30', member_count: 98, avg_level: 4.1, active_today: 27, participation: 0.28, score: 1.15 },
    { code: 'KR-27', member_count: 87, avg_level: 3.9, active_today: 21, participation: 0.24, score: 0.94 },
    { code: 'KR-50', member_count: 41, avg_level: 3.7, active_today: 8, participation: 0.2, score: 0.74 },
  ]
  const countryBuckets = [
    { code: 'KR', member_count: 1980, avg_level: 4.5, active_today: 612, participation: 0.31, score: 1.4 },
  ]
  const schoolBuckets = [
    { code: 'sch-001', label: '서울과학고등학교', member_count: 96, avg_level: 5.1, active_today: 48, participation: 0.5, score: 2.55 },
    { code: 'sch-002', label: '경기북과학고등학교', member_count: 72, avg_level: 4.9, active_today: 31, participation: 0.43, score: 2.11 },
    { code: 'sch-003', label: '대전동신과학고등학교', member_count: 58, avg_level: 4.6, active_today: 22, participation: 0.38, score: 1.75 },
    { code: 'sch-004', label: '부산일과학고등학교', member_count: 33, avg_level: 4.2, active_today: 11, participation: 0.33, score: 1.39 },
    { code: 'sch-005', label: '인천진산과학고등학교', member_count: 12, avg_level: 3.8, active_today: 4, participation: 0.33, score: 1.25 },
  ]
  await context.route('**/functions/v1/leaderboard', (r) => {
    let scope = 'global'
    let win = 'daily'
    try {
      const b = JSON.parse(r.request().postData() || '{}')
      if (b.scope) scope = b.scope
      if (b.window) win = b.window
    } catch { /* noop */ }
    if (scope === 'region' || scope === 'country' || scope === 'school') {
      const buckets = scope === 'region' ? regionBuckets : scope === 'country' ? countryBuckets : schoolBuckets
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ buckets, scope, window: win }) })
    }
    // 기본(개인/명예의 전당) — 구버전(users)·신버전(top/me) 필드를 모두 담아 Before/After 둘 다 렌더되게.
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({
        // 신버전(명예의 전당)
        top: lbNames.map((name, i) => ({
          rank: i + 1, name, level: lbLevels[i], rating: lbRatings[i], color: lbColors[i], image: null, me: false,
          // 칭호(자격증 트랙·급수) 샘플 — 실서버는 me 에만 부착하지만 데모는 상위 2행에 배지 렌더 예시.
          title: i === 0 ? 'CARIS Master 1급' : i === 1 ? 'CARIS Pro 2급' : null,
        })),
        // me.title/titles = user_titles(본인) 파생 배지(실서버 leaderboard fn 이 부착).
        me: { rank: 171, level: 3, rating: 14, name: '나 (Demo)', color: '#e3b23c', image: null, me: true,
          title: 'CARIS Pro 3급', titles: [{ track: 'Pro', grade: '3급', exam_title: 'CARIS Pro' }] },
        total: 980,
        // 구버전(리그 리스트) 호환 필드
        users: lbNames.slice(0, 6).map((name, i) => ({ name, rating: lbRatings[i], color: lbColors[i], me: i === 3 })),
        myRank: 4, myGlobalRank: 171, globalTotal: 980,
      }) })
  })

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
