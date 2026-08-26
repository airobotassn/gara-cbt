import { openBrowser, shot, go } from './manual-shots.mjs'
const { browser, page } = await openBrowser()
const errs = []
page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)))

// 01 메인
await go(page, '/', { wait: 3500 })
await shot(page, 1, '메인화면')

// 02 메인 검색
await page.locator('.lp-search-input').fill('AI 자격증 어떻게 따나요')
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(3000)
await shot(page, 2, '메인-검색으로-찾아가기')

// 03 로그인
await go(page, '/login')
await shot(page, 3, '로그인')

// 06 자격검정 안내
await go(page, '/guide', { wait: 3000 })
await shot(page, 6, '자격검정-안내')

// 07 시험 일정
await go(page, '/plan', { wait: 2600 })
await shot(page, 7, '시험일정과-원서접수')

// 08 원서접수
await go(page, '/exam/apply', { wait: 3000 })
await shot(page, 8, '원서접수')

// 10 시험환경 점검
await go(page, '/exam/check', { wait: 2600 })
await shot(page, 10, '시험환경-점검')

// 16 러닝 라이브러리 - LEVELTEST
await go(page, '/ebooks', { wait: 3200 })
await shot(page, 16, '러닝라이브러리-레벨테스트')

// 17 러닝 라이브러리 - CARIS
try {
  await page.getByRole('button', { name: 'CARIS', exact: true }).click({ timeout: 4000 })
  await page.waitForTimeout(1800)
  await shot(page, 17, '러닝라이브러리-CARIS')
} catch (e) { console.log('  ! 17 CARIS 탭 실패:', e.message.slice(0, 80)) }

console.log(errs.length ? `PAGE ERRORS: ${[...new Set(errs)].slice(0,3).join(' | ')}` : 'no page errors')
await browser.close()
