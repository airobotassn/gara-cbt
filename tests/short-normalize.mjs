// 주관식 자동채점 정규화·매칭 + front/edge sync-pair parity 검증. 실행: bun tests/short-normalize.mjs
import { normalizeAnswer as nFront, matchShort as mFront, parseAcceptedAnswers } from '../src/lib/normalize.ts'
import { normalizeAnswer as nEdge } from '../supabase/functions/_shared/normalize.ts'

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

// --- front/edge sync-pair parity (bit-identical 출력) ---
const vec = ['Edge Computing', '엣지 컴퓨팅', '2.5', '1,000', 'H+', 'a_b', '디렉토리·폴더', 'ＦＵＬＬ　width', 'edge-computing', '  trim  ', 'ＡＢＣ123', '엣지컴퓨팅']
for (const v of vec) eq(`parity:${v}`, nFront(v), nEdge(v))

if (fail) { console.log(`\n${fail} FAILED`); process.exit(1) }
console.log('ALL PASS — normalize + matchShort + front/edge parity')
