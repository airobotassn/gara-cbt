// T-Phase2-datamodel — 마이그레이션 20260714000400_phase2_character.sql 을 pglite 에 적용해
// cosmetic-only 경제 테이블의 멱등/1-per-key 제약을 검증한다.
//  · auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거하고
//    나머지 DDL(컬럼/타입/pk/unique/rls)은 그대로 사용한다. (rls enable 는 pglite 도 지원)
// 검증: gacha_log/shop_purchase 의 unique(user_id, client_nonce) 멱등 가드,
//       daily_activity pk(user_id, day) 1/day 가드, user_currency.points bigint default 0,
//       user_cosmetics pk(user_id, part_key) 중복 파츠 차단.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260714000400_phase2_character.sql', 'utf8');
// auth.users FK 만 제거 — 컬럼은 plain uuid 로 남긴다(on delete cascade 절도 함께 제거).
const ddl = raw.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');

const db = await PGlite.create();
await db.exec(ddl);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });
const uid = '00000000-0000-0000-0000-000000000001';

// 마이그레이션이 auth.users FK 를 실제로 제거했는지(하네스가 참조하는 컬럼은 plain uuid) — 정상 실행됐으면 OK
rec('migration applied (no auth schema)', true, true);

// --- gacha_log unique(user_id, client_nonce) 멱등 가드 ---
await db.query(
  `insert into gacha_log (user_id, pool_key, client_nonce, result_part_key) values ($1,'poolA','nonce-1','hat_01')`,
  [uid],
);
let gachaDup = null;
try {
  await db.query(
    `insert into gacha_log (user_id, pool_key, client_nonce, result_part_key) values ($1,'poolA','nonce-1','hat_02')`,
    [uid],
  );
  gachaDup = 'inserted';
} catch (e) { gachaDup = e.code || 'error'; }
rec('gacha_log unique(user_id,client_nonce) rejects dup nonce', gachaDup, '23505');

// 다른 nonce 는 허용
await db.query(
  `insert into gacha_log (user_id, pool_key, client_nonce) values ($1,'poolA','nonce-2')`,
  [uid],
);
const gachaN = (await db.query(`select count(*)::int n from gacha_log`)).rows[0].n;
rec('gacha_log distinct nonce allowed (2 rows)', gachaN, 2);

// --- shop_purchase unique(user_id, client_nonce) 멱등 가드 ---
await db.query(
  `insert into shop_purchase (user_id, client_nonce, part_key, spent_points) values ($1,'buy-1','hat_01',100)`,
  [uid],
);
let shopDup = null;
try {
  await db.query(
    `insert into shop_purchase (user_id, client_nonce, part_key, spent_points) values ($1,'buy-1','hat_09',100)`,
    [uid],
  );
  shopDup = 'inserted';
} catch (e) { shopDup = e.code || 'error'; }
rec('shop_purchase unique(user_id,client_nonce) rejects dup nonce', shopDup, '23505');

// --- daily_activity pk(user_id, day) 1/day 가드 ---
await db.query(`insert into daily_activity (user_id, day) values ($1, date '2026-07-14')`, [uid]);
let dayDup = null;
try {
  await db.query(`insert into daily_activity (user_id, day) values ($1, date '2026-07-14')`, [uid]);
  dayDup = 'inserted';
} catch (e) { dayDup = e.code || 'error'; }
rec('daily_activity pk(user_id,day) rejects same-day dup (1/day)', dayDup, '23505');
// 다른 날은 허용
await db.query(`insert into daily_activity (user_id, day) values ($1, date '2026-07-15')`, [uid]);
const dayN = (await db.query(`select count(*)::int n from daily_activity where user_id=$1`, [uid])).rows[0].n;
rec('daily_activity distinct day allowed (2 rows)', dayN, 2);

// --- user_currency.points bigint default 0 ---
await db.query(`insert into user_currency (user_id) values ($1)`, [uid]);
const cur = (await db.query(`select points from user_currency where user_id=$1`, [uid])).rows[0];
rec('user_currency.points default 0', Number(cur.points), 0);
const ptType = (await db.query(
  `select data_type from information_schema.columns where table_name='user_currency' and column_name='points'`,
)).rows[0].data_type;
rec('user_currency.points is bigint', ptType, 'bigint');
// bigint 범위(int4 초과) 저장 가능
await db.query(`update user_currency set points = 9000000000 where user_id=$1`, [uid]);
const bigPts = (await db.query(`select points from user_currency where user_id=$1`, [uid])).rows[0].points;
rec('user_currency.points holds > int4 (bigint)', Number(bigPts), 9000000000);

// --- user_cosmetics pk(user_id, part_key) 중복 파츠 차단 ---
await db.query(`insert into user_cosmetics (user_id, part_key, source) values ($1,'hat_01','gacha')`, [uid]);
let cosDup = null;
try {
  await db.query(`insert into user_cosmetics (user_id, part_key, source) values ($1,'hat_01','shop')`, [uid]);
  cosDup = 'inserted';
} catch (e) { cosDup = e.code || 'error'; }
rec('user_cosmetics pk(user_id,part_key) rejects dup part', cosDup, '23505');
// 다른 파츠는 허용
await db.query(`insert into user_cosmetics (user_id, part_key) values ($1,'shoe_02')`, [uid]);
const cosN = (await db.query(`select count(*)::int n from user_cosmetics where user_id=$1`, [uid])).rows[0].n;
rec('user_cosmetics distinct part allowed (2 rows)', cosN, 2);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter(x => !x.pass).length;
console.log(`\nT-PHASE2-DATAMODEL: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-phase2-datamodel', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
