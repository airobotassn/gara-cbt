// 막아라 헤드리스 플레이 — 50장을 정답대로 처리해 게임 점수와 log 를 받고, 서버 재채점과 대조한다.
//   node tmp/_block-play.mjs  →  tmp/_block-log.json  →  bun tmp/_block-play-check.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 860 } })
await page.goto('http://127.0.0.1:8124/games/block-cari.html'); await page.waitForTimeout(200)
await page.evaluate(() => { window.__sub = null; window.MGBridge.submit = (v, o) => { window.__sub = { v, log: o && o.log } } })
await page.click('#startBtn'); await page.waitForTimeout(100); await page.click('#dBtn'); await page.waitForTimeout(400)
let n = 0
while (true) {
  const st = await page.evaluate(() => ({ over: !document.getElementById('overOv').classList.contains('hidden'), day: !document.getElementById('dayOv').classList.contains('hidden') }))
  if (st.over) break
  if (st.day) { await page.click('#dBtn'); await page.waitForTimeout(400); continue }
  // 정답대로: 금지 서류면 반려, 아니면 활성 위반 조각만 가리고 전송. 일부러 3번째 서류는 무해까지 가려 보너스를 잃는다(점수 갈래 확인).
  await page.evaluate(() => {
    const d = DAYS[di].docs[qi]; const isB = d.block && activeBlock.has(d.block)
    if (!isB) document.querySelectorAll('.tk').forEach((t) => { if (activeMask.has(t.dataset.kind) || (qi === 2 && t.dataset.kind === 'd')) t.classList.add('mk') })
  })
  const isB = await page.evaluate(() => { const d = DAYS[di].docs[qi]; return !!(d.block && activeBlock.has(d.block)) })
  await page.click(isB ? '#rejBtn' : '#sendBtn'); await page.waitForTimeout(80)
  n++
  if (n === 1) await page.screenshot({ path: 'tmp/_block-first.png' })
  await page.click('#fbBtn'); await page.waitForTimeout(400)
}
const sub = await page.evaluate(() => window.__sub)
const shown = await page.evaluate(() => ({ score: document.getElementById('oScore').textContent, title: document.getElementById('oTtl').textContent, day: document.getElementById('oDay').textContent, perf: document.getElementById('oPerf').textContent }))
await page.screenshot({ path: 'tmp/_block-clear.png' })
console.log('docs', n, 'submitted', sub && sub.v, 'log', sub && sub.log && sub.log.length, shown)
writeFileSync('tmp/_block-log.json', JSON.stringify({ score: sub.v, log: sub.log }))

// 해고 경로 — 세 번 반려 실수
await page.click('#againBtn'); await page.waitForTimeout(100); await page.click('#dBtn'); await page.waitForTimeout(400)
for (let i = 0; i < 3; i++) { await page.click('#rejBtn'); await page.waitForTimeout(80); if (i < 2) { await page.click('#fbBtn'); await page.waitForTimeout(400) } }
await page.screenshot({ path: 'tmp/_block-fired-verdict.png' })
await page.click('#fbBtn'); await page.waitForTimeout(400)
const sub2 = await page.evaluate(() => window.__sub)
const shown2 = await page.evaluate(() => ({ title: document.getElementById('oTtl').textContent, score: document.getElementById('oScore').textContent, over: !document.getElementById('overOv').classList.contains('hidden') }))
console.log('fired', shown2, 'log', sub2.log.length, JSON.stringify(sub2.log))
await page.screenshot({ path: 'tmp/_block-fired.png' })
await browser.close()
