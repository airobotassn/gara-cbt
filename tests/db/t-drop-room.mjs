// T-Drop-Room — 가구·미니룸 제거(20260820160000)가 **실제로 다 지워졌는지** 검증.
//   옛 t-room.mjs(방 배치 검증)를 대체한다 — 검증 대상이던 `_shared/room.ts` 와 `user_rooms` 가 없어졌다.
//
// 왜 '지워졌다'를 테스트하나 (뽑기 제거 t-drop-gacha.mjs 와 같은 이유)
//   반쯤 남은 제거가 제일 나쁘다. 상점에 가구가 남아 있으면 **놓을 데도 없는 물건에 코인을 쓰고**,
//   그게 왜 안 되는지는 아무도 못 푼다. 그래서 "진열·소유·구매기록·배치표"가 전부 비었는지 본다.
//
// ⛔ 이 제거가 안전했던 근거: 걷어낼 때 프로덕션에 **산 사람이 한 명도 없었다**
//    (보유 0 · 구매 0 · 쓴 코인 0 · 배치된 방 0). 사람이 있었으면 소유는 남기고 진열만 내렸어야 한다.
//
// pglite 하네스 관례는 t-shop.mjs 와 동일(auth.users FK strip, Supabase 롤 선생성).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

await raw(`create role anon; create role authenticated; create role service_role;`);

const strip = (s) => s.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(strip(readFileSync('supabase/migrations/20260714000400_phase2_character.sql', 'utf8')));
await raw(readFileSync('supabase/migrations/20260714000500_gacha_shop.sql', 'utf8'));
// ⚠️ 방 꾸미기 마이그레이션이 gacha_exclusive 를 만지므로 그 표를 만든 두 개를 먼저 태운다
//    (뽑기 자체는 20260818120000 에서 제거됐고, 그 검증은 t-drop-gacha.mjs 가 한다).
await raw(strip(readFileSync('supabase/migrations/20260716120000_gacha_v2_dust.sql', 'utf8')));
await raw(strip(readFileSync('supabase/migrations/20260716130000_gacha_tuning.sql', 'utf8')));
// 가구·방을 만든 마이그레이션(방 꾸미기). 이게 있어야 '지워졌다'가 뜻을 갖는다.
await raw(strip(readFileSync('supabase/migrations/20260814090000_room_furniture.sql', 'utf8')));
// 뽑기 제거 — 한정 가구 2종이 여기서 카탈로그에서 내려간다.
await raw(readFileSync('supabase/migrations/20260818120000_drop_gacha.sql', 'utf8'));

const UID = '00000000-0000-0000-0000-0000000000b1';

// ── 제거 전 상태를 먼저 확인한다 ────────────────────────────────────────────
// 이게 없으면 "0건이라 통과" 가 *지워져서*인지 *애초에 없어서*인지 구분할 수 없다.
const before = (await q(`select count(*)::int n from shop_catalog where kind='furniture'`)).rows[0].n;
ok('0a 제거 전에는 가구가 진열돼 있다', before > 0, before);
const roomTableBefore = (await q(
  `select count(*)::int n from information_schema.tables where table_name='user_rooms'`)).rows[0].n;
eq('0b 제거 전에는 user_rooms 가 있다', roomTableBefore, 1);

// 소유·구매·배치를 일부러 만들어 둔다 — 제거가 이것들까지 치우는지 봐야 한다.
const fur = (await q(`select part_key from shop_catalog where kind='furniture' order by part_key limit 1`)).rows[0].part_key;
await q(`insert into user_cosmetics (user_id, part_key, source) values ($1,$2,'shop')`, [UID, fur]);
await q(`insert into shop_purchase (user_id, client_nonce, part_key, spent_points) values ($1,'n1',$2,150)`, [UID, fur]);
// ⚠️ $2 에 캐스트가 필요하다 — jsonb_build_object 는 인자 타입을 못 정해서 그냥 두면 준비 단계에서 터진다.
await q(`insert into user_rooms (user_id, slots) values ($1, jsonb_build_object('floor_1', $2::text))`, [UID, fur]);
// 가구가 아닌 것도 하나 둔다 — 제거가 **가구만** 건드리는지 보는 대조군이다.
await q(`insert into user_cosmetics (user_id, part_key, source) values ($1,'char_keep','grant')`, [UID]);
await q(`insert into shop_purchase (user_id, client_nonce, part_key, spent_points) values ($1,'n2','char_keep',500)`, [UID]);

// ── 제거 적용 ───────────────────────────────────────────────────────────────
await raw(readFileSync('supabase/migrations/20260820160000_drop_room_furniture.sql', 'utf8'));

// ── 1) 상점에서 사라졌나 ────────────────────────────────────────────────────
const catalogAfter = (await q(`select count(*)::int n from shop_catalog where kind='furniture'`)).rows[0].n;
eq('1a 상점 카탈로그에 가구가 없다', catalogAfter, 0);
// ⚠️ active=false 로 숨긴 게 아니라 행이 없어야 한다 — 숨기기만 하면 나중에 조용히 되살아난다.
const hidden = (await q(`select count(*)::int n from shop_catalog where part_key like 'fur\\_%'`)).rows[0].n;
eq('1b ⭐ 숨긴 게 아니라 행 자체가 없다', hidden, 0);

// ── 2) 소유·구매기록도 정리됐나 ─────────────────────────────────────────────
const ownedAfter = (await q(`select count(*)::int n from user_cosmetics where part_key like 'fur\\_%'`)).rows[0].n;
eq('2a 가구 소유가 없다', ownedAfter, 0);
const boughtAfter = (await q(`select count(*)::int n from shop_purchase where part_key like 'fur\\_%'`)).rows[0].n;
eq('2b 가구 구매기록이 없다', boughtAfter, 0);

// ⭐ 대조군 — 가구가 아닌 것은 그대로 남아야 한다. 이게 없으면 "전부 지웠다" 를 통과로 착각한다.
const keepOwned = (await q(`select count(*)::int n from user_cosmetics where part_key='char_keep'`)).rows[0].n;
eq('2c ⭐ 가구가 아닌 소유는 그대로', keepOwned, 1);
const keepBought = (await q(`select count(*)::int n from shop_purchase where part_key='char_keep'`)).rows[0].n;
eq('2d ⭐ 가구가 아닌 결제기록은 그대로', keepBought, 1);

// ── 3) 배치 표가 드롭됐나 ───────────────────────────────────────────────────
const roomTable = (await q(
  `select count(*)::int n from information_schema.tables where table_name='user_rooms'`)).rows[0].n;
eq('3a user_rooms 표가 없다', roomTable, 0);

// ── 4) 코드에서도 사라졌나 ──────────────────────────────────────────────────
// DB 만 지우고 코드가 남으면 배포 순간 함수가 없는 표를 읽으려다 터진다.
ok('4a _shared/room.ts 가 없다', !existsSync('supabase/functions/_shared/room.ts'), null);
ok('4b RoomView 컴포넌트가 없다', !existsSync('src/components/RoomView.tsx'), null);
const roomFn = readFileSync('supabase/functions/room/index.ts', 'utf8');
// ⚠️ 문자열 'save' 로 찾으면 **주석까지 걸린다**(왜 지웠는지 적어둔 줄). 실제 분기만 본다.
ok('4c room 함수에 저장(save) 분기가 없다', !/action\s*===\s*'save'/.test(roomFn), null);
ok('4d room 함수가 user_rooms 를 읽지 않는다', !roomFn.includes('user_rooms'), null);
// 남의 방은 계속 열려야 한다 — 랭킹·채팅의 '방 보기' 가 여기로 온다.
ok('4e ⭐ 남의 방 열람(view)은 살아 있다', roomFn.includes("'view'"), null);
ok('4f ⭐ 방이 캐릭터·스킨을 내려준다', roomFn.includes('character') && roomFn.includes('skin'), null);
const hub = readFileSync('supabase/functions/get-hub/index.ts', 'utf8');
ok('4g get-hub 가 방·가구를 내려주지 않는다', !hub.includes('user_rooms') && !hub.includes('furniture'), null);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-DROP-ROOM: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-drop-room', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
