// 지어라 30판 스크린샷 — 빈 판(플레이어가 보는 것) + 정답 배치. tmp/build-shots/L01.png · L01s.png
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
mkdirSync('tmp/build-shots', { recursive: true })
const SOL = JSON.parse(readFileSync('tests/fixtures/build-sol.json', 'utf8'))
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
const lang = process.argv[2] || 'ko'
await page.goto(`http://127.0.0.1:8124/games/build-cari.html?lang=${lang}`); await page.waitForTimeout(300)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.click('#btnStart'); await page.waitForTimeout(200)
const meta = []
for (let i = 0; i < 30; i++) {
  await page.evaluate((i) => { window.__startLevel(i) }, i)
  await page.waitForTimeout(120)
  await page.screenshot({ path: `tmp/build-shots/L${String(i + 1).padStart(2, '0')}.png` })
  await page.evaluate((t) => { window.__place(t) }, SOL[i])
  await page.waitForTimeout(80)
  await page.screenshot({ path: `tmp/build-shots/L${String(i + 1).padStart(2, '0')}s.png` })
  meta.push({ n: i + 1, name: await page.$eval('#lvlSub', (e) => e.textContent), goal: await page.$eval('#hintLine', (e) => e.textContent) })
}
writeFileSync('tmp/build-shots/meta.json', JSON.stringify(meta))
console.log('errors', errors.length ? errors : 'none')
await browser.close()
