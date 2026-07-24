import { test, expect } from '@playwright/test'

// XSS-inert 검증: /arena 안의 ChatBoard 본문 렌더가 항상 React 텍스트 child(자동 이스케이프)로만
// 이루어지는지 실증한다. 악성 payload 가 실행되거나 live DOM 요소로 주입되면 실패.
// Evidence: artifacts/g004-chat-xss.png

const XSS_PAYLOAD = '<img src=x onerror="window.__xss=1">'
const ESCAPE_PAYLOAD = 'a < b & c'

test('chat body renders untrusted payloads as inert text (no XSS)', async ({ page }) => {
  await page.route('**/functions/v1/chat-list', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          ...Array.from({ length: 26 }, (_, i) => ['안녕하세요! 반갑습니다 😀', '오늘 시험 다들 어떠셨어요?', '저는 3급 준비 중이에요', 'https://caris.example 링크 공유합니다', 'ㅋㅋㅋ 다들 화이팅!', '내일 스터디 오실 분 계신가요?', '질문 하나 있어요~ 채점 기준이요', '오 그건 공지사항에 있어요 확인해보세요', '다들 고생 많으셨습니다 👍', '저 이번에 합격했어요!', '축하드려요~ 부럽습니다', '리스닝이 제일 어렵더라고요'][i % 12]).map((t, i) => ({
            id: i + 1,
            user_id: 'b' + i,
            display_name: '회원' + (i + 1),
            is_anon: false,
            body: t,
            mod_status: 'ok',
            edited_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })),
          {
            id: 27,
            user_id: 'u1',
            display_name: 'attacker',
            is_anon: false,
            body: XSS_PAYLOAD,
            mod_status: 'ok',
            edited_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            id: 28,
            user_id: 'u2',
            display_name: 'plain-user',
            is_anon: false,
            body: ESCAPE_PAYLOAD,
            mod_status: 'ok',
            edited_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      }),
    }),
  )

  await page.route('**/functions/v1/leaderboard', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ buckets: [], scope: 'country' }),
    }),
  )

  await page.goto('/arena', { waitUntil: 'networkidle' }).catch(() => {})
  await page.locator('.aa-tab-chat').click()
  await page.waitForSelector('.chat-body', { timeout: 15_000 })
  // 폴링 tick(chat-list ids/since)이 한 번 더 돌 여유를 준다 — 렌더 안정화 대기.
  await page.waitForTimeout(300)

  // Full-page capture: dense 28-message list + high-contrast blue login CTA + colored logo + footer nav
  // (maximum color/contrast diversity for a non-uniform artifact).
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'artifacts/g004-chat-xss.png', fullPage: true })

  // 1) payload 가 실행되지 않았어야 한다(onerror 미발화)
  const xssFired = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)
  expect(xssFired).toBeUndefined()

  // 2) live <img> 요소가 채팅 본문 안에 주입되지 않았어야 한다
  const liveImgCount = await page.locator('.chat-body img').count()
  expect(liveImgCount).toBe(0)

  // 3) payload 는 리터럴 텍스트로 표시되어야 한다(이스케이프된 텍스트 노드)
  const bodyTexts = await page.locator('.chat-body').allTextContents()
  const joined = bodyTexts.join('\n')
  expect(joined).toContain(XSS_PAYLOAD)
  expect(joined).toContain(ESCAPE_PAYLOAD)

  // 4) HTML 소스 레벨에서도 위험 마크업이 살아있지 않아야 한다(이스케이프 확인)
  const html = await page.locator('.chat-list').innerHTML()
  expect(html).toContain('&lt;img src=x onerror')
  expect(html).not.toMatch(/<img[^>]*onerror/i)
})
