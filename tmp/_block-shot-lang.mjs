// 막아라 언어별 화면 — 인트로 · 1일차 브리핑 · 서류(유출 판정) · 10일차 규정집 · 결과
import { chromium } from 'playwright'
const browser = await chromium.launch()
const lang = process.argv[2] || 'en'
const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
await page.goto(`http://127.0.0.1:8124/games/block-cari.html?lang=${lang}`); await page.waitForTimeout(250)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.screenshot({ path: `tmp/_bl-${lang}-intro.png` })
await page.click('#startBtn'); await page.waitForTimeout(150)
await page.screenshot({ path: `tmp/_bl-${lang}-day.png` })
await page.click('#dBtn'); await page.waitForTimeout(400)
await page.click('#sendBtn'); await page.waitForTimeout(600)
await page.screenshot({ path: `tmp/_bl-${lang}-leak.png` })
await page.evaluate(() => { activeMask = new Set(); activeBlock = new Set(); for (let i = 0; i < 10; i++) { DAYS[i].newMask.forEach(k => activeMask.add(k)); DAYS[i].newBlock.forEach(k => activeBlock.add(k)) } di = 9; qi = 2; renderBook(); loadDoc(); document.getElementById('stamps').classList.remove('judged') })
await page.waitForTimeout(400); await page.click('#rejBtn'); await page.waitForTimeout(600)
await page.screenshot({ path: `tmp/_bl-${lang}-d10.png` })
await page.evaluate(() => { strikes = 3 }); await page.click('#fbBtn'); await page.waitForTimeout(400)
await page.screenshot({ path: `tmp/_bl-${lang}-over.png` })
await browser.close(); console.log('ok', lang)
