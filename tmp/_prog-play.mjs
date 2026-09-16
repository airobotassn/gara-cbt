import { chromium } from 'playwright'
import * as R from '../supabase/functions/_shared/minigame-replay.ts'
import { SOL } from './_prog-check.mjs'
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 460, height: 860 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://127.0.0.1:8123/games/program-cari.html'); await page.waitForTimeout(200)
await page.evaluate(() => { window.__subs = []; window.MGBridge.submit = (v, o) => { window.__subs.push({ score: v, log: o && o.log }) } })
const g = (s) => page.$eval(s, (e) => e.textContent.trim())
const waitResult = () => page.waitForFunction(() => !document.getElementById('resultOv').classList.contains('hidden'), null, { timeout: 30000 })
const setProg = (p) => page.evaluate((p) => { S.prog = p; openStack = []; buildPalette(); renderProgram() }, p)
await page.click('#startBtn'); await page.waitForTimeout(200)
// L1: 일부러 틀린 프로그램(왼쪽·앞 = 길 밖) → 실패, 실행 2번 남음
await setProg([{ op: 'TL' }, { op: 'MV' }])
await page.click('#runBtn'); await waitResult()
console.log('L1 fail:', await g('#resBadge'), '|', await g('#resMsg'), '| buttons:', await page.$$eval('#resRow .btn', (b) => b.map((x) => x.textContent).join(' / ')))
await page.click('#resRow .btn'); await page.waitForTimeout(200)
console.log('after fix&retry: runs =', await g('#runsEl'), '| prog kept =', await page.evaluate(() => S.prog.length))
// L1~L30 정답으로 클리어
for (let i = 0; i < 30; i++) {
  await setProg(SOL[i]); await page.click('#runBtn'); await waitResult()
  const badge = await g('#resBadge'); const btns = await page.$$eval('#resRow .btn', (b) => b.map((x) => x.textContent))
  if (i === 0 || i === 29) console.log(`L${i + 1}: ${badge} | ${await g('#resN')} | ${btns.join(' / ')}`)
  if (!badge.includes('성공') && !badge.includes('클리어')) { console.log(`L${i + 1} UNEXPECTED`, badge); break }
  if (i < 29) { await page.click('#resRow .btn'); await page.waitForTimeout(120) }
}
const subs = await page.evaluate(() => window.__subs)
const rep = R.replayProgram(subs.at(-1).log, 600)
console.log('30클리어: sent', subs.at(-1).score, 'entries', subs.at(-1).log.length, 'replay', JSON.stringify(rep))
// 실행 횟수 소진: 새 판, L1 에서 3번 실패
await page.click('#resRow .btn'); await page.waitForTimeout(150) // 처음으로 → 인트로
await page.click('#startBtn'); await page.waitForTimeout(150)
for (let k = 0; k < 3; k++) { await setProg([{ op: 'TL' }, { op: 'MV' }]); await page.click('#runBtn'); await waitResult()
  const b = await g('#resBadge'); if (k < 2) { await page.click('#resRow .btn'); await page.waitForTimeout(120) } else console.log('3번째 실패:', b, '|', await g('#resN'), '|', await page.$$eval('#resRow .btn', (x) => x.map((y) => y.textContent).join(' / '))) }
const subs2 = await page.evaluate(() => window.__subs)
console.log('소진 제출:', JSON.stringify({ score: subs2.at(-1).score, n: subs2.at(-1).log.length }), 'replay', JSON.stringify(R.replayProgram(subs2.at(-1).log, 600)))
// 그만두기: 다시 도전 → L1 클리어 → 그만두기
await page.click('#resRow .btn'); await page.waitForTimeout(150)
await setProg(SOL[0]); await page.click('#runBtn'); await waitResult()
await page.click('#resRow .btn:last-child'); await page.waitForTimeout(150)
console.log('그만두기:', await g('#resBadge'), '|', await g('#resN'), '| 제출', JSON.stringify({ score: (await page.evaluate(() => window.__subs.at(-1))).score }))
// 튜토리얼
await page.click('#resRow .btn:last-child'); await page.waitForTimeout(150) // 처음으로
await page.click('#btnTutIntro'); await page.waitForTimeout(200)
const tmsg = () => page.$eval('#tutMsg', (e) => e.textContent.slice(0, 28))
console.log('tut r1:', await g('#lvName'), '|', await tmsg(), '| enabled:', await page.$$eval('.pbtn', (b) => b.filter((x) => !x.disabled).map((x) => x.dataset.op).join(',')))
const tap = async (op) => { await page.click(`.pbtn[data-op="${op}"]`); await page.waitForTimeout(60) }
await tap('MV'); await tap('MV'); await tap('TL'); await tap('MV')
console.log('tut r1 step5:', await tmsg(), '| run marked:', await page.$eval('#runBtn', (e) => e.classList.contains('tut-on')))
await page.click('#runBtn'); await page.waitForTimeout(3500)
console.log('tut r2:', await g('#lvName'), '|', await tmsg())
await tap('MV'); await tap('PK'); await tap('MV'); await tap('MV'); await page.click('#runBtn'); await page.waitForTimeout(3500)
console.log('tut r3:', await g('#lvName'), '|', await tmsg())
await tap('LP'); await tap('MV'); await tap('CLOSE')
console.log('tut r3 step4:', await tmsg(), '| cnt marked:', await page.$eval('.slot .cnt', (e) => e.classList.contains('tut-on')))
await page.click('.slot .cnt'); await page.waitForTimeout(60); await page.click('.slot .cnt'); await page.waitForTimeout(60)
console.log('tut r3 step5:', await tmsg()); await page.click('#runBtn'); await page.waitForTimeout(4500)
console.log('tut r4:', await g('#lvName'), '|', await tmsg())
await tap('MV'); await tap('IF'); await tap('TR'); await tap('CLOSE'); await tap('MV')
console.log('tut r4 last:', await tmsg()); await page.click('#runBtn'); await page.waitForTimeout(3500)
console.log('tut r5:', await g('#lvName'), '|', await tmsg())
await tap('LP'); await tap('IF'); await tap('TR'); await tap('CLOSE'); await tap('MV'); await tap('CLOSE')
await page.click('.slot .cnt'); await page.waitForTimeout(60); await page.click('.slot .cnt'); await page.waitForTimeout(60)
console.log('tut r5 last:', await tmsg()); await page.click('#runBtn'); await page.waitForTimeout(5000)
console.log('tut end:', await g('#resBadge'), '|', await g('#resN'), '|', await page.$$eval('#resRow .btn', (x) => x.map((y) => y.textContent).join(' / ')))
await page.click('#resRow .btn'); await page.waitForTimeout(200)
console.log('after close: intro visible =', await page.$eval('#startOv', (e) => !e.classList.contains('hidden')), '| 제출 횟수', (await page.evaluate(() => window.__subs)).length)
await page.screenshot({ path: 'tmp/_prog-tut.png' })
console.log('errors', errors.length ? errors : 'none')
await browser.close()
