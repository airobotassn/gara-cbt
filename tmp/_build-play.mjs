// 지어라 헤드리스 플레이 — 실패(횟수 남음: 화면 유지) → 횟수 소진(게임오버 콘솔) → 새 판에서 30레벨 정답으로 전부 클리어 → 기록을 서버 재채점(bun) → 튜토리얼 3라운드.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const SOL = JSON.parse(readFileSync('tests/fixtures/build-sol.json', 'utf8'))
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 460, height: 860 } })
const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
let sent = []
await page.exposeFunction('__sent', (m) => sent.push(m))
await page.goto('http://127.0.0.1:8124/games/build-cari.html'); await page.waitForTimeout(200)
// 부모 대신 postMessage 를 가로챈다(단독 열기라 EMBED=false → post 가 안 나간다). MGBridge.submit 을 직접 후킹.
await page.evaluate(() => { window.MGBridge.submit = (v, o) => window.__sent({ score: v, log: o && o.log }) })
await page.evaluate(() => { document.documentElement.style.setProperty('--tk', '0ms') })
const stat = () => page.evaluate(() => window.__stat())
const finished = () => page.evaluate(() => window.__finished())
const hint = () => page.$eval('#hintLine', (e) => e.textContent)
async function runAndWait() {
  await page.click('#btnRun')
  // 틱 500ms 기본 — 테스트용으로 타이머를 빠르게 돌린다
  await page.waitForFunction(() => !window.__stat().running, null, { timeout: 60000 })
  await page.waitForTimeout(450)
}
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.error('FAIL', m) } else console.log('ok', m) }

await page.click('#btnStart')
// 1) 빈 판으로 가동 → 실패, 화면은 그대로(콘솔 안 뜸), 가동 2번 남음
await page.evaluate(() => { document.documentElement.style.setProperty('--tk', '0ms') })
await page.evaluate(() => { window.LEVELS.forEach((L) => { L.tick = 30 }) })
await page.evaluate(() => window.__startLevel(0))
await runAndWait()
ok(!(await finished()), '실패(횟수 남음) → 결과 콘솔이 안 뜬다')
ok((await stat()).runsLeft === 2, '가동 횟수 2 남음')
await runAndWait(); await runAndWait()
ok(await finished(), '횟수 소진 → 콘솔')
ok(await page.$eval('#resBadge', (e) => e.className.includes('lose')), '게임오버 배지')
ok(sent.length === 1 && sent[0].score === 0, '횟수 소진 시 기록 제출(0레벨)')
// 처음으로 → 인트로
await page.click('#btnRetry'); await page.waitForTimeout(100)
ok(!(await page.$eval('#ovStart', (e) => e.classList.contains('hide'))), '처음으로 → 인트로')
// 2) 30레벨 전부 정답으로
sent = []
await page.click('#btnStart')
await page.evaluate(() => { window.LEVELS.forEach((L) => { L.tick = 30 }) })
await page.evaluate(() => window.__startLevel(0))
for (let i = 0; i < 30; i++) {
  await page.evaluate((t) => window.__place(t), SOL[i])
  await runAndWait()
  const won = await page.evaluate(() => window.__won())
  ok(await finished() && won, `L${i + 1} 클리어 콘솔`)
  if (i < 29) { await page.click('#btnNext'); await page.waitForTimeout(60) }
}
const log = await page.evaluate(() => window.S.log)
ok(log.length === 30, '기록 30레벨')
ok(sent.length === 1 && sent[0].score === 30 && Array.isArray(sent[0].log) && sent[0].log.length === 30, '전부 클리어 시 제출 1회(30 + log)')
writeFileSync('tmp/_build-play-log.json', JSON.stringify(log))
// 3) 그만두기 — 2레벨 깨고 그만두면 2 제출
sent = []
await page.click('#btnNext'); await page.waitForTimeout(100)   // 처음으로
await page.click('#btnStart'); await page.evaluate(() => { window.LEVELS.forEach((L) => { L.tick = 30 }); window.__startLevel(0) })
for (let i = 0; i < 2; i++) { await page.evaluate((t) => window.__place(t), SOL[i]); await runAndWait(); if (i < 1) { await page.click('#btnNext'); await page.waitForTimeout(60) } }
ok(await page.$eval('#btnRetry', (e) => e.classList.contains('asquit') && !e.hidden), '클리어 콘솔의 ↻ 자리 = 그만두기')
await page.click('#btnRetry'); await page.waitForTimeout(100)
ok(sent.length === 1 && sent[0].score === 2 && sent[0].log.length === 2, '그만두기 → 2레벨 제출')
// 4) 튜토리얼 3라운드
await page.click('#btnTutIntro'); await page.waitForTimeout(150)
const tutRound = async (steps) => {
  for (const s of steps) {
    if (s.cell) await page.click(`.cell[data-r="${s.cell[0]}"][data-c="${s.cell[1]}"]`)
    else if (s.tool) await page.click(`.tool[data-tool="${s.tool}"]`)
    else if (s.run) { await page.click('#btnRun'); await page.waitForFunction(() => !window.__stat().running, null, { timeout: 20000 }); await page.waitForTimeout(1800) }
    await page.waitForTimeout(40)
  }
}
const TUT = await page.evaluate(() => { window.TUT_ROUNDS.forEach((r) => { r.level.tick = 30 }); return JSON.parse(JSON.stringify(window.TUT_ROUNDS)) })
ok(TUT.length === 3, '튜토리얼 3라운드 노출')
for (let r = 0; r < TUT.length; r++) {
  await tutRound(TUT[r].steps)
}
ok(await finished() && (await page.$eval('#resBadge', (e) => e.textContent)).includes('끝'), '튜토리얼 끝 콘솔')
console.log('errors', errors.length ? errors : 'none')
await browser.close()
if (fail) { console.error(`${fail} failed`); process.exit(1) }
