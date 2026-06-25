import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const BASE = process.env.SUPA_URL
const KEY = process.env.SERVICE_KEY
if (!BASE || !KEY) { console.error('SUPA_URL / SERVICE_KEY env 필요'); process.exit(1) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const dir = 'Z:\\전략기획\\★글로벌AI로봇협회\\AI 로봇 민간자격증\\레벨테스트(GARA TEST) 문항\\레벨테스트 최종\\레벨테스트최종(다국어)'
const files = { 1: 'GARA_Level1_120_최종_번역.xlsx', 2: 'GARA_Level2_120_최종_번역.xlsx', 3: 'GARA_Level3_120_최종_번역.xlsx', 4: 'GARA_Level4_120_최종_번역.xlsx' }
const C_NUM = 0, C_PROMPT = 2

// (level + '\n' + koPrompt) → 번호
const map = new Map()
for (const [lvStr, fn] of Object.entries(files)) {
  const level = +lvStr
  const wb = XLSX.readFile(dir + '\\' + fn)
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['한국어(원본)'], { header: 1, defval: '', raw: false })
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i]; const p = String(r?.[C_PROMPT] ?? '').trim()
    if (!p) continue
    map.set(level + '\n' + p, String(r[C_NUM]).trim())
  }
}
console.log('엑셀 매핑:', map.size)

// DB 문항 가져오기
const res = await fetch(`${BASE}/rest/v1/questions?select=id,level,prompt_i18n&limit=2000`, { headers: H })
const rows = await res.json()
console.log('DB 문항:', rows.length)

let matched = 0, miss = 0
const pad = (n) => String(n).padStart(3, '0')
for (const q of rows) {
  const ko = String(q.prompt_i18n?.ko ?? '').trim()
  const num = map.get(q.level + '\n' + ko)
  if (!num) { miss++; if (miss <= 10) console.log('  미매칭:', q.level, ko.slice(0, 30)); continue }
  const code = `L${q.level}-${pad(num)}`
  const pr = await fetch(`${BASE}/rest/v1/questions?id=eq.${q.id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ code }),
  })
  if (!pr.ok) { console.error('PATCH 실패', q.id, await pr.text()); process.exit(1) }
  matched++
}
console.log(`코드 부여: ${matched}, 미매칭: ${miss}`)
