// 검색 라우터 앵커 재시드 — route-seed 를 슬라이스로 끝까지 돌린다.
//
// 왜 필요한가: `route-query` 는 임베딩 앵커에 먼저 물어보고(HIT_THRESHOLD 0.85) 맞으면 LLM 을
//   아예 안 부른다. 그래서 **목적지를 고치고 함수를 배포해도, 앵커가 옛 목적지를 가리키면
//   검색은 그대로 옛 페이지로 간다.** 2026-08-26 배포 직후 실측:
//     "시험 언제야" → {"dest":"/guide","hit":true}   ← 고쳤는데도 옛 답
//   재시드하고 나면 /plan 으로 바뀐다.
//
// ⚠️ `reset:true` 는 첫 슬라이스에서만. seed 행 + 학습분(llm) 을 통째로 비우고 다시 깐다.
// ⚠️ 문구 762개 × 600ms 페이싱이라 **8분쯤** 걸린다(분당 임베딩 한도 회피).
//
// 실행:
//   ROUTE_SEED_KEY=<Supabase 함수 시크릿 값> node tools/reseed-routes.mjs
import fs from 'node:fs'

const KEY = process.env.ROUTE_SEED_KEY
if (!KEY) {
  console.error('ROUTE_SEED_KEY 가 없다. Supabase 대시보드 > Edge Functions > Secrets 에서 값을 가져와')
  console.error('  ROUTE_SEED_KEY=... node tools/reseed-routes.mjs')
  process.exit(1)
}

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const BASE = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY

let offset = 0
let reset = true
for (;;) {
  const res = await fetch(`${BASE}/functions/v1/route-seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-seed-key': KEY,
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
    },
    body: JSON.stringify({ reset, offset, limit: 60 }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.error) {
    console.error(`실패 (offset=${offset}):`, res.status, JSON.stringify(j).slice(0, 400))
    // 그 슬라이스만 다시 부르면 된다 — 앞 슬라이스는 이미 들어가 있다.
    console.error(`이어서: ROUTE_SEED_KEY=... node tools/reseed-routes.mjs  (아래 offset 부터)`)
    console.error(`  offset=${offset}`)
    process.exit(1)
  }
  console.log(`${String(j.nextOffset).padStart(4)} / ${j.total}  (+${j.seeded}${reset ? ' · reset' : ''})`)
  reset = false
  if (j.done) break
  offset = j.nextOffset
}
console.log('\n재시드 완료. 확인:  node tools/probe-routes.mjs')
