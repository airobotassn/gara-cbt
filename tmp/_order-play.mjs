// 시켜라 헤드리스 — 정답 fixture 로 20주문 통과(3번째 주문은 일부러 두 번 틀림) → log 를 서버 재채점과 대조. 언어별 카드 문구 넘침도 잰다.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const SOL = JSON.parse(readFileSync('tests/fixtures/order-sol.json', 'utf8'))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 860 } })
await page.goto('http://127.0.0.1:8124/games/order-cari.html'); await page.waitForTimeout(300)
await page.evaluate(() => { window.__sub = null; window.MGBridge.submit = (v, o) => { window.__sub = { v, log: o && o.log, tieMs: o && o.timed } } })
await page.click('#startBtn'); await page.waitForTimeout(100)
const pick = async (arr) => page.evaluate((arr) => { picked = new Set(arr); document.querySelectorAll('.pc').forEach((b, i) => b.classList.toggle('on', picked.has(i))); renderCount(); if (state === 'fail') { state = 'pick'; clearVerdict() } }, arr)
for (let o = 0; o < 20; o++) {
  if (o === 2) { for (let k = 0; k < 2; k++) { await pick([1]); await page.click('#sendBtn'); await page.waitForTimeout(1300) } }
  await pick(SOL[o]); await page.click('#sendBtn'); await page.waitForTimeout(1300)
  const st = await page.evaluate(() => state); if (st !== 'ok') { console.error('order', o + 1, 'not ok', st); process.exit(1) }
  await page.click('#sendBtn'); await page.waitForTimeout(250)
}
const sub = await page.evaluate(() => window.__sub)
const shown = await page.evaluate(() => ({ ttl: document.getElementById('oTtl').textContent, cleared: document.getElementById('oCleared').textContent, stars: document.getElementById('oStarLab').textContent }))
console.log('submitted', sub.v, 'log', sub.log.length, shown)
writeFileSync('tmp/_order-log.json', JSON.stringify({ score: sub.v, log: sub.log }))
// 그만두기 경로 — 첫 주문만 깨고 그만
await page.click('#oAgain'); await page.waitForTimeout(200)
await pick(SOL[0]); await page.click('#sendBtn'); await page.waitForTimeout(1300)
await page.click('#quitBtn'); await page.waitForTimeout(200)
const sub2 = await page.evaluate(() => window.__sub); console.log('quit:', sub2.v, sub2.log.length, await page.evaluate(() => document.getElementById('oTtl').textContent))
await page.close()
// 언어별 카드 문구 넘침
for (const lang of ['ko', 'en', 'ja', 'zh', 'hi', 'vi']) {
  const p2 = await browser.newPage({ viewport: { width: 360, height: 740 } })
  await p2.goto(`http://127.0.0.1:8124/games/order-cari.html?lang=${lang}`); await p2.waitForTimeout(200)
  await p2.click('#startBtn')
  const over = []
  for (let o = 0; o < 20; o++) {
    await p2.evaluate((o) => { LI = o; loadLevel() }, o); await p2.waitForTimeout(40)
    const r = await p2.evaluate(() => [...document.querySelectorAll('.pc .txt')].map((t, i) => t.scrollHeight > t.clientHeight + 1 ? i + 1 : 0).filter(Boolean))
    if (r.length) over.push(`L${o + 1}:${r.join(',')}`)
    const say = await p2.evaluate(() => { const s = document.getElementById('custSay'); return s.scrollHeight > s.clientHeight + 1 })
    if (say) over.push(`L${o + 1}:say`)
  }
  console.log(lang, over.length ? 'OVERFLOW ' + over.join(' ') : 'fits')
  await p2.close()
}
await browser.close()
