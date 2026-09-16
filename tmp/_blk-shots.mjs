import { chromium } from 'playwright'
import { LEVELS } from './_prog-design2.mjs'
const browser = await chromium.launch()
for (const lang of ['ko', 'en', 'ja']) {
  const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
  await page.goto(`http://127.0.0.1:8123/games/program-cari.html?lang=${lang}`); await page.waitForTimeout(200)
  await page.evaluate(() => { window.MGBridge.submit = () => {} }); await page.click('#startBtn'); await page.waitForTimeout(150)
  for (const [n, i] of [[30, 29], [24, 23], [28, 27]]) {
    await page.evaluate(({ i, prog }) => { S.lv = i; loadLevel(); S.prog = prog; openStack = []; buildPalette(); renderProgram() }, { i, prog: LEVELS[i].sol })
    await page.waitForTimeout(100)
    await page.screenshot({ path: `tmp/_blk-${lang}-L${n}.png`, clip: { x: 40, y: 530, width: 380, height: 120 } })
  }
  await page.close()
}
await browser.close(); console.log('ok')
