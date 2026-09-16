// 막아라 50장 검수 시트 — 서류마다 "정답 상태"를 찍는다:
//   위반 조각 = 빨강 밑줄(가려야 함) · 핵심 = 초록(가리면 안 됨) · 무해 = 회색 · 금지 서류 = 반려 도장
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 900 }, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:8124/games/block-cari.html'); await page.waitForTimeout(200)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.addStyleTag({ content: `
  .paper.in{animation:none}
  .tk{border-bottom-width:3px;border-bottom-style:solid}
  .tk.v{background:rgba(224,60,45,.18);border-bottom-color:#c0392b}
  .tk[data-kind=k]{background:rgba(40,160,90,.14);border-bottom-color:#2e7d4f}
  .tk[data-kind=d]{background:rgba(120,120,120,.10);border-bottom-color:#9a9a9a}
  .tk.f{background:rgba(120,90,200,.14);border-bottom-color:#7a5cc9}
  .verdict{opacity:.8}
`})
await page.click('#startBtn'); await page.waitForTimeout(100)
await page.click('#dBtn'); await page.waitForTimeout(300)
const n = await page.evaluate(() => DAYS.map(D => D.docs.length))
const files = []
for (let day = 0; day < n.length; day++) {
  for (let doc = 0; doc < n[day]; doc++) {
    await page.evaluate(({ day, doc }) => {
      activeMask = new Set(); activeBlock = new Set()
      for (let i = 0; i <= day; i++) { DAYS[i].newMask.forEach(k => activeMask.add(k)); DAYS[i].newBlock.forEach(k => activeBlock.add(k)) }
      di = day; qi = doc; strikes = 0; renderBook(); loadDoc()
      document.getElementById('stamps').classList.remove('judged')
      const d = DAYS[day].docs[doc]; const isB = d.block && activeBlock.has(d.block)
      document.querySelectorAll('.tk').forEach(t => {
        const k = t.dataset.kind
        if (activeMask.has(k)) t.classList.add('v')
        else if (k !== 'k' && k !== 'd') t.classList.add('f')   // 아직 규정에 없는 종류(있으면 안 된다)
      })
      const v = VERDICT; v.className = 'verdict on ' + (isB ? 'rej' : 'pass')
      document.getElementById('vTtl').textContent = isB ? '반려' : '전송'
      document.getElementById('vPt').textContent = ''
    }, { day, doc })
    await page.waitForTimeout(120)
    const box = await page.evaluate(() => {
      const b = document.querySelector('.book').getBoundingClientRect(), p = document.getElementById('paper').getBoundingClientRect()
      return { x: 0, y: b.top - 4, width: 460, height: p.bottom - b.top + 8 }
    })
    const f = `tmp/_bd-${day + 1}-${doc + 1}.png`; files.push(f)
    await page.screenshot({ path: f, clip: box })
  }
}
await browser.close()
execSync('python tmp/_block-sheets.py', { stdio: 'inherit' })
