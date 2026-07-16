// Three-way set-equality check for the 17 ISO 3166-2:KR region codes.
//   1. src/lib/regions.ts                                        (client)
//   2. supabase/functions/_shared/regions.ts                     (server allowlist)
//   3. supabase/migrations/20260714000000_region_onboarding.sql  (regions seed)
// All three MUST contain the identical set of codes. Exits 1 on any mismatch.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

const CODE_RE = /KR-\d+/g;

function extractCodes(relPath) {
  const text = readFileSync(resolve(root, relPath), 'utf8');
  const matches = text.match(CODE_RE) ?? [];
  return new Set(matches);
}

const client = extractCodes('src/lib/regions.ts');
const server = extractCodes('supabase/functions/_shared/regions.ts');
const seed = extractCodes('supabase/migrations/20260714000000_region_onboarding.sql');

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

// Also assert each set has exactly 17 codes.
for (const [name, set] of [['client', client], ['server', server], ['seed', seed]]) {
  if (set.size !== 17) {
    ok = false;
    console.log(`FAIL: ${name} has ${set.size} codes, expected 17`);
  }
}

if (ok) {
  console.log('ALL PASS: three-way region code set equality (17 codes)');
  process.exit(0);
} else {
  console.log('MISMATCH: region code sets are not equal');
  process.exit(1);
}
