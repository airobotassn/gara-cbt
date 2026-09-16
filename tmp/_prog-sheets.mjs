import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('tmp/prog-shots', { recursive: true })
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
await page.goto('http://127.0.0.1:8123/games/program-cari.html'); await page.waitForTimeout(200)
const g = (s) => page.$eval(s, (e) => e.textContent.trim())
console.log('empty hint:', await page.$eval('#program', (e) => getComputedStyle(e, '::before').content))
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.click('#startBtn'); await page.waitForTimeout(200)
const meta = []
for (let i = 0; i < 30; i++) {
  await page.evaluate((i) => { S.lv = i; loadLevel(); document.getElementById('takeaway').style.display='none' }, i)
  await page.waitForTimeout(150)
  await page.screenshot({ path: `tmp/prog-shots/L${String(i + 1).padStart(2, '0')}.png`, clip: { x: 40, y: 20, width: 380, height: 430 } })
  meta.push({ n: i + 1, name: await g('#lvName'), goal: (await g('#goalTxt')).replace('🎯 ', ''), slots: await g('#slotN'), runs: await page.evaluate(() => lv().runs) })
}
// 결과창(Stop 버튼)
await page.evaluate(() => { S.lv = 0; loadLevel(); S.prog = [{ op: 'MV' }, { op: 'MV' }, { op: 'MV' }, { op: 'MV' }]; renderProgram() })
await page.click('#runBtn'); await page.waitForFunction(() => !document.getElementById('resultOv').classList.contains('hidden'), null, { timeout: 10000 })
await page.screenshot({ path: 'tmp/_prog-result-en.png' })
writeFileSync('tmp/prog-shots/meta.json', JSON.stringify(meta))
console.log('errors', errors.length ? errors : 'none')
await browser.close()
