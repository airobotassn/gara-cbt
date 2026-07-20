import { test, expect } from '@playwright/test'

/**
 * WORLD ARENA 백엔드 연동 검증.
 * 부모 프레임(WorldArena.tsx)이 leaderboard 함수 결과를 postMessage 로 주입하면,
 * 지도(public/world-arena.html)가 해당 지역을 평균 레벨/참여 인원으로 갱신하는지 확인한다.
 *   · 레벨0: 국가(M49 숫자 id → ISO alpha-2) 매핑 + REAL.country + valueFor + render.
 *   · 레벨1: 시도(southkorea-maps code → ISO 3166-2) 매핑 + REAL.region.
 * 실 DB 데이터 유무와 무관하게 주입 경로 자체를 검증(합성 payload).
 */
test('arena map applies backend leaderboard data via postMessage', async ({ page }) => {
  await page.goto('/world-arena.html?embed=1')
  await page.waitForFunction(() => document.querySelectorAll('#rank li').length > 0)

  // 부모가 보내는 same-origin 실데이터 메시지를 모사.
  await page.evaluate(() => {
    const payload = {
      country: [{ code: 'KR', level: 6.7, members: 4321 }],
      region: [{ code: 'KR-11', level: 5.5, members: 1234 }],
    }
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'arena:data', payload },
        origin: window.location.origin,
      }),
    )
  })

  // 레벨0 — 대한민국(유일한 드릴 대상)이 주입값 반영. 참여 4,321명은 목데이터로 나올 수 없는 정확한 신호.
  const krLi = page.locator('#rank li.drill')
  await expect(krLi.locator('.sc')).toHaveText('6.7')
  await expect(krLi.locator('.cnt')).toContainText('4,321')

  // 드릴다운 → 레벨1(대한민국 시도). 회전+페이드 애니 후 서울이 주입값 반영.
  await krLi.click()
  const seoul = page.locator('#rank li', { hasText: '서울특별시' })
  await expect(seoul).toBeVisible({ timeout: 6000 })
  await expect(seoul.locator('.sc')).toHaveText('5.5')
  await expect(seoul.locator('.cnt')).toContainText('1,234')
})

/**
 * 풀 경로 통합 검증: /arena 라우트(WorldArena.tsx) → leaderboard 함수 호출 → iframe 지도 주입.
 * leaderboard 함수 응답을 네트워크 레벨에서 목킹해, 부모가 실제로 fetch→postMessage 하는지 확인한다.
 */
test('arena route pipes leaderboard function response into the embedded map', async ({ page }) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  }
  await page.route('**/functions/v1/leaderboard', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
      return
    }
    const body = (req.postDataJSON() ?? {}) as { scope?: string }
    const buckets =
      body.scope === 'region'
        ? [{ code: 'KR-11', avg_level: 5.5, member_count: 1234 }]
        : body.scope === 'country'
          ? [{ code: 'KR', avg_level: 6.7, member_count: 4321 }]
          : []
    await route.fulfill({
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ buckets, scope: body.scope, window: 'season' }),
    })
  })

  await page.goto('/arena')
  const map = page.frameLocator('iframe[title="WORLD ARENA"]')
  const krLi = map.locator('#rank li.drill')
  await expect(krLi.locator('.sc')).toHaveText('6.7', { timeout: 10000 })
  await expect(krLi.locator('.cnt')).toContainText('4,321')
})
