import { test, expect, type Page } from '@playwright/test'

/**
 * 모바일 전면 반응형 검증.
 * - 주요 폰 폭에서 각 라우트를 열어 (1) 페이지 가로 오버플로 0 단언, (2) 스크린샷 저장.
 * - 가로 오버플로 = document.documentElement.scrollWidth > innerWidth.
 *   컨테이너 내부의 의도된 가로스크롤(잔디/엠블렘/아바타 스트립)은 페이지 폭에 영향을 주지 않으므로 통과해야 정상.
 * - 데이터/인증이 필요한 result·dashboard 는 가짜 세션 시드 + 함수 응답 목킹으로 풀 레이아웃을 렌더한다.
 */

const WIDTHS = [320, 360, 390, 414, 768]
const HEIGHT = 900
const SUPABASE_REF = 'jfvldoywvzvqhitcgalr'
const AXES = ['prompt', 'model', 'verify', 'automation', 'data', 'ethics'] as const

function axisMap(vals: number[]) {
  return Object.fromEntries(AXES.map((k, i) => [k, vals[i]]))
}

async function assertNoOverflow(page: Page, label: string) {
  // 레이아웃 안정화 대기
  await page.waitForTimeout(350)
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    // 어떤 요소가 뷰포트를 넘기는지 진단용으로 수집
    offenders: Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        return r.right > window.innerWidth + 1 && r.width > 0 && r.height > 0
      })
      .slice(0, 5)
      .map((el) => {
        const e = el as HTMLElement
        const r = e.getBoundingClientRect()
        return `${e.tagName.toLowerCase()}.${e.className?.toString().split(' ')[0] ?? ''} right=${Math.round(r.right)}`
      }),
  }))
  expect(
    m.scrollW,
    `${label}: 가로 오버플로 (scrollW=${m.scrollW} > innerW=${m.innerW}). 원인 후보: ${m.offenders.join(' | ')}`,
  ).toBeLessThanOrEqual(m.innerW + 1)
}

// ---- 공개(백엔드 불필요) 라우트 ----
const PUBLIC_ROUTES: { path: string; name: string }[] = [
  { path: '/', name: 'landing' },
  { path: '/test/select', name: 'levelselect' },
  { path: '/ranking', name: 'ranking' },
  { path: '/result/demo', name: 'result-locked' }, // 미인증 → 잠금 변형
]

for (const { path, name } of PUBLIC_ROUTES) {
  for (const w of WIDTHS) {
    test(`${name} @${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: HEIGHT })
      await page.goto(path, { waitUntil: 'networkidle' }).catch(() => {})
      await assertNoOverflow(page, `${name}@${w}`)
      await page.screenshot({ path: `tests/shots/${name}-${w}.png`, fullPage: true })
    })
  }
}

// ---- 인증/데이터 필요: 세션 시드 + 함수 목킹 ----
test.describe('authed (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    // 1) 가짜 정식 유저 세션을 localStorage 에 시드(supabase-js v2 키 형식)
    await page.addInitScript(
      ({ ref }) => {
        const future = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365
        const session = {
          access_token: 'fake-access',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: future,
          refresh_token: 'fake-refresh',
          user: {
            id: 'demo-user',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'demo@example.com',
            is_anonymous: false,
            app_metadata: { provider: 'google', providers: ['google'] },
            user_metadata: { full_name: 'Demo User' },
            identities: [
              { id: 'g1', user_id: 'demo-user', provider: 'google', identity_data: {} },
            ],
            created_at: '2020-01-01T00:00:00Z',
          },
        }
        localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
      },
      { ref: SUPABASE_REF },
    )

    // 2) supabase auth/REST 검증 호출이 세션을 비우지 않게 스텁
    await page.route('**/auth/v1/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'demo-user', is_anonymous: false }),
      }),
    )

    // 3) Edge Function 응답 목킹
    await page.route('**/functions/v1/get-result', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attemptId: 'demo',
          level: 3,
          totalCorrect: 7,
          totalQuestions: 10,
          locked: false,
          tierKey: 'gold',
          overall: 48,
          rating: axisMap([62, 55, 48, 66, 52, 58]),
          deltas: axisMap([3, -2, 5, 1, 0, 2]),
          tierAvg: axisMap([50, 50, 50, 50, 50, 50]),
          placed: true,
          answers: Array.from({ length: 10 }, (_, i) => ({
            questionId: `q${i}`,
            category: AXES[i % AXES.length],
            prompt: `샘플 문항 ${i + 1}: 생성형 AI 활용에 대한 비교적 긴 질문 텍스트로 줄바꿈을 검증합니다.`,
            options: ['선택지 A', '선택지 B', '선택지 C', '선택지 D'],
            selectedIndex: i % 4,
            correctIndex: (i + 1) % 4,
            isCorrect: i % 3 === 0,
            explanation: '해설 텍스트입니다. 좁은 화면에서 넘치지 않아야 합니다.',
          })),
        }),
      }),
    )

    await page.route('**/functions/v1/start-test', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attemptId: 'demo',
          level: 3,
          startedAt: '2026-06-12T10:00:00Z',
          questions: Array.from({ length: 20 }, (_, i) => ({
            id: `q${i}`,
            category: AXES[i % AXES.length],
            prompt: `문항 ${i + 1}: 생성형 AI를 활용해 업무를 자동화할 때 가장 적절한 접근은 무엇인가요? 비교적 긴 지문으로 좁은 화면에서의 줄바꿈을 검증합니다.`,
            options: [
              '첫 번째 선택지입니다',
              '두 번째 선택지는 조금 더 긴 텍스트로 작성됨',
              '세 번째 선택지',
              '네 번째 선택지 예시 텍스트',
            ],
          })),
        }),
      }),
    )

    await page.route('**/functions/v1/list-attempts', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          attempts: Array.from({ length: 6 }, (_, i) => ({
            attemptId: `a${i}`,
            level: 3,
            totalCorrect: 6 + (i % 4),
            totalQuestions: 10,
            tierKey: 'gold',
            overall: 40 + i * 2,
            deltas: axisMap([1, -1, 2, 0, 1, -1]),
            submittedAt: `2026-0${(i % 6) + 1}-15T10:00:00Z`,
          })),
          skill: {
            tierKey: 'gold',
            overall: 48,
            rating: axisMap([62, 55, 48, 66, 52, 58]),
            placed: true,
            attemptsCount: 6,
          },
        }),
      }),
    )
  })

  for (const { path, name } of [
    { path: '/result/demo', name: 'result-full' },
    { path: '/dashboard', name: 'dashboard' },
  ]) {
    for (const w of WIDTHS) {
      test(`${name} @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: HEIGHT })
        await page.goto(path, { waitUntil: 'networkidle' }).catch(() => {})
        await assertNoOverflow(page, `${name}@${w}`)
        await page.screenshot({ path: `tests/shots/${name}-${w}.png`, fullPage: true })
      })
    }
  }

  // 퀴즈 화면: 레벨 선택에서 start-test 목킹 후 진입 → 실제 .qbody 렌더
  for (const w of WIDTHS) {
    test(`test-quiz @${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: HEIGHT })
      await page.goto('/test/select', { waitUntil: 'networkidle' }).catch(() => {})
      await page.locator('button.step').first().click()
      await page.waitForSelector('.qbody', { timeout: 5000 })
      await assertNoOverflow(page, `test-quiz@${w}`)
      await page.screenshot({ path: `tests/shots/test-quiz-${w}.png`, fullPage: true })
    })
  }
})
