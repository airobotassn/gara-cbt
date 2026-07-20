import { test, expect } from '@playwright/test'

/**
 * WORLD ARENA UI 기능 검증: 6개국어 현지화 · 확대/축소 · 홈 국가 정렬.
 */

test('map localizes UI chrome and country names to ?lang', async ({ page }) => {
  await page.goto('/world-arena.html?embed=1&lang=en')
  await page.waitForFunction(() => document.querySelectorAll('#rank li').length > 0)

  await expect(page.locator('.legend')).toContainText('Avg. level')
  await expect(page.locator('#q')).toHaveAttribute('placeholder', 'Search region…')
  // Intl.DisplayNames 로 국가명 현지화 — 대한민국(드릴 대상) 항목이 영어명.
  await expect(page.locator('#rank li.drill b')).toContainText('South Korea')
})

test('zoom controls change the map scale', async ({ page }) => {
  await page.goto('/world-arena.html?embed=1')
  await page.waitForFunction(() => document.querySelectorAll('#rank li').length > 0)

  const readK = () =>
    page.evaluate(
      () => (document.getElementById('map') as unknown as { __zoom?: { k: number } })?.__zoom?.k ?? 1,
    )

  const k0 = await readK()
  await page.click('#zin')
  await page.waitForTimeout(320)
  const k1 = await readK()
  expect(k1).toBeGreaterThan(k0)

  await page.click('#zreset')
  await page.waitForTimeout(320)
  const k2 = await readK()
  expect(k2).toBeCloseTo(1, 1)
})

test('home country drives the globe center + "our rank" panel', async ({ page }) => {
  await page.goto('/world-arena.html?embed=1&lang=en')
  await page.waitForFunction(() => document.querySelectorAll('#rank li').length > 0)

  await page.evaluate(() => {
    const payload = { home: 'JP', country: [{ code: 'JP', level: 6.0, members: 900 }], region: [] }
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'arena:data', payload }, origin: window.location.origin }),
    )
  })

  // 홈=JP → 우리 순위 카드가 일본을 가리킨다(정렬은 지구본 회전으로 시각 반영).
  await expect(page.locator('#ourRank .or-n')).toContainText('Japan')
})

test('dokdo inset shows the two islets on the Korea map only', async ({ page }) => {
  await page.goto('/world-arena.html?embed=1&lang=ko')
  await page.waitForFunction(() => document.querySelectorAll('#rank li').length > 0)
  // 지구본(레벨0): 확대도 숨김
  await expect(page.locator('#dokinset')).toBeHidden()
  // 전국(레벨1) 드릴 → 확대도 표시 + 서도·동도 2개 폴리곤
  await page.click('#rank li.drill')
  await expect(page.locator('#dokinset')).toBeVisible({ timeout: 6000 })
  await expect(page.locator('#dokmap path')).toHaveCount(2)
  await expect(page.locator('#doklab')).toHaveText('독도')
})
