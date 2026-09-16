// 더듬어라 센서 표 — 6개국어 × 여러 화면에서 (1) 칸 하나라도 글이 넘치는지 (2) 표가 닫기 버튼 밑으로 들어가는지 잰다. 하나라도 걸리면 exit 1.
// 시트(tmp/_fe-table3.jpg)는 360×740 여섯 언어.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']
const VIEWS = [[360, 740], [520, 720], [520, 640], [390, 844], [320, 568]]
const browser = await chromium.launch()
let bad = 0
for (const [w, h] of VIEWS) for (const lang of LANGS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w === 360 ? 2 : 1 })
  await page.goto(`http://127.0.0.1:8124/games/feel-cari.html?lang=${lang}`); await page.waitForTimeout(250)
  await page.evaluate(() => { window.MGBridge.submit = () => {} })
  await page.click('#startBtn'); await page.waitForTimeout(80)
  await page.evaluate(() => { $('brOv').classList.add('hidden'); loadLevel(); stop(); buildTable(); $('tblOv').classList.remove('hidden') })
  await page.waitForTimeout(120)
  const r = await page.evaluate(() => {
    const body = document.querySelector('#tblOv .tbody').getBoundingClientRect(), tbl = document.getElementById('stbl'), t = tbl.getBoundingClientRect(), btn = document.getElementById('tblClose').getBoundingClientRect()
    const cells = [...tbl.querySelectorAll('td,th')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim())
    return { cells, under: t.bottom > btn.top + 0.5 || t.bottom > body.bottom + 0.5 || tbl.scrollWidth > tbl.clientWidth + 1, fs: getComputedStyle(tbl).fontSize }
  })
  const over = r.cells.length || r.under
  if (over) bad++
  console.log(`${w}x${h}`, lang, over ? 'OVER' : 'ok', r.fs, r.cells.join(' | '))
  if (w === 360 && h === 740) await page.screenshot({ path: `tmp/_ft-${lang}.png` })
  await page.close()
}
await browser.close()
execSync('python tmp/_feel-table-sheet.py', { stdio: 'inherit' })
if (bad) { console.error('OVERFLOW', bad); process.exit(1) }
