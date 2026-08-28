// 사용설명서용 자격증(인증서) 한 장 — docs/manual/shots/14.자격증.png
//   실행: node tools/shots-cert.mjs [주소]   (기본 = 라이브)
//
// ⛔ **로컬(localhost)에서 뽑지 말 것.** 증서의 QR 은 `window.location.origin + /verify/<토큰>` 을
//    그대로 굽는다 — 로컬에서 뽑으면 QR 안에 `http://localhost` 가 박혀 **폰으로 찍으면 안 열린다**
//    (2026-08-26 에 그렇게 한 장 뽑았다). 라이브 주소로 렌더해야 스캔이 실제로 동작한다.
//
// 왜 이렇게 뽑나:
//   · 실제 발급본이 DB에 0건이라 캡처할 원본이 없다. 화면을 렌더해서 뽑는다.
//   · `/certificate/sample` 은 대각선 '견본' 워터마크가 깔려 설명서에 쓸 수 없고,
//     `/certificate`(개발 폴백)는 워터마크가 없지만 이름이 실제 사람 이름이다.
//     → 워터마크 없는 쪽을 열고, **이름·번호만** 견본값(홍길동)으로 DOM에서 갈아끼운다.
//   · 비로그인으로 연다 — 로그인 세션이 있으면 그 계정 이름이 DOM에 실린다.
//   ⚠️ QR 은 `preview-sample` 토큰이라 스캔해도 진위확인이 안 된다(설명서용 그림이라 그대로 둔다).
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://gara-cbt.airobotassn.workers.dev'
const OUT = 'docs/manual/shots/14.자격증.png'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1100 },
  deviceScaleFactor: 2,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
})
const page = await ctx.newPage()

// ① 견본 화면에서 앱이 쓰는 예시 인물·번호를 그대로 읽어온다(값을 여기 베껴 적지 않는다).
// ⚠️ 칸은 **data-f 로 집는다** — 순서(nth)로 집으면 증서 서식이 바뀌어 칸이 늘거나 줄 때
//    조용히 엉뚱한 자리에 값이 박힌다(v3 서식에서 '급수 전체명' 칸이 하나 늘었다).
await page.goto(`${BASE}/certificate/sample`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const pick = (f) => page.locator(`.cert-svg [data-f="${f}"]`).first().textContent()
const sample = { name: await pick('name'), certNo: await pick('no') }
console.log('견본값:', JSON.stringify(sample))

// ② 워터마크 없는 증서를 열고 이름·번호만 견본값으로 교체.
await page.goto(`${BASE}/certificate`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.evaluate(({ name, certNo }) => {
  const set = (f, v) => { const el = document.querySelector(`.cert-svg [data-f="${f}"]`); if (el) el.textContent = v }
  set('name', name)   // ① 영문 성명
  set('no', certNo)   // ④ Certificate ID
}, sample)
await page.waitForTimeout(400)

await page.locator('.cert-canvas').screenshot({ path: OUT })
console.log('✓', OUT)
await browser.close()
