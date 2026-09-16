// 막아라 판정 도장 시안 — 6장면 스크린샷 (8124 = public/ 정적 서버)
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:8124/games/block-cari.html'); await page.waitForTimeout(200)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.click('#startBtn'); await page.waitForTimeout(100)
await page.click('#dBtn'); await page.waitForTimeout(400)

// 특정 일차·서류로 점프 (규정 누적 포함)
async function jump(day, doc) {
  await page.evaluate(({ day, doc }) => {
    activeMask = new Set(); activeBlock = new Set()
    for (let i = 0; i <= day; i++) { DAYS[i].newMask.forEach(k => activeMask.add(k)); DAYS[i].newBlock.forEach(k => activeBlock.add(k)) }
    di = day; qi = doc; strikes = 0; renderBook(); loadDoc()
    document.getElementById('verdict').classList.remove('on'); document.getElementById('stamps').classList.remove('judged')
  }, { day, doc })
  await page.waitForTimeout(400)
}
async function mark(kinds) {
  await page.evaluate((kinds) => { document.querySelectorAll('.tk').forEach(t => { if (kinds.includes(t.dataset.kind)) t.classList.add('mk') }) }, kinds)
}
async function shot(name) { await page.waitForTimeout(700); await page.screenshot({ path: `tmp/_bv-${name}.png` }) }

await jump(0, 0); await mark(['name']); await page.click('#sendBtn'); await shot('1-pass')
await jump(0, 0); await page.click('#sendBtn'); await shot('2-leak')
await jump(0, 0); await mark(['name', 'k']); await page.click('#sendBtn'); await shot('3-over')
await jump(0, 1); await page.click('#rejBtn'); await shot('4-rejwrong')
await jump(3, 0); await page.click('#sendBtn'); await shot('5-blocksent')
await jump(3, 0); await page.click('#rejBtn'); await shot('6-rejok')
await browser.close(); console.log('ok')
