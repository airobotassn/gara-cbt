import { openBrowser, shot, go, BASE } from './manual-shots.mjs'
import fs from 'node:fs'
const SP = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad'
const KEY = JSON.parse(fs.readFileSync(`${SP}/answers.json`, 'utf8'))
const { browser, page } = await openBrowser()
page.on('pageerror', (e) => console.log('  PAGEERR', e.message.slice(0, 120)))

// 11 응시 준비 (1단계)
await go(page, '/exam/prepare', { wait: 3000 })
await shot(page, 11, '응시-준비')

// 준비 단계 넘기기 → 시작
for (let i = 0; i < 12; i++) {
  const cb = page.locator('input[type=checkbox]')
  if (await cb.count()) { for (let k = 0; k < await cb.count(); k++) await cb.nth(k).check({ force: true }).catch(() => {}) }
  const btn = page.locator('.exam-btn:not([disabled])').last()
  if (!(await btn.count())) break
  await btn.click().catch(() => {})
  await page.waitForTimeout(900)
  if (page.url().includes('/exam/run/')) break
}
await page.waitForTimeout(3500)
console.log('  현재 URL:', page.url().replace(BASE, ''))
if (!page.url().includes('/exam/run/')) {
  console.log('  ! 응시 시작 실패 —', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300))
  await browser.close(); process.exit(1)
}

// 앞 몇 문항만 풀어둔 '진행 중' 상태로 응시 화면 촬영
for (let i = 0; i < 6; i++) {
  await page.keyboard.press(String((KEY[i]?.ci ?? 0) + 1))
  await page.waitForTimeout(120)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(120)
}
await page.waitForTimeout(900)
await shot(page, 12, '응시-화면')

// 나머지 정답 입력 (문항 7~40)
for (let i = 6; i < KEY.length; i++) {
  await page.keyboard.press(String((KEY[i]?.ci ?? 0) + 1))
  await page.waitForTimeout(70)
  if (i < KEY.length - 1) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(70) }
}
await page.waitForTimeout(600)
console.log('  마킹 완료:', (await page.locator('body').innerText()).match(/(\d+)\s*\/\s*40/)?.[0] ?? '?')

// 제출
await page.getByRole('button', { name: /제출/ }).last().click()
await page.waitForTimeout(1200)
const confirm = page.getByRole('button', { name: /제출|확인/ }).last()
if (await confirm.count()) await confirm.click().catch(() => {})
await page.waitForTimeout(5000)
console.log('  제출 후 URL:', page.url().replace(BASE, ''))
await shot(page, 13, '시험-결과')
await browser.close()
