import { openBrowser, shot, go } from './manual-shots.mjs'
const { browser, page } = await openBrowser()
const try_ = async (label, fn) => { try { await fn() } catch (e) { console.log(`  ! ${label}:`, e.message.split('\n')[0].slice(0, 90)) } }

// 02 메인 — 검색어 입력 상태(엔터를 누르면 바로 목적지로 이동해버려서 '묻는 순간'을 담는다)
await go(page, '/', { wait: 3500 })
await page.locator('.lp-search-input').pressSequentially('AI 자격증 어떻게 따나요', { delay: 45 })
await shot(page, 2, '메인-검색으로-찾아가기')

// 17 러닝 라이브러리 - CARIS 탭
await go(page, '/ebooks', { wait: 3000 })
await try_('17', async () => {
  await page.getByRole('group').getByRole('button', { name: 'CARIS', exact: true }).click({ timeout: 5000 })
  await shot(page, 17, '러닝라이브러리-CARIS')
})

// 18 전체구매
await go(page, '/ebooks', { wait: 3000 })
await try_('18', async () => {
  await page.getByText('전체구매', { exact: false }).first().click({ timeout: 5000 })
  await shot(page, 18, '전체구매')
})

// 21 월드 아레나
await go(page, '/arena', { wait: 5000 })
await shot(page, 21, '월드아레나')

// 22 레벨 선택
await go(page, '/test/select', { wait: 3000 })
await shot(page, 22, '레벨-선택')

// 26 랭킹
await go(page, '/ranking', { wait: 4000 })
await shot(page, 26, '랭킹')

// 27 캐릭터 허브
await go(page, '/hub', { wait: 4000 })
await shot(page, 27, '캐릭터-허브')

// 30 꾸미기
await try_('30', async () => {
  await page.locator('.fcard.f-shop').click({ timeout: 5000 })
  await shot(page, 30, '꾸미기')
})

// 31 미니게임
await go(page, '/games', { wait: 3000 })
await shot(page, 31, '미니게임')

// 32 DAILY QUIZ
await go(page, '/daily', { wait: 3000 })
await shot(page, 32, 'daily-quiz')

// 34 1:1 문의
await go(page, '/mypage/inquiry', { wait: 3000 })
await shot(page, 34, '1대1-문의')

// 35 공지사항
await go(page, '/notice', { wait: 2600 })
await shot(page, 35, '공지사항')

// 36 자주 묻는 질문
await go(page, '/faq', { wait: 2600 })
await shot(page, 36, '자주-묻는-질문')

await browser.close()
