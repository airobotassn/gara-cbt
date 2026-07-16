// lecture-qa-order — lecture-qa edge fn 의 **보안상 실행 순서**를 소스 수준에서 정적 검증한다.
//  SECURITY-CRITICAL ORDER (반드시 이 순서):
//    (a) 엔타이틀먼트 선검사  is_entitled → not_entitled/403
//    (b) 쿼터 소비           consume_quota → quota_exceeded/429
//    (c/d) 검색             match_lecture_chunks (강의 스코프 내)
//    (f) Gemini 답변 호출    answerWithFlash(...)  ← Flash 전용(Pro 금지)
//  · 순서 근거: 필터는 authz 경계가 아니므로 엔타이틀먼트를 검색·쿼터 소비 前에 판정해야 하고,
//    쿼터는 임베딩/AI 호출 前에 소비해야 비용 폭발을 막는다.
//  · 주석에 등장하는 토큰은 오탐이므로 **주석 제거 후 코드 인덱스 위치**로만 순서를 판정한다.
//  실행 안 함(정적 검사). Do NOT run anything else.
import { readFileSync } from 'node:fs';

const path = 'supabase/functions/lecture-qa/index.ts';
const raw = readFileSync(path, 'utf8');

// 주석 제거: /* */ 블록 + // 라인(단 ://  URL 은 보존).
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .map((line) => {
    const i = line.indexOf('//');
    if (i < 0) return line;
    if (line.slice(i, i + 3) === '://') return line;
    return line.slice(0, i);
  })
  .join('\n');

// 필수 토큰의 (첫) 코드 인덱스. -1 이면 부재 → 실패.
const at = (needle) => src.indexOf(needle);

const iEntitled = at("'is_entitled'");
const iNotEntitled = at('not_entitled');
const i403 = at('403');
const iQuota = at("'consume_quota'");
const iQuotaExceeded = at('quota_exceeded');
const i429 = at('429');
const iMatch = at("'match_lecture_chunks'");
const iGemini = at('answerWithFlash(context');

const results = [];
const rec = (name, pass) => results.push({ name, pass });

// 모든 필수 토큰 존재.
rec('is_entitled present', iEntitled >= 0);
rec('not_entitled present', iNotEntitled >= 0);
rec('403 present', i403 >= 0);
rec('consume_quota present', iQuota >= 0);
rec('quota_exceeded present', iQuotaExceeded >= 0);
rec('429 present', i429 >= 0);
rec('match_lecture_chunks present', iMatch >= 0);
rec('Gemini flash call present', iGemini >= 0);

// (a) 엔타이틀먼트가 쿼터 소비보다 먼저.
rec('is_entitled BEFORE consume_quota', iEntitled >= 0 && iQuota >= 0 && iEntitled < iQuota);
// not_entitled/403 응답이 쿼터 소비보다 먼저(선검사에서 컷).
rec('not_entitled(403) BEFORE consume_quota', iNotEntitled >= 0 && iNotEntitled < iQuota);
rec('403 BEFORE consume_quota', i403 >= 0 && i403 < iQuota);

// (b) 쿼터 소비가 검색보다 먼저.
rec('consume_quota BEFORE match_lecture_chunks', iQuota >= 0 && iMatch >= 0 && iQuota < iMatch);
// quota_exceeded/429 응답이 검색보다 먼저(초과 시 컷).
rec('quota_exceeded(429) BEFORE match_lecture_chunks', iQuotaExceeded >= 0 && iQuotaExceeded < iMatch);
rec('429 BEFORE match_lecture_chunks', i429 >= 0 && i429 < iMatch);

// (d) 검색이 Gemini 호출보다 먼저.
rec('match_lecture_chunks BEFORE Gemini call', iMatch >= 0 && iGemini >= 0 && iMatch < iGemini);
// (a)→(b)→(d)→Gemini 전체 사슬.
rec('entitlement BEFORE quota BEFORE retrieval BEFORE Gemini',
  iEntitled >= 0 && iEntitled < iQuota && iQuota < iMatch && iMatch < iGemini);

// 모델은 Flash. Pro 금지.
rec('model is Flash (contains flash)', /flash/i.test(src));
rec('model is NOT Pro', !/gemini[\w.-]*pro/i.test(src));

// _shared/lib.ts 에서 adminClient/getUser import.
rec('imports adminClient/getUser from _shared/lib.ts',
  /import\s*\{[^}]*\badminClient\b[^}]*\bgetUser\b[^}]*\}\s*from\s*'\.\.\/_shared\/lib\.ts'/.test(src));

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name}`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nLECTURE-QA-ORDER: ${results.length - failed}/${results.length} assertions passed`);
console.log(JSON.stringify({ suite: 'lecture-qa-order', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
