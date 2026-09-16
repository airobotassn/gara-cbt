// 막아라 사전(tmp/_block-i18n.mjs)을 public/games/i18n.js 의 D 에 써 넣는다. 조각 순서가 한국어와 다르면 멈춘다.
//   ⚠️ i18n.js 는 CRLF 다 — 줄바꿈을 고정 문자열로 찾지 말고 정규식으로 찾는다(지어라 때 파일이 두 번 붙은 적 있다).
import { readFileSync, writeFileSync } from 'node:fs'
import { UI, DOCS } from './_block-i18n.mjs'
const html = readFileSync('public/games/block-cari.html', 'utf8')
const DAYS = new Function('return ' + html.match(/const DAYS=(\[[\s\S]*?\n\]);/)[1])()
const LANGS = ['en', 'ja', 'zh', 'hi', 'vi']
const STAMP_KO = { hr1: '인사 평가', hr2: '징계 기록', src: '개발 중 코드', legal1: '소송 자료', legal2: '수사 자료' }
const kinds = (t) => [...t.matchAll(/\{([a-z]+)\|/g)].map((x) => x[1]).join(',')

const D = { ...UI }
let bad = 0
for (const doc of DOCS) {
  const ko = DAYS[doc.n - 1].docs[doc.i - 1]
  if (!ko) { console.error('no ko doc', doc.n, doc.i); bad++; continue }
  const key = `block.d${doc.n}.${doc.i}`
  for (const f of ['from', 'ask', 'text']) {
    const e = { ko: ko[f] }
    for (const l of LANGS) {
      if (!doc[l] || !doc[l][f]) { console.error('missing', key, f, l); bad++; continue }
      e[l] = doc[l][f]
      if (f === 'text' && kinds(doc[l][f]) !== kinds(ko.text)) { console.error('token mismatch', key, l, kinds(doc[l][f]), 'vs', kinds(ko.text)); bad++ }
    }
    D[`${key}.${f}`] = e
  }
  if (ko.stamp) {
    if (!doc.stamp || STAMP_KO[doc.stamp] !== ko.stamp) { console.error('stamp mismatch', key, ko.stamp, doc.stamp); bad++ }
    else D[`${key}.stamp`] = UI[`block.stamp.${doc.stamp}`]
  } else if (doc.stamp) { console.error('stamp on non-block doc', key); bad++ }
}
const seen = new Set(DOCS.map((d) => `${d.n}.${d.i}`))
DAYS.forEach((Dy, di) => Dy.docs.forEach((_, i) => { if (!seen.has(`${di + 1}.${i + 1}`)) { console.error('untranslated', di + 1, i + 1); bad++ } }))
if (bad) { console.error(bad, 'problems'); process.exit(1) }

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const lines = Object.entries(D).map(([k, v]) => `    ${q(k)}: { ${['ko', ...LANGS].map((l) => `${l}: ${q(v[l])}`).join(', ')} },`)
const block = `    // ── 막아라(block-cari) — UI · 규정 · 서류 50장. 원본 = tmp/_block-i18n.mjs(번역) + block-cari.html(한국어). tmp/_block-i18n-apply.mjs 가 쓴다 ──\n${lines.join('\n')}\n    // ── /막아라 ──`

let src = readFileSync('public/games/i18n.js', 'utf8')
const nl = src.includes('\r\n') ? '\r\n' : '\n'
const re = /    \/\/ ── 막아라\(block-cari\)[\s\S]*?    \/\/ ── \/막아라 ──/
if (re.test(src)) src = src.replace(re, block.replace(/\n/g, nl))
else {
  // D 의 닫는 괄호 바로 앞 — `  }` 다음에 빈 줄, `  function t(key` 가 온다
  const m = src.match(/\r?\n  \}\r?\n\r?\n  function t\(key/)
  if (!m) { console.error('D 끝을 못 찾음'); process.exit(1) }
  src = src.slice(0, m.index) + nl + block.replace(/\n/g, nl) + src.slice(m.index)
}
writeFileSync('public/games/i18n.js', src)
console.log('keys', Object.keys(D).length, 'written')
