// 더듬어라 20구역 검수 시트 — 벽을 재질 색으로 드러내고(검수용) 환경 칸·출발·도착·범례를 함께 찍는다.
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 460, height: 860 }, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:8124/games/feel-cari.html'); await page.waitForTimeout(300)
await page.evaluate(() => { window.MGBridge.submit = () => {} })
await page.click('#startBtn'); await page.waitForTimeout(100)
const n = await page.evaluate(() => LEVELS.length)
for (let i = 0; i < n; i++) {
  await page.evaluate((i) => { stop(); LI = i; $('brOv').classList.add('hidden'); loadLevel(); stop()
    // 검수용: 벽을 재질 색으로 그대로 보여준다
    let w = ''; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = grid[y][x]; if (MATCOL[c]) w += `<rect x="${x*CELL}" y="${y*CELL}" width="${CELL}" height="${CELL}" fill="${MATCOL[c]}" opacity=".85"/>` }
    $('gWall').innerHTML = w; $('gWall').setAttribute('opacity', '1') }, i)
  await page.waitForTimeout(120)
  const box = await page.evaluate(() => { const t = document.querySelector('.top').getBoundingClientRect(), v = document.getElementById('view').getBoundingClientRect(); return { x: 0, y: t.top - 4, width: 460, height: v.bottom - t.top + 6 } })
  await page.screenshot({ path: `tmp/_fz-${String(i + 1).padStart(2, '0')}.png`, clip: box })
}
await browser.close()
execSync('python tmp/_feel-sheets.py', { stdio: 'inherit' })
