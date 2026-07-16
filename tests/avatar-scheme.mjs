// gem/img REGRESSION guard + char: 스킴 회귀 방지 (no DOM). Run: bun tests/avatar-scheme.mjs
import { parseAvatar } from '../src/lib/avatar.ts';

let failed = 0;
function deepEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
    failed++;
  } else {
    console.log(`ok   ${label}`);
  }
}
function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL ${label}`);
    failed++;
  } else {
    console.log(`ok   ${label}`);
  }
}

// gem: UNCHANGED
deepEq(parseAvatar('gem:#aabbcc', 's'), { kind: 'gem', color: '#aabbcc' }, "gem: unchanged");
// img: UNCHANGED
deepEq(parseAvatar('img:https://x/y.webp', 's'), { kind: 'image', url: 'https://x/y.webp' }, "img: unchanged");
// char: NEW
deepEq(parseAvatar('char:abc', 's'), { kind: 'character', id: 'abc' }, "char: new scheme");

// null → seed gem fallback (never throws / never blank)
let nullSpec;
try {
  nullSpec = parseAvatar(null, 's');
} catch (e) {
  console.error(`FAIL null throws: ${e}`);
  failed++;
}
assert(nullSpec && nullSpec.kind === 'gem' && typeof nullSpec.color === 'string' && nullSpec.color.length > 0,
  "null → seed gem (never blank)");

// garbage (unrecognized) → seed gem
const garbageSpec = parseAvatar('garbage', 's');
assert(garbageSpec && garbageSpec.kind === 'gem' && typeof garbageSpec.color === 'string' && garbageSpec.color.length > 0,
  "garbage → seed gem");

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll avatar-scheme assertions passed.');
