import { chromium } from 'playwright'
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:8123/games/program-cari.html'); await page.waitForTimeout(200)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.click('#btnTutIntro'); await page.waitForTimeout(200)
// 3라운드 4단계(×2 누르기)까지 진행
await page.evaluate(() => { tutRound = 2; loadTutRound() }); await page.waitForTimeout(100)
for (const op of ['LP', 'MV', 'CLOSE']) { await page.click(`.pbtn[data-op="${op}"]`); await page.waitForTimeout(80) }
await page.screenshot({ path: 'tmp/_tut-r3-s4.png' })
// 4라운드 2단계(조건 누른 직후)
await page.evaluate(() => { tutRound = 3; loadTutRound() }); await page.waitForTimeout(100)
await page.click('.pbtn[data-op="MV"]'); await page.waitForTimeout(80)
await page.screenshot({ path: 'tmp/_tut-r4-s2.png' })
await page.click('.pbtn[data-op="IF"]'); await page.waitForTimeout(80); await page.click('.pbtn[data-op="TR"]'); await page.waitForTimeout(80)
await page.screenshot({ path: 'tmp/_tut-r4-s3.png' })
await page.evaluate(() => { tutRound = 4; loadTutRound() }); await page.waitForTimeout(100)
for (const op of ['LP', 'IF', 'TR']) { await page.click(`.pbtn[data-op="${op}"]`); await page.waitForTimeout(80) }
await page.screenshot({ path: 'tmp/_tut-r5-s3.png' })
for (const op of ['CLOSE', 'MV', 'CLOSE']) { await page.click(`.pbtn[data-op="${op}"]`); await page.waitForTimeout(80) }
await page.screenshot({ path: 'tmp/_tut-r5-s7.png' })
await browser.close()
