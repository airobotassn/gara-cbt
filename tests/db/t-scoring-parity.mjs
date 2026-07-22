// T-scoring-parity — 랭킹 STAGE2 슬라이스 A: src/lib/scoring.ts 와 supabase/functions/_shared/scoring.ts 의
// <scoring-sync> 영역이 항상 같이(동일 수식으로) 수정되는지 검증한다. 과거 guard.mjs(커밋훅)는 실존하지 않으므로
// 이 parity 테스트가 그 역할을 대체한다.
//
//  1) 심볼별(promoteCut/computeRankChange/computePoints/computeSkillScore/activityDelta/tierForPercentile 및
//     관련 상수) 소스 텍스트를 두 파일에서 정규식으로 추출해 바이트 동일성을 비교한다.
//  2) _shared/scoring.ts 는 Deno 전용 import(esm.sh, ./lib.ts)를 갖고 있어 그대로 import 할 수 없다 →
//     <scoring-sync> 블록까지만 잘라내고 그 3개 import 줄만 제거한 사본을 임시 .ts 파일로 떠서 동적 import
//     한다(순수 함수만 남기므로 Deno.env 등 부작용 있는 코드는 애초에 포함되지 않음).
//  3) 두 구현을 동일 샘플 입력으로 실제 실행해 출력이 값 동일한지도 검증한다(소스 텍스트 동일성만으로는
//     사람이 포맷을 다르게 베껴 실수로 의미를 바꾸는 경우를 못 잡으므로 이중 방어).
//  4) 티어 경계값(0.05/0.20/0.45/0.75, 동률 포함) 단위테스트 — DB ranking_tier(pct)(reset_season_fn.sql)와
//     동일 밴드여야 한다.
//  5) 부등호 "실력 최고치 > 활동 최대 기여"가 상수 기본값에서 성립하는지(문서화된 가정 하에) 검증.
//
// 실행: bun tests/db/t-scoring-parity.mjs  (또는 npm test:db 체인의 일부)

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as FE from '../../src/lib/scoring.ts';

let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`FAIL ${label}: got ${a}, expected ${e}`);
  } else {
    console.log(`ok ${label}`);
  }
}

// ---------- 1) 소스 텍스트 바이트동일성 (심볼 단위 추출) ----------
const feSrc = readFileSync(new URL('../../src/lib/scoring.ts', import.meta.url), 'utf8');
const sharedSrc = readFileSync(new URL('../../supabase/functions/_shared/scoring.ts', import.meta.url), 'utf8');

// `export function NAME(...) { ... }` 전체(중괄호 균형 카운팅)를 추출.
function extractFn(src, name) {
  const m = src.match(new RegExp(`export function ${name}\\(`));
  if (!m) throw new Error(`extractFn: ${name} not found`);
  const i = m.index;
  const braceStart = src.indexOf('{', i);
  let depth = 0;
  let j = braceStart;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(i, j + 1);
}

// `export const NAME = ...` — 값이 `{...}` 객체 리터럴이면 중괄호 균형까지, 아니면 그 줄 끝까지 추출.
function extractConst(src, name) {
  const m = src.match(new RegExp(`export const ${name}[^=\\n]*=`));
  if (!m) throw new Error(`extractConst: ${name} not found`);
  const start = m.index;
  const afterEq = m.index + m[0].length;
  let k = afterEq;
  while (/\s/.test(src[k])) k++;
  if (src[k] === '{') {
    let depth = 0;
    let j = k;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    return src.slice(start, j + 1);
  }
  const nl = src.indexOf('\n', afterEq);
  return src.slice(start, nl === -1 ? src.length : nl).replace(/\s+$/, '');
}

// CRLF/LF(레포 파일별 개행 컨벤션 차이) 와 줄끝 한글 주석(수식과 무관한 주해)은 무시하고
// 수식/시그니처 자체만 바이트동일한지 비교한다.
function normalize(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .join('\n')
    .trim();
}

const FN_SYMBOLS = ['promoteCut', 'computeRankChange', 'computePoints', 'computeSkillScore', 'activityDelta', 'tierForPercentile'];
const CONST_SYMBOLS = ['DEMOTE_MAX', 'DEMOTE_STRIKES', 'MAX_POINTS', 'ACTIVITY_DELTA', 'SKILL_LEVEL_STEP'];

for (const name of FN_SYMBOLS) {
  eq(normalize(extractFn(sharedSrc, name)), normalize(extractFn(feSrc, name)), `source parity: function ${name}`);
}
for (const name of CONST_SYMBOLS) {
  eq(normalize(extractConst(sharedSrc, name)), normalize(extractConst(feSrc, name)), `source parity: const ${name}`);
}

// ---------- 2) 실행 동일성 (동적 import) ----------
// <scoring-sync> 블록 끝까지만 자르고, Deno 전용 import 3줄(esm.sh / ./lib.ts / export * from ./lib.ts)만 제거.
const syncEndIdx = sharedSrc.indexOf('// </scoring-sync>');
if (syncEndIdx === -1) throw new Error('_shared/scoring.ts: <scoring-sync> 종료 마커를 찾을 수 없음');
const truncatedShared = sharedSrc.slice(0, syncEndIdx);
const strippedShared = truncatedShared
  .split('\n')
  .filter((l) => !/from ['"]https:\/\/esm\.sh/.test(l) && !/from ['"]\.\/lib\.ts['"]/.test(l))
  .join('\n');

const tmpDir = mkdtempSync(join(tmpdir(), 'scoring-parity-'));
const tmpPath = join(tmpDir, 'shared-scoring.ts');
writeFileSync(tmpPath, strippedShared, 'utf8');
const Shared = await import(pathToFileURL(tmpPath).href);

const SAMPLE_LEVEL_CORRECT = [
  [1, 0], [1, 8], [1, 16], [1, 20],
  [3, 15], [3, 16], [4, 17], [4, 18], [4, 25],
  [7, 0], [7, 9], [7, 18], [7, 30],
];
for (const [level, correct] of SAMPLE_LEVEL_CORRECT) {
  eq(Shared.promoteCut(level), FE.promoteCut(level), `promoteCut(${level})`);
  eq(Shared.computePoints(level, correct), FE.computePoints(level, correct), `computePoints(${level},${correct})`);
  eq(Shared.computeSkillScore(level, correct), FE.computeSkillScore(level, correct), `computeSkillScore(${level},${correct})`);
}

for (const kind of ['attendance', 'daily_learn', 'minigame']) {
  eq(Shared.activityDelta(kind), FE.activityDelta(kind), `activityDelta(${kind})`);
}

const RANK_CASES = [
  [1, 1, 20, 0], [1, 1, 16, 0], [1, 1, 4, 0], [1, 1, 4, 1], [1, 1, 4, 2],
  [4, 4, 18, 0], [4, 4, 17, 0], [7, 7, 30, 0], [1, 1, 3, 2],
];
for (const [currentRank, testLevel, correct, strikes] of RANK_CASES) {
  eq(
    Shared.computeRankChange(currentRank, testLevel, correct, strikes),
    FE.computeRankChange(currentRank, testLevel, correct, strikes),
    `computeRankChange(${currentRank},${testLevel},${correct},${strikes})`,
  );
}

const PCT_CASES = [0, 0.01, 0.05, 0.0500001, 0.049999, 0.2, 0.200001, 0.199999, 0.45, 0.450001, 0.75, 0.750001, 1];
for (const pct of PCT_CASES) {
  eq(Shared.tierForPercentile(pct), FE.tierForPercentile(pct), `tierForPercentile(${pct})`);
}

// ---------- 3) 티어 경계값 명시 단위테스트 (DB ranking_tier(pct), reset_season_fn.sql 과 동일 밴드) ----------
eq(FE.tierForPercentile(0), 'diamond', 'tier boundary 0 -> diamond');
eq(FE.tierForPercentile(0.05), 'diamond', 'tier boundary 0.05 -> diamond (동률 포함)');
eq(FE.tierForPercentile(0.050001), 'platinum', 'tier boundary just above 0.05 -> platinum');
eq(FE.tierForPercentile(0.2), 'platinum', 'tier boundary 0.20 -> platinum (동률 포함)');
eq(FE.tierForPercentile(0.200001), 'gold', 'tier boundary just above 0.20 -> gold');
eq(FE.tierForPercentile(0.45), 'gold', 'tier boundary 0.45 -> gold (동률 포함)');
eq(FE.tierForPercentile(0.450001), 'silver', 'tier boundary just above 0.45 -> silver');
eq(FE.tierForPercentile(0.75), 'silver', 'tier boundary 0.75 -> silver (동률 포함)');
eq(FE.tierForPercentile(0.750001), 'bronze', 'tier boundary just above 0.75 -> bronze');
eq(FE.tierForPercentile(1), 'bronze', 'tier boundary 1 -> bronze');

// ---------- 4) 부등호 근거: 실력 최고치 > 활동 최대 기여(문서화된 가정 하) ----------
const skillMax = FE.computeSkillScore(7, FE.promoteCut(7)); // 만렙 만점
eq(skillMax, FE.MAX_POINTS, 'skillMax(만렙 만점) === MAX_POINTS(10000, 스케일 연속성)');

const ACTIVE_MINIGAME_COUNT = 2; // 가정: src/lib/minigames.ts 현재 등록 게임 수(레지스트리 커지면 갱신 필요)
const ASSUMED_SEASON_DAYS = 60; // 가정: 시즌 길이 ≈ 60일(고정 상수 아님 — reset_season() 은 운영자 트리거로 열림/닫힘)
const dailyActivityMax = FE.activityDelta('attendance') + FE.activityDelta('daily_learn') + FE.activityDelta('minigame') * ACTIVE_MINIGAME_COUNT;
const seasonActivityMax = dailyActivityMax * ASSUMED_SEASON_DAYS;
if (!(skillMax > seasonActivityMax)) {
  failed++;
  console.error(`FAIL inequality: skillMax(${skillMax}) must be > seasonActivityMax(${seasonActivityMax})`);
} else {
  console.log(`ok inequality: skillMax(${skillMax}) > seasonActivityMax(${seasonActivityMax}) [dailyMax=${dailyActivityMax} x ${ASSUMED_SEASON_DAYS}일 가정, 미니게임 ${ACTIVE_MINIGAME_COUNT}종 가정]`);
}

if (failed > 0) {
  console.error(`\n${failed} scoring-parity test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll scoring-parity tests passed');
