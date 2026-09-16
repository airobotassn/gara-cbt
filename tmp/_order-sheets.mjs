// 시켜라 20주문 검수 시트 — 도면 + 손님 말 + 카드 전부(정답 카드 ✓ 켬 · 함정은 붉은 테).
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 1500 }, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:8124/games/order-cari.html'); await page.waitForTimeout(300)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.addStyleTag({ content: `.pc.trap{filter:drop-shadow(0 0 3px #ff5a4a) drop-shadow(0 0 8px rgba(255,90,74,.8))} .pc.trap .txt{color:#b8281c}
  .stage.pick{height:200px} .scroll{overflow:visible} #app{height:auto;min-height:100%}` })
await page.click('#startBtn'); await page.waitForTimeout(200)
const n = await page.evaluate(() => LEVELS.length)
for (let i = 0; i < n; i++) {
  await page.evaluate((i) => { LI = i; loadLevel()
    const L = LEVELS[i]; L.cards.forEach((c, j) => { const b = document.querySelectorAll('.pc')[j]; if (c.bad) b.classList.add('trap'); else if (Object.keys(c.set).length) { picked.add(j); b.classList.add('on') } }); renderCount() }, i)
  await page.waitForTimeout(150)
  const box = await page.evaluate(() => { const t = document.querySelector('.top').getBoundingClientRect(), s = document.querySelector('.scroll').getBoundingClientRect(); return { x: 0, y: t.top - 4, width: 460, height: s.bottom - t.top + 8 } })
  await page.screenshot({ path: `tmp/_od-L${String(i + 1).padStart(2, '0')}.png`, clip: box })
}
await browser.close()
execSync('python tmp/_order-sheets.py', { stdio: 'inherit' })
