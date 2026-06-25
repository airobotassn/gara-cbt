import { readFileSync } from 'fs'

const BASE = process.env.SUPA_URL
const KEY = process.env.SERVICE_KEY
if (!BASE || !KEY) { console.error('SUPA_URL / SERVICE_KEY env 필요'); process.exit(1) }

const rows = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'))
console.log('삽입할 문항:', rows.length)

const CHUNK = 100
let done = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK)
  const res = await fetch(`${BASE}/rest/v1/questions`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(batch),
  })
  if (!res.ok) {
    const t = await res.text()
    console.error(`배치 ${i / CHUNK + 1} 실패 (${res.status}):`, t.slice(0, 500))
    process.exit(1)
  }
  done += batch.length
  console.log(`  배치 ${i / CHUNK + 1}: +${batch.length} (누적 ${done})`)
}
console.log('완료:', done)
