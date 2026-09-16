// 더듬어라 사전 → public/games/i18n.js 의 feel.* 블록.
import { readFileSync, writeFileSync } from 'node:fs'
import { UI, ZONES } from './_feel-i18n.mjs'
import { LEVELS } from './_feel-levels.mjs'
const LANGS = ['en', 'ja', 'zh', 'hi', 'vi']
const D = { ...UI }
if (ZONES.length !== LEVELS.length) { console.error('zone count', ZONES.length, LEVELS.length); process.exit(1) }
LEVELS.forEach((L, i) => { const e = { ko: L.name }; for (const l of LANGS) { if (!ZONES[i][l]) { console.error('missing zone', i + 1, l); process.exit(1) } e[l] = ZONES[i][l] } D[`feel.z${i + 1}`] = e })
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const lines = Object.entries(D).map(([k, v]) => `    ${q(k)}: { ${['ko', ...LANGS].map((l) => `${l}: ${q(v[l])}`).join(', ')} },`)
const block = `    // ── 더듬어라(feel-cari) — UI · 센서·재질·환경 이름 · 구역 20개. 원본 = tmp/_feel-i18n.mjs + tmp/_feel-levels.mjs(한국어 구역 이름). tmp/_feel-i18n-apply.mjs 가 쓴다 ──\n${lines.join('\n')}\n    // ── /더듬어라 ──`
let src = readFileSync('public/games/i18n.js', 'utf8')
const nl = src.includes('\r\n') ? '\r\n' : '\n'
const re = /    \/\/ ── 더듬어라\(feel-cari\)[\s\S]*?    \/\/ ── \/더듬어라 ──/
if (re.test(src)) src = src.replace(re, block.replace(/\n/g, nl))
else { const m = src.match(/\r?\n  \}\r?\n\r?\n  function t\(key/); if (!m) { console.error('D 끝을 못 찾음'); process.exit(1) }
  src = src.slice(0, m.index) + nl + block.replace(/\n/g, nl) + src.slice(m.index) }
writeFileSync('public/games/i18n.js', src)
console.log('keys', Object.keys(D).length, 'written')
