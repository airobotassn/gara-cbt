import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const dir = 'Z:\\전략기획\\★글로벌AI로봇협회\\AI 로봇 민간자격증\\레벨테스트(GARA TEST) 문항\\레벨테스트 최종\\레벨테스트최종(다국어)'
const file = dir + '\\GARA_Level1_120_최종_번역.xlsx'

const wb = XLSX.readFile(file)
console.log('SHEETS:', wb.SheetNames)
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
  console.log(`\n===== SHEET: ${name} (rows=${aoa.length}) =====`)
  for (let i = 0; i < Math.min(4, aoa.length); i++) {
    console.log(`ROW${i} [${aoa[i].length}]:`, JSON.stringify(aoa[i]))
  }
}
