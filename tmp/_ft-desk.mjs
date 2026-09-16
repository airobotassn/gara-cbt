import { chromium } from 'playwright'
const browser = await chromium.launch()
for (const [w, h, lang] of [[520, 720, 'ko'], [520, 640, 'ko'], [360, 640, 'ko'], [520, 900, 'ko'], [360, 740, 'en'], [520, 640, 'vi'], [320, 568, 'hi']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.goto(`http://127.0.0.1:8124/games/feel-cari.html?lang=${lang}`); await page.waitForTimeout(300)
  await page.evaluate(() => { window.MGBridge.submit = () => {} })
  await page.click('#startBtn'); await page.waitForTimeout(100)
  await page.evaluate(() => { $('brOv').classList.add('hidden'); loadLevel(); stop(); buildTable(); $('tblOv').classList.remove('hidden') })
  await page.waitForTimeout(150)
  const r = await page.evaluate(() => { const b = document.querySelector('#tblOv .tbody').getBoundingClientRect(), t = document.getElementById('stbl').getBoundingClientRect(), btn = document.getElementById('tblClose').getBoundingClientRect(), sh = document.querySelector('#tblOv .sheet').getBoundingClientRect(), h3 = document.querySelector('#tblOv h3').getBoundingClientRect()
    const fs = parseFloat(getComputedStyle(document.getElementById('stbl')).fontSize)
    const cells = [...document.querySelectorAll('#stbl td,#stbl th')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim())
    return { sheet: [Math.round(sh.width), Math.round(sh.height)], tbodyH: Math.round(b.height), need: Math.round(h3.height + 8 + t.height), fs: +fs.toFixed(2), K: +((t.height - 13) / fs).toFixed(2), over: t.bottom > btn.top + 0.5 || t.bottom > b.bottom + 0.5, cells } })
  console.log(w, h, lang, JSON.stringify(r))
  await page.screenshot({ path: `tmp/_ftd-${w}x${h}-${lang}.png` })
  await page.close()
}
await browser.close()
