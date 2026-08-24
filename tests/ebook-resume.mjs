// 이북 번역 '이어받기' 실동작 확인 — **개발 서버가 떠 있어야 돈다**(그래서 test:db 에 안 넣었다).
//   실행: npm run dev 를 띄운 뒤 `node tests/ebook-resume.mjs http://localhost:5173`
//
// 왜 이런 모양이냐 — 이어받기 판정이 DOM 파싱(DOMParser·TreeWalker)을 쓰는데 이 저장소 테스트
// 러너에는 DOM 이 없다. 그래서 진짜 브라우저를 띄우고 Vite 가 서빙하는 **진짜 모듈**을 import 해
// translateEbook() 을 그대로 호출한다. Gemini 는 안 부른다 — translate-ebook 함수 호출을 가로채
// 가짜 번역을 돌려주고 일부 조각만 일부러 실패시킨다(번역 한도 소모 0).
//
// 보는 것 셋:
//   · 1차 — 실패 조각은 원문(한국어)으로 남고, 실패 번호가 기록되나
//   · 2차 — **실패했던 것만** 다시 묻고, 이미 번역된 자리는 그대로 살아 있나
//   · 3차 — 원본이 바뀌면(문단 하나 추가) 이어받기를 **통째로 버리고** 전부 다시 묻나
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5174'
const results = []
const rec = (name, got, want) =>
  results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) })

// 본문 12조각(한글 포함) — 그중 3개를 '모델 오류'로 실패시킨다.
const FRAGMENTS = Array.from({ length: 12 }, (_, i) => `${i + 1}. 한국어 조각 ${i + 1}번입니다`)
const FAIL_AT = new Set([2, 5, 9]) // 0-based 본문 조각 번호
const SRC = `<!doctype html><html><body><div>${FRAGMENTS.map((t) => `<p>${t}</p>`).join('')}</div></body></html>`
const META = { title: '한국어 책 제목', author: '지은이', description: '소개 문장입니다' }

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })

// 요청마다 무엇을 물어봤는지 기록한다.
const asked = []
await ctx.route('**/functions/v1/translate-ebook', async (route) => {
  const body = route.request().postDataJSON()
  const texts = body.texts ?? []
  asked.push(texts)
  const results = texts.map((t) => {
    const idx = FRAGMENTS.indexOf(t)
    if (idx >= 0 && FAIL_AT.has(idx)) return { error: '모델항목누락' }
    return { tr: Object.fromEntries(body.langs.map((l) => [l, `[${l}] ${t}`])) }
  })
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) })
})

const pg = await ctx.newPage()
pg.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 160)) })
await pg.goto(BASE, { waitUntil: 'domcontentloaded' })
await pg.waitForTimeout(1500)

// ── 1차: 아무것도 없이 전체 번역 ──────────────────────────────
const first = await pg.evaluate(async ({ src, meta }) => {
  const m = await import('/src/lib/ebookTranslate.ts')
  const out = await m.translateEbook(src, meta, m.EBOOK_LANGS)
  return out.map((r) => ({ lang: r.lang, html: r.html, meta: r.meta, failed: r.failed, failedIdx: r.failedIdx }))
}, { src: SRC, meta: META })

const askedFirst = asked.flat().length
asked.length = 0

rec('1차: 실패 조각 수 = 3', first[0].failed, 3)
rec('1차: 실패 번호가 맞다', first[0].failedIdx, [...FAIL_AT].sort((a, b) => a - b))
rec('1차: 5개 언어가 다 나온다', first.length, 5)
// 성공 조각은 번역문이, 실패 조각은 한국어 원문이 남아야 한다.
rec('1차: 성공 조각은 번역됨', first[0].html.includes('[en] 1. 한국어 조각 1번입니다'), true)
rec('1차: 실패 조각은 원문 유지', first[0].html.includes('3. 한국어 조각 3번입니다'), true)

// ── 2차: 1차 결과를 재료로 이어받기 ───────────────────────────
// ⚠️ 메타(제목·지은이·소개)는 재료에 없다 — 이어받지 않고 늘 다시 번역한다(폼에서 그냥 고칠 수 있어서).
const resume = {
  html: Object.fromEntries(first.map((r) => [r.lang, r.html])),
  failedIdx: first[0].failedIdx,
}
const second = await pg.evaluate(async ({ src, meta, resume }) => {
  const m = await import('/src/lib/ebookTranslate.ts')
  const out = await m.translateEbook(src, meta, m.EBOOK_LANGS, undefined, resume)
  return out.map((r) => ({ lang: r.lang, html: r.html, failed: r.failed, failedIdx: r.failedIdx }))
}, { src: SRC, meta: META, resume })

const askedSecond = asked.flat()
asked.length = 0

// ⭐ 핵심 — 두 번째 실행은 **실패했던 3조각만** 물어봐야 한다(1차는 메타 3 + 본문 12 = 15).
// 실패했던 본문 3조각 + 메타 3개(제목·지은이·소개)만 물어야 한다.
const WANT2 = [...[...FAIL_AT].map((i) => FRAGMENTS[i]), META.title, META.author, META.description].sort()
rec('⭐ 2차는 실패한 본문 + 메타만 묻는다', [...new Set(askedSecond)].sort(), WANT2)
// ⭐ 제목을 고치고 이어받으면 **새 제목**을 물어야 한다(옛 번역 제목을 재사용하면 조용히 틀린다).
rec('⭐ 메타는 이어받지 않는다(제목이 요청에 들어 있다)', askedSecond.includes(META.title), true)
// 사다리(120→12→4)가 실패분을 두 번 더 묻는다 — 15(1회차) + 3 + 3 = 21.
rec('1차에 물어본 조각 수(사다리 재시도 포함)', askedFirst, 21)
// 본문 3 + 메타 3 = 6 을 1회차에 묻고, 실패하는 본문 3개만 사다리 2단계를 더 탄다 → 6 + 3 + 3 = 12.
rec('2차에 물어본 조각 수', askedSecond.length, 12)
rec('2차: 이미 번역된 조각이 그대로 살아 있다', second[0].html.includes('[en] 1. 한국어 조각 1번입니다'), true)
rec('2차: 실패했던 조각도 이번엔 채워졌다', second[0].html.includes('[en] 3. 한국어 조각 3번입니다'), false)

// ── 3차: 원본이 바뀌면 이어받기를 포기해야 한다 ────────────────
const CHANGED = SRC.replace('<div>', '<div><p>맨 앞에 끼어든 새 문단입니다</p>')
const third = await pg.evaluate(async ({ src, meta, resume }) => {
  const m = await import('/src/lib/ebookTranslate.ts')
  const out = await m.translateEbook(src, meta, m.EBOOK_LANGS, undefined, resume)
  return out.map((r) => ({ lang: r.lang, failed: r.failed }))
}, { src: CHANGED, meta: META, resume })
const askedThird = asked.flat()

// 조각이 13개로 늘었으니 개수가 안 맞아 이어받기를 버리고 전부 다시 물어봐야 한다.
rec('⭐ 원본이 바뀌면 이어받기를 버린다(전부 다시 묻는다)', askedThird.length >= 13, true)
rec('3차: 새 문단도 번역 대상에 들어갔다', askedThird.includes('맨 앞에 끼어든 새 문단입니다'), true)
rec('3차: 결과가 5개 언어로 나온다', third.length, 5)

await b.close()

for (const x of results) {
  console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name}`)
  if (!x.pass) console.log(`       got=${JSON.stringify(x.got)}\n       want=${JSON.stringify(x.want)}`)
}
const failed = results.filter((x) => !x.pass).length
console.log(`\nRESUME-CHECK: ${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
