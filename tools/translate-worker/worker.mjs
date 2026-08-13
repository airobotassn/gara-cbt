// 엣지 번역 워커 — 채팅을 미리 번역해 창고를 채운다.
//
//   왜 있나: Edge 브라우저의 온디바이스 번역은 **공짜에 무제한**이다(온디바이스라 MS 로 요청이
//   나가지 않는다 — 호출 횟수 제한도 과금도 없다). 이게 미리 채워두면 사용자가 번역을 눌렀을 때
//   창고 히트라 구글 API 가 안 불린다.
//
//   ⛔ 이 워커는 **판단하지 않는다.** '무엇을 번역할지'도 '무엇을 저장할지'도 전부 서버
//      (chat-translate 의 pending/store)가 정한다. 워커는 브라우저를 굴리는 손이다.
//      → 백엔드를 Spring 으로 옮겨도 이 파일은 손대지 않는다.
//
//   ⚠️ 죽어도 기능은 안 멈춘다. 창고가 덜 찰 뿐이고 사용자 요청은 서버가 구글 API 로 받는다.
//      그래서 24시간 켜둘 필요도 없다 — 꺼져 있는 동안 돈이 조금 나갈 뿐이다.
//
//   실행:
//     SUPABASE_URL=... SUPABASE_ANON_KEY=... TRANSLATE_WORKER_KEY=... node tools/translate-worker/worker.mjs
//
//   ⚠️ 프로필 폴더(--user-data-dir)를 고정하는 게 전제다. 안 하면 실행할 때마다 언어팩을
//      처음부터 다시 받는다. 그래서 일회성 CI 러너(GitHub Actions 등)에서는 못 돌린다.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROFILE_DIR = process.env.TRANSLATE_PROFILE_DIR ?? join(HERE, '.edge-profile')
const WARM_PAGE = 'file://' + join(HERE, 'warm.html').replace(/\\/g, '/')

const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY
const WORKER_KEY = process.env.TRANSLATE_WORKER_KEY
// 2초 — 채팅 폴링이 4초라 그 안에 끝나면 사용자가 새 글을 받아볼 때 이미 번역이 있다.
// 늘리면 새 글마다 사용자 요청이 먼저 닿아 구글 API 가 받는다(= 돈).
const TICK_MS = Number(process.env.TRANSLATE_TICK_MS ?? 2000)
const BATCH = Number(process.env.TRANSLATE_BATCH ?? 500)

if (!SUPABASE_URL || !ANON_KEY || !WORKER_KEY) {
  console.error('SUPABASE_URL / SUPABASE_ANON_KEY / TRANSLATE_WORKER_KEY 가 필요합니다.')
  process.exit(1)
}

async function callFn(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chat-translate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // verify_jwt 가 켜져 있으므로 게이트웨이를 통과할 JWT 가 필요하다. anon 키면 충분하고,
      // 실제 권한 판정은 함수 안의 x-translate-worker-key 가 한다(서비스 롤 키를 워커에 두지 않는다).
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'x-translate-worker-key': WORKER_KEY,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`${payload.action}: HTTP ${res.status} ${await res.text()}`)
  return await res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge', // ⚠️ 크롬(39개 언어) 말고 엣지(145개 이상)
    headless: false,   // 첫 언어팩 다운로드가 확실히 돌도록 창을 띄운 채 시작한다
    args: ['--no-first-run', '--no-default-browser-check'],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(WARM_PAGE)

  const ok = await page.evaluate(() => typeof Translator !== 'undefined')
  if (!ok) {
    console.error('이 브라우저에 Translator API 가 없습니다 — Edge 148+ 데스크톱이 필요합니다.')
    await ctx.close()
    process.exit(1)
  }
  console.log(`[worker] 시작. profile=${PROFILE_DIR} tick=${TICK_MS}ms`)

  let stopping = false
  process.on('SIGINT', () => { stopping = true })
  process.on('SIGTERM', () => { stopping = true })

  while (!stopping) {
    try {
      const { items: jobs } = await callFn({ action: 'pending', limit: BATCH })
      if (!jobs || jobs.length === 0) {
        await sleep(TICK_MS)
        continue
      }

      await page.evaluate((j) => { window.__jobs = j; window.__out = null }, jobs)
      // ⚠️ evaluate 가 아니라 click 이어야 한다 — 새 언어쌍의 첫 다운로드는 사용자 제스처를 요구한다.
      await page.click('#warm')
      const handle = await page.waitForFunction(() => window.__out !== null, null, { timeout: 180_000 })
      const out = await handle.jsonValue()

      if (out.items.length > 0) {
        const res = await callFn({ action: 'store', items: out.items })
        console.log(`[worker] ${res.stored}/${jobs.length} 저장`)
      } else {
        console.log(`[worker] ${jobs.length}건 중 저장할 것 없음`)
      }
      if (out.failedPairs?.length) console.log(`[worker] 미지원 쌍: ${out.failedPairs.join(', ')}`)
    } catch (e) {
      // 한 번 실패했다고 죽지 않는다 — 다음 tick 에 다시 시도한다.
      console.error('[worker]', e instanceof Error ? e.message : e)
      await sleep(TICK_MS * 5)
    }
  }

  await ctx.close()
  console.log('[worker] 종료')
}

main()
