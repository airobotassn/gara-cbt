// T-scoring-parity — 랭킹 STAGE2 슬라이스 A: src/lib/scoring.ts 와 supabase/functions/_shared/scoring.ts 의
// <scoring-sync> 영역이 항상 같이(동일 수식으로) 수정되는지 검증한다. 과거 guard.mjs(커밋훅)는 실존하지 않으므로
// 이 parity 테스트가 그 역할을 대체한다.
//
//  1) 심볼별(promoteCut/computeRankChange/computePoints/computeSkillScore/activityDelta 및
//     관련 상수) 소스 텍스트를 두 파일에서 정규식으로 추출해 바이트 동일성을 비교한다.
//  2) _shared/scoring.ts 는 Deno 전용 import(esm.sh, ./lib.ts)를 갖고 있어 그대로 import 할 수 없다 →
//     <scoring-sync> 블록까지만 잘라내고 그 3개 import 줄만 제거한 사본을 임시 .ts 파일로 떠서 동적 import
//     한다(순수 함수만 남기므로 Deno.env 등 부작용 있는 코드는 애초에 포함되지 않음).
//  3) 두 구현을 동일 샘플 입력으로 실제 실행해 출력이 값 동일한지도 검증한다(소스 텍스트 동일성만으로는
//     사람이 포맷을 다르게 베껴 실수로 의미를 바꾸는 경우를 못 잡으므로 이중 방어).
//  4) 원안 점수표(2026-08-04) 자체 검증 — 레벨테스트 7,000 / 활동 6,570 / 전체 13,570 과 ARENA 밴드 경계.
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

// questionsForLevel 은 2026-08-27 사다리 밀기에서 경계(Lv.3/4 → Lv.4/5)가 옮겨진 자리다 —
// promoteCut·보기 개수와 한 몸이라 한쪽만 고치면 시험 규모와 승급컷이 어긋난다. 그래서 여기서 같이 본다.
const FN_SYMBOLS = [
  'promoteCut', 'questionsForLevel', 'computeRankChange', 'computePoints', 'computeSkillScore',
  'activityDelta', 'activityPerDay', 'arenaLevelForScore', 'arenaBand',
];
// 강등 관련 상수(DEMOTE_*)는 강등 제거로 사라졌다 — 남은 승급/점수 상수만 비교한다.
// SKILL_LEVEL_STEP 은 2026-08-04 원안 반영(레벨 클리어당 정액 1,000)으로 사라졌다.
const CONST_SYMBOLS = [
  'PROMOTE_RATE_LOW', 'PROMOTE_RATE_HIGH', 'MAX_POINTS', 'SEASON_DAYS',
  'ACTIVITY_DELTA', 'ACTIVITY_PER_DAY', 'ACTIVITY_SEASON_MAX',
  'LEVELTEST_CLEAR_POINTS', 'ARENA_BAND_STEP',
];

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

// 2026-08-27 경계 이동(Lv.4/5) 양쪽을 반드시 밟는다 — Lv.4 = 20문항·70% / Lv.5 = 30문항·80%.
const SAMPLE_LEVEL_CORRECT = [
  [1, 0], [1, 8], [1, 16], [1, 20],
  [3, 15], [3, 16], [4, 13], [4, 14], [4, 17],
  [5, 23], [5, 24], [5, 25],
  [7, 0], [7, 9], [7, 18], [7, 30],
];
for (const [level, correct] of SAMPLE_LEVEL_CORRECT) {
  eq(Shared.promoteCut(level), FE.promoteCut(level), `promoteCut(${level})`);
  eq(Shared.questionsForLevel(level), FE.questionsForLevel(level), `questionsForLevel(${level})`);
  eq(Shared.computePoints(level, correct), FE.computePoints(level, correct), `computePoints(${level},${correct})`);
}

// 레벨테스트 트랙은 이제 "클리어한 레벨 수" 단일 인자다(부분점수 없음).
for (const cleared of [-1, 0, 1, 3, 6, 7, 8, 99]) {
  eq(Shared.computeSkillScore(cleared), FE.computeSkillScore(cleared), `computeSkillScore(${cleared})`);
}

for (const kind of ['attendance', 'daily_learn', 'minigame', 'referral']) {
  eq(Shared.activityDelta(kind), FE.activityDelta(kind), `activityDelta(${kind})`);
  eq(Shared.activityPerDay(kind), FE.activityPerDay(kind), `activityPerDay(${kind})`);
}

// ARENA 레벨 밴드(시즌 총점 → 표시 레벨) — 경계값 위주.
const BAND_CASES = [-100, 0, 1, 999, 1000, 1999, 2000, 4999, 5000, 5999, 6000, 13570, 99999];
for (const total of BAND_CASES) {
  eq(Shared.arenaLevelForScore(total), FE.arenaLevelForScore(total), `arenaLevelForScore(${total})`);
}
for (const lv of [0, 1, 2, 6, 7, 8]) {
  eq(Shared.arenaBand(lv), FE.arenaBand(lv), `arenaBand(${lv})`);
}

// 강등이 없어 strikes 인자도 없다 — (내등급, 응시레벨, 맞힌수) 만으로 승급/유지가 결정된다.
const RANK_CASES = [
  [1, 1, 20], [1, 1, 16], [1, 1, 8], [1, 1, 7], [1, 1, 0],
  [4, 4, 18], [4, 4, 17], [7, 7, 30], [3, 2, 20], [2, 3, 16],
];
for (const [currentRank, testLevel, correct] of RANK_CASES) {
  eq(
    Shared.computeRankChange(currentRank, testLevel, correct),
    FE.computeRankChange(currentRank, testLevel, correct),
    `computeRankChange(${currentRank},${testLevel},${correct})`,
  );
}

// 강등 제거 확인: 최저점을 받아도 등급은 유지된다(어느 레벨에서든).
for (const rank of [1, 3, 7]) {
  eq(FE.computeRankChange(rank, rank, 0), { nextRank: rank, dir: 'stay' }, `no demotion: rank ${rank} · 0 correct → stay`);
}

// (3) 티어 경계값 테스트는 제거 — 티어 5단계 자체가 2026-08-04 에 없어졌다(scoring.ts 참고).

// ---------- 4) 원안 점수표 자체 검증 (2026-08-04 반영본) ----------
// 레벨테스트 트랙: 레벨 클리어 1회당 +1,000 · 7단계 전부 = 7,000. 부분점수 없음.
eq(FE.computeSkillScore(7), FE.LEVELTEST_MAX, 'computeSkillScore(7) === LEVELTEST_MAX');
eq(FE.LEVELTEST_MAX, 7000, 'LEVELTEST_MAX === 7,000 (원안 "레벨테스트 시즌 Max")');
eq(FE.computeSkillScore(0), 0, '미클리어 = 0 (컷 미달은 부분점수 없음)');

// 활동 트랙: seasonMax = delta × perDay × SEASON_DAYS 가 원안 표와 정확히 떨어져야 한다.
// ⚠️ referral 은 2026-08-24 에 이 표에서 빠졌다 — 친구 초대 보상이 시즌 점수 +5 에서 코인 50(양쪽)으로
//    옮겨갔다(RPC redeem_referral). 되살리면 화면이 주지도 않는 점수를 약속하게 된다.
const EXPECTED_SEASON_MAX = { minigame: 2190, daily_learn: 730, attendance: 1825 };
for (const [kind, expected] of Object.entries(EXPECTED_SEASON_MAX)) {
  const derived = FE.activityDelta(kind) * FE.activityPerDay(kind) * FE.SEASON_DAYS;
  eq(derived, expected, `활동 시즌상한 ${kind} = ${FE.activityDelta(kind)}점 × ${FE.activityPerDay(kind)}회 × ${FE.SEASON_DAYS}일`);
  eq(FE.ACTIVITY_SEASON_MAX[kind], expected, `ACTIVITY_SEASON_MAX.${kind} === ${expected}`);
}
eq(FE.ACTIVITY_MAX, 4745, 'ACTIVITY_MAX(활동 3종 합) === 4,745');
eq(FE.SEASON_MAX_POINTS, 11745, 'SEASON_MAX_POINTS === 11,745 (= Lv.7 최고점)');

// ARENA 밴드 경계 — 원안 표 그대로 1,000점 균등.
eq(FE.arenaLevelForScore(0), 1, 'band 0 -> Lv.1');
eq(FE.arenaLevelForScore(999), 1, 'band 999 -> Lv.1');
eq(FE.arenaLevelForScore(1000), 2, 'band 1,000 -> Lv.2');
eq(FE.arenaLevelForScore(5999), 6, 'band 5,999 -> Lv.6');
eq(FE.arenaLevelForScore(6000), 7, 'band 6,000 -> Lv.7');
eq(FE.arenaLevelForScore(FE.SEASON_MAX_POINTS), 7, 'band 상한 -> Lv.7');
eq(FE.arenaBand(1), [0, 999], 'arenaBand(1) === [0, 999]');
eq(FE.arenaBand(6), [5000, 5999], 'arenaBand(6) === [5,000, 5,999]');
eq(FE.arenaBand(7), [6000, 11745], 'arenaBand(7) === [6,000, 11,745]');

// 두 트랙의 힘 관계 — 여기가 2026-08-24 에 뒤집혔다.
//   원안(2026-08-04)은 활동 상한 6,570 이 레벨테스트 7,000 과 맞먹어서 **활동만 채워도 Lv.7** 이었다.
//   친구 초대(+5 · 시즌 1,825)가 코인으로 옮겨가면서 활동 상한이 4,745 로 내려갔고, 그 성질이 깨졌다 —
//   이제 활동만으로는 Lv.5 까지다. 의도한 결과가 아니라 **보상 지갑을 옮긴 것의 부수효과**이므로
//   되돌리려면 남은 3종의 적립값을 올려야 한다(초대를 점수 표로 되돌리는 건 답이 아니다).
//   보류중인 수정안(바탕화면 WORLD_ARENA_점수체계_수정제안.html)이 노리던 방향과 우연히 같다.
eq(FE.ACTIVITY_MAX < FE.LEVELTEST_MAX, true, '활동 상한(4,745) < 레벨테스트 트랙(7,000)');
eq(FE.arenaLevelForScore(FE.ACTIVITY_MAX), 5, '활동만으로는 ARENA Lv.5 까지 — 초대 보상이 코인으로 빠진 결과');

if (failed > 0) {
  console.error(`\n${failed} scoring-parity test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll scoring-parity tests passed');
