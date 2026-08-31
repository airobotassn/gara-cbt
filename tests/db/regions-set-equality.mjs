// Three-way set-equality check for the 16 ISO 3166-2:KR region codes.
//   1. src/lib/regions.ts                                        (client)
//   2. supabase/functions/_shared/regions.ts                     (server allowlist)
//   3. supabase/migrations/20260714000000_region_onboarding.sql  (regions seed)
// All three MUST contain the identical set of codes. Exits 1 on any mismatch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

// ⚠️ **따옴표 안의 코드만** 센다. 맨 `KR-\d+` 로 훑으면 "광주(KR-29)는 없다" 같은 주석까지
//    코드로 세어, 지운 코드를 설명하는 문장 때문에 테스트가 거짓으로 실패한다(실제로 그랬다).
//    세 파일 다 코드를 홑따옴표로 적는다 — TS 배열도 SQL 시드(`('KR-11')`)도.
const CODE_RE = /'(KR-\d+)'/g;

function extractCodes(relPath) {
  const text = readFileSync(resolve(root, relPath), 'utf8');
  return new Set([...text.matchAll(CODE_RE)].map((m) => m[1]));
}

const client = extractCodes('src/lib/regions.ts');
const server = extractCodes('supabase/functions/_shared/regions.ts');
const seed = extractCodes('supabase/migrations/20260714000000_region_onboarding.sql');

// 2026-08-31 전남·광주 통합 — 광주(KR-29)가 전남(KR-46)에 흡수됐다.
// 옛 시드 마이그레이션은 이미 프로덕션에 적용된 이력이라 손대지 않고, 뒤따르는
// 20260831120000_jeonnam_gwangju_merge.sql 이 그 행을 지운다. 그 델타를 여기서 반영한다.
// ⚠️ 지역이 또 통합·분리되면 이 목록에 추가할 것 — 시드 파일을 고쳐 이력을 다시 쓰지 말 것.
const MERGED_AWAY = ['KR-29'];
for (const code of MERGED_AWAY) seed.delete(code);

function eq(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function diff(a, b) {
  const onlyA = [...a].filter((v) => !b.has(v)).sort();
  const onlyB = [...b].filter((v) => !a.has(v)).sort();
  return { onlyA, onlyB };
}

let ok = true;
const pairs = [
  ['client (src/lib/regions.ts)', client, 'server (_shared/regions.ts)', server],
  ['client (src/lib/regions.ts)', client, 'seed (migration)', seed],
  ['server (_shared/regions.ts)', server, 'seed (migration)', seed],
];

for (const [nameA, a, nameB, b] of pairs) {
  if (eq(a, b)) {
    console.log(`PASS: ${nameA} === ${nameB} (${a.size} codes)`);
  } else {
    ok = false;
    const { onlyA, onlyB } = diff(a, b);
    console.log(`FAIL: ${nameA} !== ${nameB}`);
    console.log(`      only in ${nameA}: [${onlyA.join(', ')}]`);
    console.log(`      only in ${nameB}: [${onlyB.join(', ')}]`);
  }
}

// Also assert each set has exactly 16 codes.
for (const [name, set] of [['client', client], ['server', server], ['seed', seed]]) {
  if (set.size !== 16) {
    ok = false;
    console.log(`FAIL: ${name} has ${set.size} codes, expected 16`);
  }
}

if (ok) {
  console.log('ALL PASS: three-way region code set equality (16 codes)');
  process.exit(0);
} else {
  console.log('MISMATCH: region code sets are not equal');
  process.exit(1);
}
