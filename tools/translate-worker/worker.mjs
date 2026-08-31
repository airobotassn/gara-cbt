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
//   실행: SUPABASE_URL=… SUPABASE_ANON_KEY=… TRANSLATE_WORKER_KEY=… node tools/translate-worker/worker.mjs
//
//   ⚠️ **사람이 브라우저를 켜지 않는다.** Playwright 가 Edge 를 직접 띄운다. 서버가 부팅되면
//      이 프로세스만 뜨면 되고(작업 스케줄러·systemd), 브라우저는 코드가 알아서 켠다.
//   ⚠️ 기본이 headless 다 — 로그인 세션이 없는 서버에서도 떠야 하기 때문이다(실측: headless 에서도
//      번역된다). 눈으로 보고 싶으면 TRANSLATE_HEADED=1.
//   ⚠️ **브라우저가 죽으면 프로세스를 끝낸다.** 살아있는 척 헛도는 게 죽는 것보다 나쁘다 —
//      감시자가 "돌고 있네" 하고 안 건드리기 때문이다. 종료하면 감시자가 새로 띄운다.
//
//   ⚠️ 프로필 폴더(--user-data-dir)를 고정하는 게 전제다. 안 하면 실행할 때마다 언어팩을
//      처음부터 다시 받는다. 그래서 일회성 CI 러너(GitHub Actions 등)에서는 못 돌린다.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
// ⛔ **프로필은 저장소 밖에 둔다.** 안에 두면 Vite 개발서버의 파일 감시자가 이 폴더를 지켜보다가
//    브라우저가 잠근 파일(Network/Cookies 등)에서 EBUSY 로 죽는다 — 개발서버가 통째로 못 뜬다.
//    수 GB 짜리 언어팩이 소스 트리에 쌓이는 것도 곤란하다(.gitignore 로 가리는 건 그다음 문제다).
// ⚠️ **브라우저는 바꿔 낄 수 있어야 한다(2026-08-27).** 엣지가 번역기를 못 받는 상태에 빠질 수 있고
//    (실제로 8/24 엣지 업데이트 뒤 그렇게 됐다 — 모델 런타임을 요청조차 안 한다), 그러면 번역이
//    통째로 멈추는데 **오류가 안 나서 아무도 모른다.** 크롬은 같은 코드로 정상 동작한다.
//     · 엣지  = 145개 언어. 기본값이고 이게 정상일 때 제일 좋다.
//     · 크롬  = 39개 언어. 엣지가 못 받을 때의 대피로.
//    ⚠️ 프로필은 **채널마다 따로** 둔다 — 언어팩이 브라우저별로 다른 자리에 쌓이고, 한 폴더를
//       두 브라우저가 번갈아 쓰면 프로필이 상한다.
const CHANNEL = process.env.TRANSLATE_CHANNEL ?? 'msedge'
const PROFILE_DIR =
  process.env.TRANSLATE_PROFILE_DIR ??
  join(homedir(), 'AppData', 'Local', `gara-translate-profile${CHANNEL === 'msedge' ? '' : '-' + CHANNEL}`)
const WARM_PAGE = 'file://' + join(HERE, 'warm.html').replace(/\\/g, '/')

const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY = process.env.SUPABASE_ANON_KEY
const WORKER_KEY = process.env.TRANSLATE_WORKER_KEY
// 1초 — 채팅 폴링이 4초고 프론트 재시도가 1.5초부터라 그 안에 잡히게 한다.
// 늘리면 첫 요청자가 재시도(1.5초·3초)를 다 쓰고도 못 받아 원문으로 남는다. 공짜라 아낄 이유가 없다.
const HEADED = process.env.TRANSLATE_HEADED === '1'
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
    channel: CHANNEL, // 기본 엣지(145개 언어). 엣지가 번역기를 못 받으면 TRANSLATE_CHANNEL=chrome
    headless: !HEADED, // 서버(세션 없음)에서도 떠야 한다. 눈으로 보려면 TRANSLATE_HEADED=1
    ignoreDefaultArgs: [PW_DISABLE_FEATURES, '--disable-component-update'],
    // TRANSLATE_DEBUG=1 이면 브라우저 내부 로그를 프로필 폴더의 chrome_debug.log 에 남긴다.
    //  · 번역기가 안 받아질 때 **여기서만** 이유가 보인다(컴포넌트 등록·다운로드·설치 로그).
    //  · 평소엔 끈다 — 로그가 계속 커지고 워커는 몇 달씩 돈다.
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      ...(process.env.TRANSLATE_DEBUG === '1' ? ['--enable-logging', '--v=1'] : []),
    ],
  })
  // 브라우저가 죽으면(크래시·강제 종료) 여기서 잡아 프로세스를 끝낸다.
  let browserDead = false
  ctx.on('close', () => { browserDead = true })

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
  console.log(`[worker] ${CHANNEL} · 모델 가용성 — 감지기 ${avail.detector} / 번역기(en>ko) ${avail.sample}`)

  // ⛔ **가용성만 믿으면 안 된다(2026-08-27).** 엣지는 모델이 하나도 없는 상태에서도 'downloadable'
  //    (= 받을 수 있다)이라고 답하는데, 정작 create() 를 부르면 요청을 **아예 안 보내고** 오류도 없이
  //    영원히 매달린다. 그러면 워커는 3분 타임아웃만 반복하며 살아있는 척 헛돈다 — 8/21~8/27 에
  //    실제로 그렇게 엿새를 흘렸고, 오류가 안 나니 아무도 몰랐다.
  //    그래서 **부팅할 때 진짜로 한 줄 번역해 본다.** 여기서 못 하면 이 워커는 앞으로도 못 한다.
  if (avail.sample !== 'available') {
    console.log('[worker] 모델이 아직 없습니다. 실제로 받아지는지 확인합니다(최대 90초)…')
    const probe = await page.evaluate(async () => {
      try {
        const t = await Promise.race([
          Translator.create({ sourceLanguage: 'en', targetLanguage: 'ko' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('시간 초과')), 90_000)),
        ])
        return { ok: true, text: await t.translate('Hello') }
      } catch (e) {
        return { ok: false, why: e?.name === 'Error' ? e.message : `${e?.name}: ${e?.message ?? e}` }
      }
    })
    if (probe.ok) {
      console.log(`[worker] 모델 확보 — 시험 번역 "${probe.text}"`)
    } else {
      console.error(`[worker] ⛔ 이 브라우저(${CHANNEL})는 번역기를 받지 못합니다: ${probe.why}`)
      console.error('[worker] ⛔ 이대로 두면 번역이 한 건도 안 되면서 오류도 안 납니다.')
      console.error("[worker] ⛔ 대피로: TRANSLATE_CHANNEL=chrome 으로 다시 띄우십시오(언어 39개).")
      if (process.env.TRANSLATE_STRICT === '1') process.exit(1)
    }
  }
  console.log(`[worker] 시작. profile=${PROFILE_DIR} tick=${TICK_MS}ms`)

  let stopping = false
  process.on('SIGINT', () => { stopping = true })
  process.on('SIGTERM', () => { stopping = true })

  while (!stopping) {
    if (browserDead || page.isClosed()) {
      console.error('[worker] 브라우저가 죽었습니다. 프로세스를 종료합니다 — 감시자가 다시 띄웁니다.')
      process.exit(1)
    }
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

      let res = null
      if (out.items.length > 0) {
        res = await callFn({ action: 'store', items: out.items })
        console.log(`[worker] ${res.stored}/${jobs.length} 저장`)
      } else {
        console.log(`[worker] ${jobs.length}건 중 저장할 것 없음`)
      }
      if (out.failedPairs?.length) console.log(`[worker] 미지원 쌍: ${out.failedPairs.join(', ')}`)
      // ⚠️ 브라우저 안에서 난 오류는 페이지 밖으로 안 나온다 — 여기서 꺼내 찍는다.
      //    안 그러면 "저장할 것 없음" 만 보이고 왜 안 됐는지 영영 모른다.
      if (out.log && (!res || res.stored < jobs.length)) {
        console.log(`[worker] 브라우저 로그:
${out.log.trim()}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // ⚠️ 브라우저가 닫힌 뒤의 오류는 재시도해도 영원히 같은 오류다 — 그때는 끝내야 한다.
      //    네트워크 오류처럼 회복 가능한 것만 다음 tick 에 다시 시도한다.
      if (browserDead || page.isClosed() || /Target (page|closed)|browser has been closed|Target closed/i.test(msg)) {
        console.error('[worker] 브라우저 연결이 끊겼습니다:', msg)
        process.exit(1)
      }
      console.error('[worker]', msg)
      await sleep(TICK_MS * 5)
    }
  }

  await ctx.close()
  console.log('[worker] 종료')
}

main()
