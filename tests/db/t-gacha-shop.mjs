// T-Gacha-Shop — 서버권위 뽑기/상점 원자 RPC(gacha_draw / shop_buy)를 pglite(WASM Postgres 18)에서 검증.
//  · phase2 테이블 DDL(20260714000400) + 함수 DDL(20260714000500)을 적용하고 실제 함수를 호출한다.
//  · auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거(하네스 strip).
//  · Supabase 롤(anon/authenticated/service_role)은 revoke/grant 대상이므로 미리 생성.
//  검증:
//   1) gacha_draw 가 파츠를 지급하고 DRAW_COST(100) 차감 → points 1000→900
//   2) NEVER null — 결과 part_key 는 항상 존재(no-blank)
//   3) 멱등 — 같은 nonce 는 동일 결과 반환 + 이중 차감 없음
//   4) 중복 파츠 draw → was_dupe=true + DUPE_REFUND(20) 환급
//   5) 천장 카운터 증가 + PITY_CEILING 도달 시 희귀 강제
//   6) 포인트 부족 → 'insufficient_points' raise
//   7) shop_buy 차감 + 파츠 지급 + nonce 멱등
//   8) 모든 연산 후 user_progress / user_level_skill 불변(cosmetic-only 하드 불변식)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- Supabase 롤 모형(revoke/grant 대상) ----
await raw(`create role anon; create role authenticated; create role service_role;`);

// ---- phase2 테이블 DDL (auth.users FK strip) ----
const p2raw = readFileSync('supabase/migrations/20260714000400_phase2_character.sql', 'utf8');
const p2 = p2raw.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(p2);

// ---- 함수 DDL (auth 참조 없음 → strip 불필요) ----
const fnraw = readFileSync('supabase/migrations/20260714000500_gacha_shop.sql', 'utf8');
await raw(fnraw);

// ---- cosmetic-only 불변식 대상 테이블(최소) + 1행씩 시드 ----
await raw(`
  create table user_progress (
    user_id    uuid primary key,
    rank       int not null,
    points     int not null default 0,
    updated_at timestamptz default now()
  );
  create table user_level_skill (
    user_id   uuid,
    skill_key text not null,
    level     int not null default 0,
    primary key (user_id, skill_key)
  );
`);

const uid = '00000000-0000-0000-0000-000000000001';
const uid2 = '00000000-0000-0000-0000-000000000002';
await q(`insert into user_progress (user_id, rank, points) values ($1, 7, 1234)`, [uid]);
await q(`insert into user_level_skill (user_id, skill_key, level) values ($1, 'grammar', 5)`, [uid]);
// 불변식 스냅샷
const progBefore = JSON.stringify((await q(`select * from user_progress order by user_id`)).rows);
const skillBefore = JSON.stringify((await q(`select * from user_level_skill order by user_id, skill_key`)).rows);

// ---- 테스트 전용 풀 시드 ----
//  incpool: 단일 흔함 파츠 → 결정적(항상 inc_part). no-blank/차감/멱등/중복/천장증가 검증용.
//  ceilpool: 흔함 1 + 희귀 1 → 천장 강제 시 희귀만 후보(c_rare 결정적).
await raw(`
  insert into gacha_pool (pool_key, part_key, weight, is_rare) values
    ('incpool', 'inc_part', 10, false),
    ('ceilpool', 'c_common', 10, false),
    ('ceilpool', 'c_rare',   10, true);
`);

// ---- 상점 카탈로그 테스트 시드: 가격은 서버 권위(클라이언트 가격 파라미터 없음) ----
await raw(`
  insert into shop_catalog (part_key, price) values
    ('shop_hat', 200),
    ('shop_cape', 500)
  on conflict (part_key) do nothing;
`);

// ---- 재화 시드: uid=1000p ----
await q(`insert into user_currency (user_id, points) values ($1, 1000)`, [uid]);

// ============================================================
// 1) 기본 draw: 파츠 지급 + DRAW_COST 차감 (1000 → 900)
// ============================================================
const d1 = (await q(`select gacha_draw($1,'incpool','n1') as r`, [uid])).rows[0].r;
ok('1a draw returns a part (NEVER blank)', d1.part_key != null && d1.part_key !== '', d1.part_key);
eq('1b draw grants inc_part (deterministic solo pool)', d1.part_key, 'inc_part');
eq('1c points_after = 900 (DRAW_COST 100 debited)', Number(d1.points_after), 900);
eq('1d was_dupe false on first', d1.was_dupe, false);
eq('1e pity_before 0', Number(d1.pity_before), 0);
const ptsAfter1 = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('1f user_currency reflects 900', ptsAfter1, 900);
const ownsInc = (await q(`select count(*)::int n from user_cosmetics where user_id=$1 and part_key='inc_part'`, [uid])).rows[0].n;
eq('1g inc_part granted in user_cosmetics', ownsInc, 1);
const pityInc = Number((await q(`select counter from user_gacha_pity where user_id=$1 and pool_key='incpool'`, [uid])).rows[0].counter);
eq('1h pity counter incremented to 1 (common)', pityInc, 1);

// ============================================================
// 3) 멱등: 같은 nonce n1 → 동일 결과 + 이중 차감 없음
// ============================================================
const d1again = (await q(`select gacha_draw($1,'incpool','n1') as r`, [uid])).rows[0].r;
eq('3a idempotent same part_key', d1again.part_key, d1.part_key);
eq('3b idempotent same pity_before', d1again.pity_before, d1.pity_before);
const ptsIdem = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('3c no double-debit (still 900)', ptsIdem, 900);
const logN1 = (await q(`select count(*)::int n from gacha_log where user_id=$1 and client_nonce='n1'`, [uid])).rows[0].n;
eq('3d single gacha_log row for n1', logN1, 1);

// ============================================================
// 4) 중복 draw(new nonce, 이미 보유 inc_part) → was_dupe + DUPE_REFUND 환급
//    points: 900 - 100(debit) + 20(refund) = 820
// ============================================================
const d2 = (await q(`select gacha_draw($1,'incpool','n2') as r`, [uid])).rows[0].r;
eq('4a was_dupe true (already owned)', d2.was_dupe, true);
eq('4b refund_points = DUPE_REFUND 20', Number(d2.refund_points), 20);
eq('4c points_after = 820 (debit 100, refund 20)', Number(d2.points_after), 820);
eq('4d pity_before 1 (from prior draw)', Number(d2.pity_before), 1);
const pityInc2 = Number((await q(`select counter from user_gacha_pity where user_id=$1 and pool_key='incpool'`, [uid])).rows[0].counter);
eq('4e pity counter incremented to 2', pityInc2, 2);

// ============================================================
// 5) 천장: counter=50 세팅 → 희귀 강제 → c_rare + pity reset 0
// ============================================================
await q(`insert into user_gacha_pity (user_id, pool_key, counter) values ($1,'ceilpool',50)
         on conflict (user_id,pool_key) do update set counter=50`, [uid]);
const dCeil = (await q(`select gacha_draw($1,'ceilpool','n3') as r`, [uid])).rows[0].r;
eq('5a ceiling forces rare part (c_rare)', dCeil.part_key, 'c_rare');
eq('5b pity_before was 50', Number(dCeil.pity_before), 50);
const isRare = (await q(`select is_rare from gacha_pool where pool_key='ceilpool' and part_key=$1`, [dCeil.part_key])).rows[0].is_rare;
ok('5c drawn part is_rare=true', isRare === true, isRare);
const pityReset = Number((await q(`select counter from user_gacha_pity where user_id=$1 and pool_key='ceilpool'`, [uid])).rows[0].counter);
eq('5d pity reset to 0 after rare', pityReset, 0);
// points: 820 - 100 = 720 (c_rare 신규, 환급 없음)
eq('5e points_after 720', Number(dCeil.points_after), 720);

// ============================================================
// 6) 포인트 부족 → 'insufficient_points' raise
// ============================================================
await q(`update user_currency set points = 50 where user_id=$1`, [uid]);
let insufErr = null;
try {
  await q(`select gacha_draw($1,'incpool','n4') as r`, [uid]);
} catch (e) { insufErr = e.message || String(e); }
ok('6a insufficient points raises', insufErr != null && /insufficient_points/.test(insufErr), insufErr);
const ptsUnchanged = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('6b points unchanged after failed draw (still 50)', ptsUnchanged, 50);
const logN4 = (await q(`select count(*)::int n from gacha_log where user_id=$1 and client_nonce='n4'`, [uid])).rows[0].n;
eq('6c no gacha_log row for failed draw', logN4, 0);

// ============================================================
// 7) shop_buy: 차감 + 파츠 지급 + nonce 멱등 + 부족 raise
// ============================================================
await q(`insert into user_currency (user_id, points) values ($1, 1000)`, [uid2]);
const s1 = (await q(`select shop_buy($1,'shop_hat','s1') as r`, [uid2])).rows[0].r;
eq('7a shop grants shop_hat', s1.part_key, 'shop_hat');
eq('7b spent_points 200 (CATALOG price, no client value)', Number(s1.spent_points), 200);
eq('7c points_after 800', Number(s1.points_after), 800);
const ownsHat = (await q(`select count(*)::int n from user_cosmetics where user_id=$1 and part_key='shop_hat'`, [uid2])).rows[0].n;
eq('7d shop_hat granted', ownsHat, 1);
// 멱등
const s1again = (await q(`select shop_buy($1,'shop_hat','s1') as r`, [uid2])).rows[0].r;
eq('7e shop idempotent same result', s1again.part_key, 'shop_hat');
const ptsShopIdem = Number((await q(`select points from user_currency where user_id=$1`, [uid2])).rows[0].points);
eq('7f shop no double-debit (still 800)', ptsShopIdem, 800);
const shopLogN = (await q(`select count(*)::int n from shop_purchase where user_id=$1 and client_nonce='s1'`, [uid2])).rows[0].n;
eq('7g single shop_purchase row for s1', shopLogN, 1);
// 카탈로그에 없는 파츠 → invalid_part raise
let invalidErr = null;
try {
  await q(`select shop_buy($1,'not_a_real_part','s_inv') as r`, [uid2]);
} catch (e) { invalidErr = e.message || String(e); }
ok('7h invalid part_key raises invalid_part', invalidErr != null && /invalid_part/.test(invalidErr), invalidErr);
const ptsAfterInvalid = Number((await q(`select points from user_currency where user_id=$1`, [uid2])).rows[0].points);
eq('7i points unchanged after invalid_part (still 800)', ptsAfterInvalid, 800);
// 부족(shop_cape 카탈로그가=500, 잔액 100) → insufficient_points raise
await q(`update user_currency set points = 100 where user_id=$1`, [uid2]);
let shopInsuf = null;
try {
  await q(`select shop_buy($1,'shop_cape','s2') as r`, [uid2]);
} catch (e) { shopInsuf = e.message || String(e); }
ok('7j shop insufficient raises', shopInsuf != null && /insufficient_points/.test(shopInsuf), shopInsuf);
const ptsShopUnchanged = Number((await q(`select points from user_currency where user_id=$1`, [uid2])).rows[0].points);
eq('7k shop points unchanged after failed buy (still 100)', ptsShopUnchanged, 100);

// ============================================================
// 8) cosmetic-only 하드 불변식: user_progress / user_level_skill 불변
// ============================================================
const progAfter = JSON.stringify((await q(`select * from user_progress order by user_id`)).rows);
const skillAfter = JSON.stringify((await q(`select * from user_level_skill order by user_id, skill_key`)).rows);
ok('8a user_progress UNCHANGED after all economy ops', progAfter === progBefore, { before: progBefore, after: progAfter });
ok('8b user_level_skill UNCHANGED after all economy ops', skillAfter === skillBefore, { before: skillBefore, after: skillAfter });

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-GACHA-SHOP: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-gacha-shop', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
