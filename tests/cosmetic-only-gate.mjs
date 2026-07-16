// cosmetic-only-gate — 경제 edge fn(complete-daily / gacha-draw / shop-buy)이
// cosmetic-only 하드 불변식(LOCKED)을 소스 수준에서 지키는지 정적 검사한다.
//  · 각 파일은 _shared/scoring.ts 를 import 하지 않는다(applyAttempt/computeRankChange 금지).
//  · 소스 텍스트에 'user_progress' / 'user_level_skill' 이 등장하지 않는다(실력/진화 데이터 무접촉).
// 파일이 아직 없을 수 있으므로(peer 슬라이스가 gacha/shop 생성) try/catch 로 존재하는 파일만 검사.
import { readFileSync } from 'node:fs';

const targets = [
  'supabase/functions/complete-daily/index.ts',
  'supabase/functions/gacha-draw/index.ts',
  'supabase/functions/shop-buy/index.ts',
];

// 주석(문서화)에 등장하는 테이블명은 오탐이므로 코드 검사 전 주석을 제거한다.
//  · JS/TS: /* */ 블록 + // 라인(단 ://  URL 은 보존)  · SQL: -- 라인.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const noSql = line.replace(/--.*$/, '')
      const m = noSql.match(/(^|[^:])\/\/.*/)
      return m ? noSql.slice(0, m.index + m[1].length) : noSql
    })
    .join('\n')

// import 라인에서 '_shared/scoring' 을 참조하는지 검출.
const importsScoring = (src) =>
  src.split(/\r?\n/).some((line) => /^\s*import\b/.test(line) && /_shared\/scoring(\.ts)?/.test(line));

const results = [];
const rec = (name, pass) => results.push({ name, pass });
const checked = [];

for (const path of targets) {
  let src;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    console.log(`SKIP (absent) | ${path}`);
    continue;
  }
  checked.push(path);
  const code = stripComments(src);
  rec(`${path}: does NOT import _shared/scoring.ts`, !importsScoring(src));
  rec(`${path}: code (comments stripped) has no 'user_progress'`, !code.includes('user_progress'));
  rec(`${path}: code (comments stripped) has no 'user_level_skill'`, !code.includes('user_level_skill'));
}

console.log(`\nchecked files: ${checked.length ? checked.join(', ') : '(none present)'}`);
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name}`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nCOSMETIC-ONLY-GATE: ${results.length - failed}/${results.length} assertions passed (${checked.length} files checked)`);
console.log(JSON.stringify({ suite: 'cosmetic-only-gate', checked, total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
