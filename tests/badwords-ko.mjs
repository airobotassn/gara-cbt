// bun tests/badwords-ko.mjs
// Unit tests for supabase/functions/_shared/badwords_ko.ts (pure TS, no Deno.* APIs)
// and for the sha256Hex export added to supabase/functions/_shared/seb.ts.

import { checkBadword, normalizeKo } from '../supabase/functions/_shared/badwords_ko.ts'

let passed = 0
let failed = 0
const failures = []

function check(name, cond) {
  if (cond) {
    passed++
    console.log(`PASS: ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`FAIL: ${name}`)
  }
}

// ---- RECALL: must block ----
check('recall: 시발 blocked', checkBadword('시발').blocked === true)
check('recall: 시1발 blocked', checkBadword('시1발').blocked === true)
check('recall: ㅅㅣ발 blocked', checkBadword('ㅅㅣ발').blocked === true)
check('recall: 시 발 (space) blocked', checkBadword('시 발').blocked === true)
check('recall: 시*발 (symbol) blocked', checkBadword('시*발').blocked === true)
check(
  'recall: sentence containing 씨발 blocked',
  checkBadword('너 진짜 씨발 이럴거야?').blocked === true,
)

// ---- RED-TEAM: evasion variants that SHOULD block ----
check('redteam: 씨1발 (digit-interleaved) blocked', checkBadword('씨1발').blocked === true)
check('redteam: ㅆㅣ발 (fully-decomposed jamo) blocked', checkBadword('ㅆㅣ발').blocked === true)
check('redteam: 시.발 (period separator) blocked', checkBadword('시.발').blocked === true)
check('redteam: 시_발 (underscore separator) blocked', checkBadword('시_발').blocked === true)
check(
  'redteam: 씨.. 발!! (mixed punctuation+space) blocked',
  checkBadword('씨.. 발!!').blocked === true,
)

// ---- RED-TEAM: precision fixtures that must NOT block ----
check('redteam: 발표회 not blocked', checkBadword('발표회').blocked === false)
check('redteam: 시발점은 (no trailing space) not blocked', checkBadword('시발점은').blocked === false)
check('redteam: 개발자 not blocked', checkBadword('개발자').blocked === false)
check('redteam: 발전 not blocked', checkBadword('발전').blocked === false)
check(
  'redteam: benign English sentence not blocked',
  checkBadword('The quick brown fox jumps over the lazy dog.').blocked === false,
)

// ---- PRECISION: must NOT block ----
check(
  'precision: 시발점에서 출발 not blocked',
  checkBadword('시발점에서 출발').blocked === false,
)
check('precision: 오늘 발표 준비 not blocked', checkBadword('오늘 발표 준비').blocked === false)
check(
  'precision: 안녕하세요 반갑습니다 not blocked',
  checkBadword('안녕하세요 반갑습니다').blocked === false,
)
check(
  'precision: https://example.com not blocked',
  checkBadword('https://example.com').blocked === false,
)

// ---- normalizeKo determinism / folding ----
const sample = '시발점에서 출발하자!!'
check('normalizeKo deterministic', normalizeKo(sample) === normalizeKo(sample))
check(
  'normalizeKo folds separators: 시  발 === 시발',
  normalizeKo('시  발') === normalizeKo('시발'),
)

// ---- sha256Hex export from seb.ts ----
const { sha256Hex } = await import('../supabase/functions/_shared/seb.ts')
check('sha256Hex is exported as a function', typeof sha256Hex === 'function')
const digest = await sha256Hex('abc')
check(
  'sha256Hex("abc") returns a 64-char hex string',
  typeof digest === 'string' && digest.length === 64 && /^[0-9a-f]{64}$/.test(digest),
)

// ---- RECALL: 조사/어미 붙은 형태(시작-앵커링으로 잡아야) ----
check('recall: 씨발놈아 blocked', checkBadword('씨발놈아').blocked === true)
check('recall: 좆같네 blocked', checkBadword('아 좆같네').blocked === true)
check('recall: 개새끼야 blocked', checkBadword('이 개새끼야').blocked === true)
check('recall: 병신아 blocked', checkBadword('병신아').blocked === true)
check('recall: 지랄맞은 blocked', checkBadword('지랄맞은').blocked === true)
check('recall: 씨팔 blocked', checkBadword('씨팔').blocked === true)
check('recall: 니애미 blocked', checkBadword('니애미').blocked === true)
check('recall: 염병할 blocked', checkBadword('염병할').blocked === true)
// ---- PRECISION: 시작-앵커 오탐 억제(allowlist + 동음이의 제외) ----
check('precision: 안 보지 마 (보다 활용) not blocked', checkBadword('안 보지 마').blocked === false)
check('precision: 자지 마 (자다 활용) not blocked', checkBadword('자지 마').blocked === false)
check('precision: 자위대 not blocked', checkBadword('일본 자위대 뉴스').blocked === false)
check('precision: 오늘 시험 발표 not blocked', checkBadword('오늘 시험 발표').blocked === false)

console.log(JSON.stringify({ passed, failed, failures }, null, 2))
process.exit(failed ? 1 : 0)
