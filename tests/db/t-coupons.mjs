// T-Coupons — 레벨업 쿠폰 발급 규칙을 pglite(WASM Postgres 18)에서 검증.
//  · coupons/user_coupons DDL(20260714000700)을 적용(auth.users FK strip)하고,
//    applyAttempt 의 발급 side-effect 를 SQL 로 재현한다.
//    (발급 조건: rankAfter > rankBefore → insert user_coupons on conflict(user_id,issued_for_level) do nothing.)
//  검증:
//   1) level 1→2 = 1장, 2→3 = 1장 발급
//   2) 강등 3→2 = 0장(레벨업 아님), 재승급 2→3 = 0장(행 존재 → 유니크 충돌)
//   3) 유저 총 쿠폰 = 2, issued_for_level 당 1장, 유니크 제약이 중복 차단
//   4) 레벨 2..7 최초 도달 = 최대 6장
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

// ---- 쿠폰 테이블 DDL (auth.users FK strip) ----
const ddlRaw = readFileSync('supabase/migrations/20260714000700_coupons.sql', 'utf8');
const ddl = ddlRaw.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(ddl);

// ---- 등급 테이블(최소) ----
await raw(`create table if not exists user_progress (
  user_id uuid primary key, rank int not null default 1, points int default 0,
  demotion_strikes int default 0, updated_at timestamptz default now());`);

const uid = '00000000-0000-0000-0000-000000000001';
await q(`insert into user_progress (user_id, rank) values ($1, 1)`, [uid]);

// LEVELUP10 seed 확인
const seed = (await q(`select discount, issue_condition from coupons where code='LEVELUP10'`)).rows[0];
ok('0a seed LEVELUP10 present', seed != null, seed);
eq('0b seed discount 10', Number(seed?.discount), 10);
eq('0c seed condition level_first_reach', seed?.issue_condition, 'level_first_reach');

// applyAttempt 발급 side-effect 재현: rankAfter>rankBefore 일 때만 발급.
// 반환값 = 실제 삽입된 행 수(발급 장수).
async function apply(rankBefore, rankAfter) {
  // user_progress 이동(발급과 무관하게 항상 upsert)
  await q(`insert into user_progress (user_id, rank) values ($1,$2)
           on conflict (user_id) do update set rank=excluded.rank`, [uid, rankAfter]);
  if (rankAfter > rankBefore) {
    const r = await q(
      `insert into user_coupons (user_id, issued_for_level, coupon_code)
       values ($1,$2,'LEVELUP10')
       on conflict (user_id, issued_for_level) do nothing
       returning id`, [uid, rankAfter]);
    return r.rows.length; // 1 = 발급, 0 = 유니크 충돌로 무발급
  }
  return 0;
}

// ---- 시퀀스: 1→2, 2→3, 3→2(강등), 2→3(재승급) ----
const i12 = await apply(1, 2);
eq('1a level 1→2 issues 1', i12, 1);
const i23 = await apply(2, 3);
eq('1b level 2→3 issues 1', i23, 1);
const i32 = await apply(3, 2);
eq('2a demote 3→2 issues 0 (not a level-up)', i32, 0);
const i23b = await apply(2, 3);
eq('2b re-promote 2→3 issues 0 (row exists, unique conflict)', i23b, 0);

// ---- 총계 / 분포 ----
const total = Number((await q(`select count(*)::int n from user_coupons where user_id=$1`, [uid])).rows[0].n);
eq('3a total coupons for user = 2', total, 2);
const perLevel = (await q(
  `select issued_for_level, count(*)::int n from user_coupons where user_id=$1
   group by issued_for_level order by issued_for_level`, [uid])).rows
  .map((r) => [Number(r.issued_for_level), Number(r.n)]);
eq('3b one coupon per issued_for_level (levels 2,3)', perLevel, [[2, 1], [3, 1]]);

// 유니크 제약이 명시적 dup insert 를 차단(do nothing 없이 raw insert → error)
let dupErr = null;
try {
  await q(`insert into user_coupons (user_id, issued_for_level, coupon_code) values ($1,2,'LEVELUP10')`, [uid]);
} catch (e) { dupErr = e.message || String(e); }
ok('3c unique(user_id,issued_for_level) blocks dup', dupErr != null && /unique|duplicate/i.test(dupErr), dupErr);

// ---- 레벨 2..7 최초 도달 = 최대 6장 ----
const uid2 = '00000000-0000-0000-0000-000000000002';
await q(`insert into user_progress (user_id, rank) values ($1, 1)`, [uid2]);
async function apply2(rankBefore, rankAfter) {
  await q(`insert into user_progress (user_id, rank) values ($1,$2)
           on conflict (user_id) do update set rank=excluded.rank`, [uid2, rankAfter]);
  if (rankAfter > rankBefore) {
    const r = await q(
      `insert into user_coupons (user_id, issued_for_level, coupon_code)
       values ($1,$2,'LEVELUP10')
       on conflict (user_id, issued_for_level) do nothing returning id`, [uid2, rankAfter]);
    return r.rows.length;
  }
  return 0;
}
let issued = 0;
for (let lvl = 1; lvl < 7; lvl++) issued += await apply2(lvl, lvl + 1); // 1→2 ... 6→7
eq('4a levels 2..7 first reach = 6 coupons issued', issued, 6);
const total2 = Number((await q(`select count(*)::int n from user_coupons where user_id=$1`, [uid2])).rows[0].n);
eq('4b uid2 total = 6 (max, one per level 2..7)', total2, 6);
// 재도전으로 더 못 받음(전부 재승급이면 0장)
let reissue = 0;
for (let lvl = 2; lvl <= 7; lvl++) reissue += await apply2(lvl - 1, lvl);
eq('4c re-reaching levels 2..7 issues 0 more', reissue, 0);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-COUPONS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-coupons', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
