// 주관식 자동채점 정규화·매칭 + front/edge sync-pair parity 검증. 실행: bun tests/short-normalize.mjs
import {
  normalizeAnswer as nFront,
  matchShort as mFront,
  parseAcceptedAnswers,
  acceptedAnswerPool,
  matchShortPool,
  answerLangReady,
} from '../src/lib/normalize.ts'
import {
  normalizeAnswer as nEdge,
  matchShortPool as mPoolEdge,
  answerLangReady as readyEdge,
} from '../supabase/functions/_shared/normalize.ts'

let fail = 0
const eq = (name, got, want) => {
  if (got !== want) { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
}

// --- 정규화: 표기 변형 흡수 ---
eq('mixed-case', nFront('Edge Computing'), 'edgecomputing')
eq('upper', nFront('EDGE COMPUTING'), 'edgecomputing')
eq('nospace', nFront('edgecomputing'), 'edgecomputing')
eq('hyphen', nFront('edge-computing'), 'edgecomputing')
eq('ko-space', nFront('엣지 컴퓨팅'), '엣지컴퓨팅')
eq('ko-middot', nFront('엣지·컴퓨팅'), '엣지컴퓨팅')
eq('fullwidth', nFront('ＥＤＧＥ'), 'edge')
eq('trailing-punct', nFront('디렉토리.'), '디렉토리')
eq('quotes-parens', nFront('"디렉토리(폴더)"'), '디렉토리폴더')
eq('blank', nFront('   '), '')

// --- 정규화: 의미 보존(수치·연산자) ---
eq('num-dot-preserve', nFront('2.5'), '2.5')
eq('num-comma-preserve', nFront('1,000'), '1,000')
eq('operator-preserve', nFront('H+'), 'h+')
eq('underscore-preserve', nFront('a_b'), 'a_b')
eq('num-2.5-not-25', nFront('2.5') === nFront('25'), false)

// --- matchShort: 허용답안 목록(줄바꿈) ---
const key = '엣지 컴퓨팅\nedge computing'
eq('match-ko-trim', mFront('  엣지컴퓨팅  ', key), true)
eq('match-en-caps', mFront('EDGE COMPUTING', key), true)
eq('match-en-nospace', mFront('edgecomputing', key), true)
eq('reject-other', mFront('클라우드 컴퓨팅', key), false)
eq('reject-empty-key', mFront('엣지 컴퓨팅', ''), false)
eq('reject-empty-submit', mFront('', key), false)
eq('accepted-count', parseAcceptedAnswers(key).length, 2)
eq('accepted-dedup', parseAcceptedAnswers('파일\n파일\n FILE ').length, 2) // 파일, file

// --- 다국어 허용답안: 원문 + 번역본 합집합 (2026-08-26) ---
// 실제 문항 모양 그대로 — 원문에 이미 영어 표기가 섞여 있고, 번역본은 개수가 제각각이다.
const koKey = '엣지 컴퓨팅\nEdge Computing\n엣지컴퓨팅'
const i18n = {
  ja: ['エッジコンピューティング', 'エッジ計算'],
  zh: ['边缘计算'],
  vi: ['Điện toán biên'],
}
eq('pool-includes-ko', matchShortPool('엣지컴퓨팅', koKey, i18n), true)
eq('pool-includes-en', matchShortPool('EDGE COMPUTING', koKey, i18n), true)
eq('pool-includes-ja', matchShortPool('エッジコンピューティング', koKey, i18n), true)
eq('pool-includes-zh', matchShortPool('边缘计算', koKey, i18n), true)
// ⭐ 언어를 안 가른다 — 일본어 응시자가 영어/한국어 표기로 답해도 맞는 답이다.
eq('pool-cross-lang', matchShortPool('edge computing', koKey, i18n), true)
eq('pool-rejects-other', matchShortPool('클라우드 컴퓨팅', koKey, i18n), false)
eq('pool-rejects-empty', matchShortPool('', koKey, i18n), false)
// ⭐ 원문(3개 중 정규화 후 2개) + ja 2 + zh 1 + vi 1 = 6
eq('pool-size', acceptedAnswerPool(koKey, i18n).length, 6)
eq('pool-no-i18n', acceptedAnswerPool(koKey, null).length, 2)
eq('pool-junk-i18n', acceptedAnswerPool(koKey, { ja: 'not-an-array' }).length, 2)
eq('pool-empty-key', acceptedAnswerPool('', i18n).length, 4)

// --- 자동채점 게이트: 그 언어 답이 준비됐을 때만 채점한다 ---
// ⛔ 이게 없으면 일본어 응시자가 일본어로 쓴 정답이 한국어 목록과 안 맞아 **오답으로 확정**된다.
eq('ready-ko-always', answerLangReady(null, 'ko'), true)
eq('ready-ko-empty-attempt-lang', answerLangReady(null, ''), true)
eq('ready-ja-yes', answerLangReady(i18n, 'ja'), true)
eq('ready-en-no', answerLangReady(i18n, 'en'), false) // 영어 번역이 없다 → pending
eq('ready-null', answerLangReady(null, 'ja'), false)
eq('ready-blank-entries', answerLangReady({ hi: ['', '  '] }, 'hi'), false)

// --- front/edge sync-pair parity (bit-identical 출력) ---
const vec = ['Edge Computing', '엣지 컴퓨팅', '2.5', '1,000', 'H+', 'a_b', '디렉토리·폴더', 'ＦＵＬＬ　width', 'edge-computing', '  trim  ', 'ＡＢＣ123', '엣지컴퓨팅']
for (const v of vec) eq(`parity:${v}`, nFront(v), nEdge(v))
// 새 함수도 양쪽이 같은 답을 내야 한다(서버 채점 ↔ 관리자 미리보기).
eq('parity:pool-ja', matchShortPool('エッジ計算', koKey, i18n), mPoolEdge('エッジ計算', koKey, i18n))
eq('parity:pool-reject', matchShortPool('무관한답', koKey, i18n), mPoolEdge('무관한답', koKey, i18n))
eq('parity:ready-en', answerLangReady(i18n, 'en'), readyEdge(i18n, 'en'))
eq('parity:ready-ja', answerLangReady(i18n, 'ja'), readyEdge(i18n, 'ja'))

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1) }
console.log('ALL PASS — normalize + matchShort + 다국어 허용답안 + front/edge parity')
