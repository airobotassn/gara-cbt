// 시켜라 사전 → public/games/i18n.js 의 order.* 블록. ko 는 tmp/_order-levels.mjs(원본)에서 뽑는다.
//   LV 가 비어 있으면 ko 만 넣고 나머지 언어는 ko 로 채운다(번역 전 검수용). 카드 수가 원본과 다르면 멈춘다.
import { readFileSync, writeFileSync } from 'node:fs'
import { UI, LV } from './_order-i18n.mjs'
import { LEVELS } from './_order-levels.mjs'
const LANGS = ['en', 'ja', 'zh', 'hi', 'vi']
const D = { ...UI }
let bad = 0
LEVELS.forEach((L, li) => {
  const key = `order.lv${li + 1}`
  const tr = LV[li]
  const fields = ['name', 'who', 'say', ...(L.paint ? ['paint'] : [])]
  for (const f of fields) {
    const e = { ko: L[f] }
    for (const l of LANGS) { const v = tr && tr[l] && tr[l][f]; if (!v) { if (tr) { console.error('missing', key, f, l); bad++ } } e[l] = v || L[f] }
    D[`${key}.${f}`] = e
  }
  L.cards.forEach((c, i) => {
    const e = { ko: c.t }
    for (const l of LANGS) { const v = tr && tr[l] && tr[l].cards && tr[l].cards[i]; if (!v) { if (tr) { console.error('missing card', key, i + 1, l); bad++ } } e[l] = v || c.t }
    D[`${key}.c${i + 1}`] = e
  })
  if (tr) for (const l of LANGS) if (tr[l] && tr[l].cards && tr[l].cards.length !== L.cards.length) { console.error('card count', key, l, tr[l].cards.length, 'vs', L.cards.length); bad++ }
})
if (bad) { console.error(bad, 'problems'); process.exit(1) }
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const lines = Object.entries(D).map(([k, v]) => `    ${q(k)}: { ${['ko', ...LANGS].map((l) => `${l}: ${q(v[l])}`).join(', ')} },`)
const block = `    // ── 시켜라(order-cari) — UI · 주문 20개(name/who/say/paint) · 카드 c1…. 원본 = tmp/_order-levels.mjs(한국어) + tmp/_order-i18n.mjs(번역). tmp/_order-i18n-apply.mjs 가 쓴다 ──\n${lines.join('\n')}\n    // ── /시켜라 ──`
let src = readFileSync('public/games/i18n.js', 'utf8')
const nl = src.includes('\r\n') ? '\r\n' : '\n'
const re = /    \/\/ ── 시켜라\(order-cari\)[\s\S]*?    \/\/ ── \/시켜라 ──/
if (re.test(src)) src = src.replace(re, block.replace(/\n/g, nl))
else {
  const m = src.match(/\r?\n  \}\r?\n\r?\n  function t\(key/)
  if (!m) { console.error('D 끝을 못 찾음'); process.exit(1) }
  src = src.slice(0, m.index) + nl + block.replace(/\n/g, nl) + src.slice(m.index)
}
writeFileSync('public/games/i18n.js', src)
console.log('keys', Object.keys(D).length, 'written', LV.length ? 'with translations' : '(ko only)')
