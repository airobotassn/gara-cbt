// schema.sql 이 각 DDL 마이그레이션 파일의 실행문(주석/공백 제외)을 그대로 포함하는지 검증.
// (schools_seed 는 데이터 seed 라 schema.sql 에 없으므로 제외.)
import { readFileSync } from 'node:fs';

const DDL_MIGRATIONS = [
  'supabase/migrations/20260714000000_region_onboarding.sql',
  'supabase/migrations/20260714000200_leaderboard_rpcs.sql',
  'supabase/migrations/20260714000300_admin_set_region.sql',
  'supabase/migrations/20260714000400_phase2_character.sql',
  'supabase/migrations/20260714000500_gacha_shop.sql',
  'supabase/migrations/20260714000600_complete_daily_fn.sql',
  'supabase/migrations/20260714000700_coupons.sql',
  'supabase/migrations/20260714000800_titles.sql',
  'supabase/migrations/20260714000900_lecture_ai.sql',
  'supabase/migrations/20260721010000_ranking_progress_columns.sql',
  'supabase/migrations/20260721020000_activity_ledger.sql',
  'supabase/migrations/20260721030000_ranking_season_archive.sql',
  'supabase/migrations/20260721040000_daily_activity_flags.sql',
  'supabase/migrations/20260721050000_reset_season_fn.sql',
];

const stripped = (text) => text.split('\n').map((l) => l.replace(/\s+$/, ''))
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('--'); });

const schema = stripped(readFileSync('supabase/schema.sql', 'utf8'));

function isContiguousSubsequence(hay, needle) {
  if (needle.length === 0) return true;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

let allOk = true;
for (const mig of DDL_MIGRATIONS) {
  const mLines = stripped(readFileSync(mig, 'utf8'));
  const at = isContiguousSubsequence(schema, mLines);
  if (at >= 0) {
    console.log(`PARITY-OK: ${mig.split('/').pop()} (${mLines.length} SQL lines) present in schema.sql @schemaLine~${at}`);
  } else {
    allOk = false;
    console.log(`PARITY-DIFF: ${mig.split('/').pop()} DDL not found byte-identical in schema.sql`);
    // 첫 불일치 진단
    for (let i = 0; i < mLines.length; i++) {
      if (!schema.includes(mLines[i])) { console.log(`  first missing line: ${JSON.stringify(mLines[i])}`); break; }
    }
  }
}
if (allOk) console.log(`ALL PARITY-OK: ${DDL_MIGRATIONS.length} DDL migrations byte-identical in schema.sql`);
process.exit(allOk ? 0 : 1);
