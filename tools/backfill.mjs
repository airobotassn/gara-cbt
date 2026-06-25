// tools/backfill.mjs — kb_chunks 임베딩 백필 구동기.
//   kb-embed-backfill 함수를 남은 청크가 0 될 때까지 반복 호출(페이싱).
//   임베딩 할당량이 막히면 멈추고 안내(나중에 회복되면 다시 돌리면 이어서 채움).
//
// 사용: node tools/backfill.mjs [limitPerCall]   (기본 200)

const FN = 'https://jfvldoywvzvqhitcgalr.supabase.co/functions/v1/kb-embed-backfill'
const limit = +process.argv[2] || 50      // 200은 배치 너무 큼(429). 50이 안전.
const PACE_MS = +process.argv[3] || 8000  // 분당 리밋 보호용 호출 간격

async function main() {
  let total = 0
  console.log(`임베딩 백필 시작 (호출당 ${limit}개)`)
  for (;;) {
    let j
    try {
      const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit }) })
      j = await r.json()
    } catch (e) { console.log('호출 실패:', e.message); break }
    if (j.error) { console.log('오류:', j.error); break }
    total += j.embedded || 0
    console.log(`+${j.embedded || 0}  (누적 ${total})  ·  남음 ${j.remaining ?? '?'}`)
    if (j.done) { console.log('\n✅ 백필 완료 — 모든 청크 임베딩됨'); break }
    if ((j.embedded || 0) === 0) { console.log('\n⛔ 진행 0 — 중단:', (j.notes || []).join(' ')); break }
    await new Promise((s) => setTimeout(s, PACE_MS))
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
