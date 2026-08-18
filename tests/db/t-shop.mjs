// T-Shop — 서버권위 상점 원자 RPC(shop_buy)를 pglite(WASM Postgres 18)에서 검증.
//  · phase2 테이블 DDL(20260714000400) + 함수 DDL(20260714000500)을 적용하고 실제 함수를 호출한다.
//  · auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거(하네스 strip).
//  · Supabase 롤(anon/authenticated/service_role)은 revoke/grant 대상이므로 미리 생성.
//
// ⚠️ 이 파일은 옛 t-gacha-shop.mjs 에서 **뽑기 절반을 걷어낸 것**이다(뽑기 제거 · 20260818120000).
//    20260714000500 은 아직 gacha_pool·gacha_draw 를 만들지만 지금 DB 에는 없다 —
//    그 제거가 실제로 되는지는 t-drop-gacha.mjs 가 본다.
//  검증:
//   1) shop_buy 차감 + 파츠 지급 + nonce 멱등 + 카탈로그 권위(invalid_part) + 잔액 부족
//   2) 모든 연산 후 user_progress / user_level_skill 불변(cosmetic-only 하드 불변식)
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

const uid = '00000000-0000-0000-0000-000000000002';
await q(`insert into user_progress (user_id, rank, points) values ($1, 7, 1234)`, [uid]);
await q(`insert into user_level_skill (user_id, skill_key, level) values ($1, 'grammar', 5)`, [uid]);
// 불변식 스냅샷
const progBefore = JSON.stringify((await q(`select * from user_progress order by user_id`)).rows);
const skillBefore = JSON.stringify((await q(`select * from user_level_skill order by user_id, skill_key`)).rows);

// ---- 상점 카탈로그 테스트 시드: 가격은 서버 권위(클라이언트 가격 파라미터 없음) ----
await raw(`
  insert into shop_catalog (part_key, price) values
    ('shop_hat', 200),
    ('shop_cape', 500)
  on conflict (part_key) do nothing;
`);

// ============================================================
// 1) shop_buy: 차감 + 파츠 지급 + nonce 멱등 + 부족 raise
// ============================================================
await q(`insert into user_currency (user_id, points) values ($1, 1000)`, [uid]);
const s1 = (await q(`select shop_buy($1,'shop_hat','s1') as r`, [uid])).rows[0].r;
eq('1a shop grants shop_hat', s1.part_key, 'shop_hat');
eq('1b spent_points 200 (CATALOG price, no client value)', Number(s1.spent_points), 200);
eq('1c points_after 800', Number(s1.points_after), 800);
const ownsHat = (await q(`select count(*)::int n from user_cosmetics where user_id=$1 and part_key='shop_hat'`, [uid])).rows[0].n;
eq('1d shop_hat granted', ownsHat, 1);
// 멱등
const s1again = (await q(`select shop_buy($1,'shop_hat','s1') as r`, [uid])).rows[0].r;
eq('1e shop idempotent same result', s1again.part_key, 'shop_hat');
const ptsShopIdem = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('1f shop no double-debit (still 800)', ptsShopIdem, 800);
const shopLogN = (await q(`select count(*)::int n from shop_purchase where user_id=$1 and client_nonce='s1'`, [uid])).rows[0].n;
eq('1g single shop_purchase row for s1', shopLogN, 1);
// 카탈로그에 없는 파츠 → invalid_part raise
let invalidErr = null;
try {
  await q(`select shop_buy($1,'not_a_real_part','s_inv') as r`, [uid]);
} catch (e) { invalidErr = e.message || String(e); }
ok('1h invalid part_key raises invalid_part', invalidErr != null && /invalid_part/.test(invalidErr), invalidErr);
const ptsAfterInvalid = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('1i points unchanged after invalid_part (still 800)', ptsAfterInvalid, 800);
// 부족(shop_cape 카탈로그가=500, 잔액 100) → insufficient_points raise
await q(`update user_currency set points = 100 where user_id=$1`, [uid]);
let shopInsuf = null;
try {
  await q(`select shop_buy($1,'shop_cape','s2') as r`, [uid]);
} catch (e) { shopInsuf = e.message || String(e); }
ok('1j shop insufficient raises', shopInsuf != null && /insufficient_points/.test(shopInsuf), shopInsuf);
const ptsShopUnchanged = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('1k shop points unchanged after failed buy (still 100)', ptsShopUnchanged, 100);

// ============================================================
// 2) cosmetic-only 하드 불변식: user_progress / user_level_skill 불변
// ============================================================
const progAfter = JSON.stringify((await q(`select * from user_progress order by user_id`)).rows);
const skillAfter = JSON.stringify((await q(`select * from user_level_skill order by user_id, skill_key`)).rows);
ok('2a user_progress UNCHANGED after all economy ops', progAfter === progBefore, { before: progBefore, after: progAfter });
ok('2b user_level_skill UNCHANGED after all economy ops', skillAfter === skillBefore, { before: skillBefore, after: skillAfter });

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-SHOP: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-shop', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
