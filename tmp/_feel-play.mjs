// 더듬어라 — 구역별 결과를 흉내내 log 를 만들고(도착은 clear() 호출) 서버 재채점과 대조. 언어별 넘침 검사도.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 860 } })
await page.goto('http://127.0.0.1:8124/games/feel-cari.html'); await page.waitForTimeout(300)
await page.evaluate(() => { window.__sub = null; window.MGBridge.submit = (v, o) => { window.__sub = { v, log: o && o.log } } })
await page.click('#startBtn'); await page.waitForTimeout(100)
for (let z = 0; z < 20; z++) {
  await page.click('#zGo'); await page.waitForTimeout(150)
  if (z === 3) { await page.evaluate(() => { batt = 0 }); await page.waitForTimeout(150); await page.click('#bnBtn'); await page.waitForTimeout(150) }   // 한 번 실패
  await page.evaluate((z) => { hits = z === 5 ? 1 : 0; clear() }, z); await page.waitForTimeout(150)
  await page.click('#bnBtn'); await page.waitForTimeout(150)
}
const sub = await page.evaluate(() => window.__sub)
const shown = await page.evaluate(() => ({ ttl: document.getElementById('oTtl').textContent, cleared: document.getElementById('oCleared').textContent, stars: document.getElementById('oLab').textContent }))
console.log('submitted', sub.v, 'log', sub.log.length, shown)
writeFileSync('tmp/_feel-log.json', JSON.stringify({ score: sub.v, log: sub.log }))
await page.close()
for (const lang of ['ko', 'en', 'ja', 'zh', 'hi', 'vi']) {
  const p2 = await browser.newPage({ viewport: { width: 360, height: 740 } })
  await p2.goto(`http://127.0.0.1:8124/games/feel-cari.html?lang=${lang}`); await p2.waitForTimeout(200)
  await p2.click('#startBtn'); await p2.click('#zGo'); await p2.waitForTimeout(200)
  const r = await p2.evaluate(() => [...document.querySelectorAll('.s .nt')].map((t) => t.scrollWidth > t.clientWidth + 1 ? t.textContent : '').filter(Boolean))
  const lg = await p2.evaluate(() => { const l = document.getElementById('legend'); return l.scrollHeight > l.clientHeight + 1 })
  console.log(lang, r.length ? 'OVERFLOW sensor ' + r.join(',') : 'fits', lg ? 'legend-wrap' : '')
  await p2.close()
}
await browser.close()
