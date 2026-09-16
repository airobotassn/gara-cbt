import { chromium } from 'playwright'
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 400, height: 760 }, deviceScaleFactor: 2 })
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
for (const lang of ['en', 'ja', 'hi', 'vi']) {
  await page.goto(`http://127.0.0.1:8124/games/build-cari.html?lang=${lang}`); await page.waitForTimeout(200)
  await page.evaluate(() => { window.MGBridge.submit = () => {} })
  await page.screenshot({ path: `tmp/_bl-${lang}-intro.png` })
  await page.click('#btnStart')
  for (const i of [4, 16, 24, 25]) {
    await page.evaluate((i) => { window.LEVELS.forEach((L) => { L.tick = 30 }); window.__startLevel(i) }, i)
    await page.click('#btnRun'); await page.waitForFunction(() => !window.__stat().running); await page.waitForTimeout(300)
    await page.screenshot({ path: `tmp/_bl-${lang}-L${i + 1}.png`, clip: { x: 0, y: 0, width: 400, height: 200 } })
  }
  await page.evaluate(() => window.__startLevel(0))
  await page.evaluate(() => window.__place([[1,2,'conv',2],[2,2,'conv',2],[3,2,'conv',2],[4,2,'conv',2],[5,2,'conv',2],[6,2,'conv',2]]))
  await page.click('#btnRun'); await page.waitForFunction(() => !window.__stat().running); await page.waitForTimeout(400)
  await page.screenshot({ path: `tmp/_bl-${lang}-win.png` })
  await page.click('#btnNext'); await page.click('#btnTut'); await page.waitForTimeout(150)
  await page.screenshot({ path: `tmp/_bl-${lang}-tut.png`, clip: { x: 0, y: 0, width: 400, height: 200 } })
}
console.log('errors', errors.length ? errors : 'none')
await browser.close()
