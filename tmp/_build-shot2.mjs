import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const SOL = JSON.parse(readFileSync('tests/fixtures/build-sol.json', 'utf8'))
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
const lang = process.argv[2] || 'ko'
await page.goto(`http://127.0.0.1:8124/games/build-cari.html?lang=${lang}`); await page.waitForTimeout(200)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.screenshot({ path: `tmp/_build-intro-${lang}.png` })
await page.click('#btnStart')
await page.evaluate(() => { window.LEVELS.forEach((L) => { L.tick = 30 }); window.__startLevel(15) })
await page.click('#btnRun'); await page.waitForFunction(() => !window.__stat().running); await page.waitForTimeout(300)
await page.screenshot({ path: `tmp/_build-fail-${lang}.png` })
await page.evaluate((t) => window.__place(t), SOL[15]); await page.click('#btnRun'); await page.waitForFunction(() => !window.__stat().running); await page.waitForTimeout(500)
await page.screenshot({ path: `tmp/_build-win-${lang}.png` })
await page.click('#btnRetry'); await page.waitForTimeout(100)
await page.click('#btnStart'); await page.evaluate(() => { window.__startLevel(0) })
for (let i = 0; i < 3; i++) { await page.click('#btnRun'); await page.waitForFunction(() => !window.__stat().running); await page.waitForTimeout(300) }
await page.screenshot({ path: `tmp/_build-over-${lang}.png` })
await browser.close()
