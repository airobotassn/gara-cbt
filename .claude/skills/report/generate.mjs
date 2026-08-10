// 변경 리포트 생성 — 로컬 서버 확인 → 화면별 촬영 → out/index.html
// 실행: node .claude/skills/report/generate.mjs   (report 스킬이 호출)
import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { URLS, META, SCREENS } from './config.mjs'
import { shoot } from './lib.mjs'
import { buildReport } from './template.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'out', 'index.html')
// 프로젝트 루트 = .claude/skills/report 에서 3단계 위
const ROOT = join(__dirname, '..', '..', '..')

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).status < 500 }
  catch { return false }
}

async function ensureLocal() {
  if (await reachable(URLS.local)) return null
  console.log('• dev 서버 기동 중…')
  const proc = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev'],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' })
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await reachable(URLS.local)) return proc
  }
  proc.kill(); throw new Error('dev 서버 기동 실패 — npm run dev 를 직접 띄워보세요')
}

async function main() {
  const devProc = await ensureLocal()

  const browser = await chromium.launch()
  const results = []
  try {
    for (const s of SCREENS) {
      console.log(`• ${s.title}`)
      const after = await shoot(browser, URLS.local, s)
      results.push({ after })
    }
  } finally {
    await browser.close()
    if (devProc) devProc.kill()
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, buildReport({ meta: META, dateStr, screens: SCREENS, results }), 'utf8')
  console.log(`\n✅ ${OUT}`)
}

main().catch((e) => { console.error('❌', e); process.exit(1) })
