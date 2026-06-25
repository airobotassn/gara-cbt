import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const dir = 'Z:\\전략기획\\★글로벌AI로봇협회\\AI 로봇 민간자격증\\레벨테스트(GARA TEST) 문항\\레벨테스트 최종\\레벨테스트최종(다국어)'
const files = {
  1: 'GARA_Level1_120_최종_번역.xlsx',
  2: 'GARA_Level2_120_최종_번역.xlsx',
  3: 'GARA_Level3_120_최종_번역.xlsx',
  4: 'GARA_Level4_120_최종_번역.xlsx',
}

for (const [lv, fn] of Object.entries(files)) {
  const wb = XLSX.readFile(dir + '\\' + fn)
  const ws = wb.Sheets['한국어(원본)']
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  const counts = {}
  let maxOpts = 0
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i]
    if (!r || !r[2]) continue
    const cat = String(r[1]).trim()
    counts[cat] = (counts[cat] || 0) + 1
    // 보기 개수(3..7 중 비어있지 않은 것)
    let n = 0
    for (let c = 3; c <= 7; c++) if (String(r[c] ?? '').trim() !== '') n++
    if (n > maxOpts) maxOpts = n
  }
  console.log(`\n===== Level ${lv} (${fn}) — 보기 최대 ${maxOpts}개 =====`)
  for (const [cat, n] of Object.entries(counts)) console.log(`  ${n.toString().padStart(3)}  ${cat}`)
}
