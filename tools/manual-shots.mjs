// 사용설명서용 스크린샷 촬영 — docs/manual/shots/NN.이름.png
//   실행: node tools/manual-shots.mjs <그룹>   (그룹: intro caris library arena etc onboarding)
//   ⚠️ 세션은 스크래치패드의 session.json 을 쓴다(tools/_session.mjs 로 새로 발급). 레포에 토큰을 남기지 않는다.
import { chromium } from 'playwright'
import fs from 'node:fs'

const SP = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad'
export const BASE = 'http://localhost:5174'
export const OUT = 'docs/manual/shots'
const REF = 'lditytpxuuojfznwfnep'

export async function openBrowser({ authed = true } = {}) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  })
  const session = JSON.parse(fs.readFileSync(`${SP}/session.json`, 'utf8'))
  await ctx.addInitScript(({ ref, session, authed }) => {
    if (authed) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session))
    localStorage.setItem('lang', 'ko')
  }, { ref: REF, session, authed })
  const page = await ctx.newPage()
  return { browser, ctx, page }
}

// 화면 한 장. full:true 면 페이지 전체 세로.
export async function shot(page, no, name, { full = false, wait = 1800 } = {}) {
  await page.waitForTimeout(wait)
  const file = `${OUT}/${String(no).padStart(2, '0')}.${name}.png`
  await page.screenshot({ path: file, fullPage: full })
  console.log('  ✓', file)
}

export async function go(page, path, { wait = 2200 } = {}) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(wait)
}
