// T-Drop-Gacha — 뽑기 제거 마이그레이션(20260818120000)이 실제로 무엇을 지우고 무엇을 남기는지 검증.
//
// 왜 이 테스트가 필요한가
//   드롭은 되돌릴 수 없다. "지웠다" 는 실행해보면 알지만, **안 지워야 할 것까지 지웠는지**는
//   실행만으로는 안 보인다 — 남의 방 배치, 상점 가구, 소유 기록, shop_buy 가 그 대상이다.
//   특히 방 슬롯 정리는 값(가구키)을 보고 지워야 하는데 키(슬롯키)를 보면 한 행도 안 걸린 채
//   조용히 통과한다 — 그 실수가 나면 카탈로그에 없는 가구가 방에 남는다.
//
// pglite 하네스 관례는 t-shop.mjs 와 동일(auth.users FK strip, Supabase 롤 선생성).
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

const strip = (s) => s.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
const load = (p) => strip(readFileSync(p, 'utf8'));

await raw(`create role anon; create role authenticated; create role service_role;`);
await raw(load('supabase/migrations/20260714000400_phase2_character.sql'));
await raw(load('supabase/migrations/20260714000500_gacha_shop.sql'));
await raw(load('supabase/migrations/20260716120000_gacha_v2_dust.sql'));
await raw(load('supabase/migrations/20260716130000_gacha_tuning.sql'));
await raw(load('supabase/migrations/20260814090000_room_furniture.sql'));

// ── 드롭 **전** 상태를 만든다 ──────────────────────────────────────────────
// 한정 가구를 가진 사람 + 그걸 방에 놓아둔 사람. 안 만들면 "지울 게 없어서 통과" 가 된다.
const uid = '00000000-0000-0000-0000-0000000000d1';
await q(`insert into user_currency (user_id, points) values ($1, 1000)`, [uid]);
await q(`insert into user_cosmetics (user_id, part_key, source) values
           ($1,'fur_aquarium_01','gacha'), ($1,'fur_neon_01','gacha'), ($1,'fur_sofa_01','shop')`, [uid]);
await q(`insert into user_rooms (user_id, slots) values
           ($1, '{"floor:1":"fur_aquarium_01","floor:2":"fur_sofa_01","wall:1":"fur_neon_01"}'::jsonb)`, [uid]);
const dustColBefore = Number((await q(
  `select count(*) c from information_schema.columns where table_name='user_currency' and column_name='dust'`,
)).rows[0].c);
ok('0a 대조군 — 드롭 전에는 가루 컬럼이 있었다', dustColBefore === 1, dustColBefore);

// ── 드롭 ───────────────────────────────────────────────────────────────────
await raw(readFileSync('supabase/migrations/20260818120000_drop_gacha.sql', 'utf8'));

// ============================================================
// 1) 한정 가구 2종 — 방 · 소유 · 카탈로그에서 사라진다
// ============================================================
const slots = (await q(`select slots from user_rooms where user_id=$1`, [uid])).rows[0].slots;
eq('1a 한정 가구를 놓았던 슬롯만 비었다', slots, { 'floor:2': 'fur_sofa_01' });
const ownedLimited = Number((await q(
  `select count(*) c from user_cosmetics where part_key in ('fur_aquarium_01','fur_neon_01')`,
)).rows[0].c);
eq('1b 한정 가구 소유 기록 삭제', ownedLimited, 0);
const ownedSofa = Number((await q(
  `select count(*) c from user_cosmetics where user_id=$1 and part_key='fur_sofa_01'`, [uid],
)).rows[0].c);
eq('1c 나머지 소유는 그대로', ownedSofa, 1);
const catLimited = Number((await q(
  `select count(*) c from shop_catalog where part_key in ('fur_aquarium_01','fur_neon_01')`,
)).rows[0].c);
eq('1d 카탈로그에서도 삭제', catLimited, 0);
const shopFur = Number((await q(`select count(*) c from shop_catalog where kind='furniture' and active`)).rows[0].c);
eq('1e 상점 가구 10종은 그대로 진열', shopFur, 10);

// ============================================================
// 2) 실행 경로 — 함수 · 표 · 컬럼이 없다
// ============================================================
for (const fn of ['gacha_draw', 'gacha_exchange']) {
  const n = Number((await q(`select count(*) c from pg_proc where proname=$1`, [fn])).rows[0].c);
  eq(`2a ${fn}() 제거`, n, 0);
}
for (const t of ['gacha_pool', 'gacha_exclusive', 'gacha_log', 'user_gacha_pity', 'dust_exchange']) {
  const n = Number((await q(
    `select count(*) c from information_schema.tables where table_schema='public' and table_name=$1`, [t],
  )).rows[0].c);
  eq(`2b ${t} 제거`, n, 0);
}
const dustCol = Number((await q(
  `select count(*) c from information_schema.columns where table_name='user_currency' and column_name='dust'`,
)).rows[0].c);
eq('2c user_currency.dust 제거', dustCol, 0);

// ============================================================
// 3) 상점은 그대로 돈다 — 코인 지갑은 남았고 가구도 판다
// ============================================================
const buy = (await q(`select shop_buy($1,'fur_lamp_01','n1') as r`, [uid])).rows[0].r;
eq('3a 가구 구매 성공', buy.part_key, 'fur_lamp_01');
eq('3b 코인 차감(1000-200)', Number(buy.points_after), 800);
let gone = null;
try { await q(`select shop_buy($1,'fur_aquarium_01','n2')`, [uid]); }
catch (e) { gone = e.message || String(e); }
ok('3c 지워진 한정 가구는 살 수 없다(invalid_part)', gone != null && /invalid_part/.test(gone), gone);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-DROP-GACHA: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-drop-gacha', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
