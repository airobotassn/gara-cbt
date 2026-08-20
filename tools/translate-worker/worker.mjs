// 엣지 번역 워커 — 채팅을 미리 번역해 창고를 채운다.
//
//   왜 있나: Edge 브라우저의 온디바이스 번역은 **공짜에 무제한**이다(온디바이스라 MS 로 요청이
//   나가지 않는다 — 호출 횟수 제한도 과금도 없다). 이게 미리 채워두면 사용자가 번역을 눌렀을 때
//   창고 히트라 즉시 뜬다. **번역하는 건 이 워커뿐이다** — 서버에 번역 엔진이 없다.
//
//   ⛔ 이 워커는 **판단하지 않는다.** '무엇을 번역할지'도 '무엇을 저장할지'도 전부 서버
//      (chat-translate 의 pending/store)가 정한다. 워커는 브라우저를 굴리는 손이다.
//      → 백엔드를 Spring 으로 옮겨도 이 파일은 손대지 않는다.
//
//   ⚠️ 꺼져 있으면 새 번역이 안 생긴다. 이미 창고에 있는 건 계속 보이고, 없는 건 원문으로 남는다
//      (오류는 안 난다 — 채팅 자체는 정상이다).
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
// 1초 — 채팅 폴링이 4초고 프론트 재시도가 1.5초부터라 그 안에 잡히게 한다.
// 늘리면 첫 요청자가 재시도(1.5초·3초)를 다 쓰고도 못 받아 원문으로 남는다. 공짜라 아낄 이유가 없다.
const TICK_MS = Number(process.env.TRANSLATE_TICK_MS ?? 1000)
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
  // ⚠️ **Playwright 기본 실행 인자 두 개가 온디바이스 AI 를 죽인다**(2026-08-13 실측).
  //     ① --disable-features=...,Translate,OptimizationHints,...  → 감지기가 'unavailable'
  //     ② --disable-component-update                              → **번역 모델이 'unavailable'**
  //    ②가 진짜 범인이다 — 모델을 배달하는 게 컴포넌트 업데이터라, 이걸 막으면 API 는 있는데
  //    모든 언어쌍이 unavailable 이고 워커가 "저장할 것 없음" 만 조용히 반복한다.
  //    ⚠️ 이 문자열은 Playwright 버전에 따라 바뀔 수 있다. 바뀌면 다시 unavailable 이 되므로
  //       **부팅 로그의 가용성 값**을 먼저 볼 것(아래에서 찍는다).
  const PW_DISABLE_FEATURES =
    '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,' +
    'DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,' +
    'MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,' +
    'OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion'

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'msedge', // ⚠️ 크롬(39개 언어) 말고 엣지(145개 이상)
    headless: false,   // 첫 언어팩 다운로드가 확실히 돌도록 창을 띄운 채 시작한다
    ignoreDefaultArgs: [PW_DISABLE_FEATURES, '--disable-component-update'],
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
  // ⚠️ API 가 있어도 **모델이 없으면** 번역이 한 건도 안 된다(그러면 "저장할 것 없음" 만 계속 찍힌다).
  //    조용히 헛도는 걸 막으려고 부팅 때 한 번 확인해서 알려준다.
  const avail = await page.evaluate(async () => ({
    detector: await LanguageDetector.availability().catch(() => 'error'),
    sample: await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ko' }).catch(() => 'error'),
  }))
  console.log(`[worker] 모델 가용성 — 감지기 ${avail.detector} / 번역기(en>ko) ${avail.sample}`)
  if (avail.sample === 'unavailable') {
    console.error('[worker] ⚠️ 번역 모델이 없습니다. Playwright 기본 인자가 바뀌어 위 ignoreDefaultArgs 가 안 먹었을 수 있습니다.')
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
      // ⚠️ waitForFunction 이 돌려주는 핸들은 **조건식의 결과**(여기선 true)지 window.__out 이 아니다.
      //    결과는 따로 꺼내와야 한다 — 핸들을 그대로 쓰면 out 이 true 가 되어 out.items 에서 터진다.
      await page.waitForFunction(() => window.__out !== null, null, { timeout: 180_000 })
      const out = await page.evaluate(() => window.__out)

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
