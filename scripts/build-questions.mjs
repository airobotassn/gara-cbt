import { createRequire } from 'module'
import { writeFileSync } from 'fs'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const dir = 'Z:\\전략기획\\★글로벌AI로봇협회\\AI 로봇 민간자격증\\레벨테스트(GARA TEST) 문항\\레벨테스트 최종\\레벨테스트최종(다국어)'
const files = {
  1: 'GARA_Level1_120_최종_번역.xlsx',
  2: 'GARA_Level2_120_최종_번역.xlsx',
  3: 'GARA_Level3_120_최종_번역.xlsx',
  4: 'GARA_Level4_120_최종_번역.xlsx',
}
const SHEET_LANG = { '한국어(원본)': 'ko', '영어': 'en', '일본어': 'ja', '중국어': 'zh', '힌디어': 'hi', '베트남어': 'vi' }

// 엑셀 영역명 → 축 코드
const CAT = {
  1: { '생성형 AI 기본 원리': 'l1_principle', 'AI 취약점 및 보안': 'l1_security', 'LLM 응용 기술 및 생태계': 'l1_llm_eco', '프롬프트 엔지니어링 설계': 'l1_prompt', 'AI 윤리와 편향': 'l1_ethics', 'AI 사회적 책임과 규범': 'l1_responsibility' },
  2: { '파이썬 기초': 'l2_python', '생성형 AI API 호출': 'l2_api', 'AI 활용 알고리즘 기획': 'l2_algo', '생성형 AI 중급': 'l2_genai', '내장센서 제어': 'l2_sensor', '블록코딩 논리': 'l2_block' },
  3: { 'RAG·검색 파이프라인': 'l3_rag', 'LLM 활용·생성 제어': 'l3_llm_ctrl', '비전 인식·평가 지표': 'l3_vision_eval', '비전 처리·데이터': 'l3_vision_data', 'C 기초 문법·흐름': 'l3_c_basic', 'C 메모리·구조·고급': 'l3_c_adv' },
  4: { 'STM32 정밀제어': 'l4_stm32', 'ROS2 시스템 통합': 'l4_ros2', 'PLC 프로그래밍': 'l4_plc', '공정 시뮬레이션': 'l4_sim', '스마트공장': 'l4_smartfactory', '물리적 AI 전처리': 'l4_preproc' },
}

const C_NUM = 0, C_CAT = 1, C_PROMPT = 2, C_OPT = [3, 4, 5, 6, 7], C_ANS = 8, C_EXPL = 9

function opts(row) {
  const out = []
  for (const c of C_OPT) { const v = String(row[c] ?? '').trim(); if (v !== '') out.push(v) }
  return out
}

const rows = []
const issues = []
for (const [lvStr, fn] of Object.entries(files)) {
  const level = +lvStr
  const wb = XLSX.readFile(dir + '\\' + fn)
  // 시트별 AOA를 번호(C_NUM) 기준 맵으로
  const byLang = {}
  for (const [sheet, lang] of Object.entries(SHEET_LANG)) {
    const ws = wb.Sheets[sheet]
    if (!ws) { issues.push(`L${level}: 시트 없음 ${sheet}`); continue }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
    const m = {}
    for (let i = 1; i < aoa.length; i++) { const r = aoa[i]; if (r && String(r[C_PROMPT] ?? '').trim()) m[String(r[C_NUM]).trim()] = r }
    byLang[lang] = m
  }
  const ko = byLang.ko
  for (const num of Object.keys(ko)) {
    const kr = ko[num]
    const catKo = String(kr[C_CAT]).trim()
    const code = CAT[level][catKo]
    if (!code) { issues.push(`L${level} #${num}: 미매핑 영역 "${catKo}"`); continue }
    const koOpts = opts(kr)
    const ans = parseInt(String(kr[C_ANS]).trim(), 10)
    if (!(ans >= 1 && ans <= koOpts.length)) { issues.push(`L${level} #${num}: 정답번호 ${kr[C_ANS]} 범위밖(보기 ${koOpts.length})`); continue }
    const prompt_i18n = {}, options_i18n = {}, explanation_i18n = {}
    let bad = false
    for (const lang of Object.values(SHEET_LANG)) {
      const r = byLang[lang]?.[num]
      if (!r) { if (lang !== 'ko') { issues.push(`L${level} #${num}: ${lang} 행 없음`); } continue }
      prompt_i18n[lang] = String(r[C_PROMPT]).trim()
      const o = opts(r)
      if (o.length !== koOpts.length) { issues.push(`L${level} #${num}: ${lang} 보기 ${o.length}개 ≠ ko ${koOpts.length}개`); bad = true }
      options_i18n[lang] = o
      explanation_i18n[lang] = String(r[C_EXPL] ?? '').trim()
    }
    if (bad) continue
    rows.push({ level, category: code, correct_index: ans - 1, prompt_i18n, options_i18n, explanation_i18n, active: true })
  }
}

writeFileSync(new URL('./questions.json', import.meta.url), JSON.stringify(rows))
// 요약
const perLevel = {}, perCat = {}
for (const r of rows) { perLevel[r.level] = (perLevel[r.level] || 0) + 1; perCat[`${r.level}/${r.category}`] = (perCat[`${r.level}/${r.category}`] || 0) + 1 }
console.log('총 빌드된 문항:', rows.length)
console.log('레벨별:', JSON.stringify(perLevel))
console.log('영역별:', JSON.stringify(perCat, null, 0))
console.log('이슈 수:', issues.length)
for (const x of issues.slice(0, 40)) console.log('  -', x)
