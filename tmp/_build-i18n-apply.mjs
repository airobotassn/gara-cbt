// build.lv{n}.* 블록을 i18n.js 에 넣는다(있으면 갈아끼운다). 한국어는 설계 원본(_build-levels.mjs)과 대조.
import { readFileSync, writeFileSync } from 'node:fs'
import { LV } from './_build-i18n.mjs'
import { LEVELS } from './_build-levels.mjs'
const LANGS = ['ko', 'en', 'ja', 'zh', 'hi', 'vi']
let bad = 0
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const lines = []
LV.forEach((T, i) => {
  const L = LEVELS[i]
  for (const f of ['name', 'goal', 'take']) {   // teach 는 안 쓴다(2026-09-15 지시로 뺐다)
    if (!T[f]) { if (L[f]) { bad++; console.error(`L${i + 1} ${f}: 번역 없음`) } continue }
    if (T[f].ko !== L[f]) { bad++; console.error(`L${i + 1} ${f}: ko 원본과 다름\n  i18n: ${T[f].ko}\n  lvl : ${L[f]}`) }
    for (const l of LANGS) if (!T[f][l]) { bad++; console.error(`L${i + 1} ${f}: ${l} 없음`) }
    lines.push(`    'build.lv${i + 1}.${f}': { ${LANGS.map((l) => `${l}: ${q(T[f][l])}`).join(', ')} },`)
  }
})
if (bad) { console.error(`${bad} problems`); process.exit(1) }
const p = 'public/games/i18n.js'
let s = readFileSync(p, 'utf8')
const block = `    // ── 지어라 레벨 문구(30) — 한국어 원본은 build-cari.html 의 LEVELS(= tmp/_build-levels.mjs). 생성: tmp/_build-i18n-apply.mjs ──\n${lines.join('\n')}\n`
const start = s.indexOf('    // ── 지어라 레벨 문구(30)')
if (start >= 0) {
  // ⚠️ 파일이 CRLF 일 수 있다(autocrlf) — 줄바꿈을 고정 문자열로 찾으면 못 찾고(-1) 파일이 통째로 한 번 더 붙는다.
  const m = /\r?\n  \}\r?\n/.exec(s.slice(start))
  if (!m) throw new Error('block end not found')
  s = s.slice(0, start) + block + s.slice(start + m.index + (m[0].startsWith('\r') ? 2 : 1))
} else {
  const anchor = s.indexOf("    'build.res_over':")
  const eol = s.indexOf('\n', anchor)
  s = s.slice(0, eol + 1) + block + s.slice(eol + 1)
}
writeFileSync(p, s)
console.log('i18n.js updated', lines.length, 'keys')
