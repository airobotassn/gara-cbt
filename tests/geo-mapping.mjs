// Pure unit test for regionNameToIso (no network). Run: bun tests/geo-mapping.mjs
import { regionNameToIso } from '../src/lib/geo.ts';

let failed = 0;
function eq(actual, expected, label) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  } else {
    console.log(`ok   ${label}`);
  }
}

eq(regionNameToIso('Seoul'), 'KR-11', "regionNameToIso('Seoul')");
eq(regionNameToIso('Gyeonggi-do'), 'KR-41', "regionNameToIso('Gyeonggi-do')");
eq(regionNameToIso('Gangwon-do'), 'KR-42', "regionNameToIso('Gangwon-do')");
eq(regionNameToIso('Jeollabuk-do'), 'KR-45', "regionNameToIso('Jeollabuk-do')");
eq(regionNameToIso(null, 'KR-26'), 'KR-26', "regionNameToIso(null,'KR-26') passthrough");
eq(regionNameToIso('Atlantis'), null, "regionNameToIso('Atlantis')");
eq(regionNameToIso('  seoul '), 'KR-11', "regionNameToIso('  seoul ') normalize");
eq(regionNameToIso(null, 'KR-99'), null, "regionNameToIso(null,'KR-99') falls through");

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll geo-mapping tests passed');
