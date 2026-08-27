import { chromium } from 'playwright'
import fs from 'node:fs'
const SP = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad'
const BASE = 'http://localhost:5174'
const REF = 'lditytpxuuojfznwfnep'
const session = JSON.parse(fs.readFileSync(`${SP}/session.json`, 'utf8'))

const PATHS = [
  '/', '/login', '/guide', '/plan', '/exam', '/exam/apply', '/exam/check', '/exam/prepare',
  '/certificate', '/ebooks', '/mypage/ebooks', '/mypage/attempts', '/mypage/inquiry',
  '/arena', '/test/select', '/test/record', '/test/result/c0721d79-5a38-4da6-8bdb-9e6d00529664',
  '/ranking', '/hub', '/daily', '/games', '/games/beat-cari',
  '/notice', '/faq', '/terms',
  '/checkout?type=exam&ref=c855fa0f-ec4b-4c26-a246-dc32d74b51d6:beginner',
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' })
await ctx.addInitScript(({ ref, session }) => {
  localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
  localStorage.setItem('lang', 'ko')
}, { ref: REF, session })
const page = await ctx.newPage()
const errs = []
page.on('response', (r) => { if (r.url().includes('/functions/v1/') && r.status() >= 400) errs.push(`${r.status()} ${r.url().split('/functions/v1/')[1].split('?')[0]}`) })

for (const p of PATHS) {
  errs.length = 0
  try {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(2200)
  } catch (e) { console.log(`${p} :: NAV FAIL ${e.message.slice(0, 60)}`); continue }
  const url = page.url().replace(BASE, '')
  const txt = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 150)
  const redir = url.split('?')[0] !== p.split('?')[0] ? `  >>REDIR ${url}` : ''
  console.log(`${p}${redir}\n   ${txt}${errs.length ? `\n   ERR ${[...new Set(errs)].join(', ')}` : ''}`)
}
await browser.close()
