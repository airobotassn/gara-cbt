// T-Room — 방 꾸미기(미니룸) 검증.
//   (A) 마이그레이션(20260814090000): 파츠 내림 · 가구 시드 · 면 CHECK · user_rooms
//   (B) 배치 검증 로직(_shared/room.ts): 소유·면·모르는 슬롯 처리
//
// 왜 이 둘을 한 파일에 두나: 이 기능의 정확성은 "DB 가 무엇을 허용하나" 와 "함수가 무엇을 거절하나"
// 두 쪽이 맞물려야 성립한다. 한쪽만 보면 "카탈로그엔 벽 가구인데 코드가 바닥에 놓아준다" 를 못 잡는다.
//
// pglite 하네스 관례는 t-shop.mjs 와 동일(auth.users FK strip, Supabase 롤 선생성).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { ROOM_LAYOUT, sanitizeSlots, validateSlots } from '../../supabase/functions/_shared/room.ts';

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

// 마이그레이션 **전** 상태를 찍어둔다 — "원래 그랬던 것" 과 "이번에 바뀐 것" 을 구분하기 위해.
const partsBefore = Number((await q(`select count(*) c from shop_catalog where active`)).rows[0].c);

await raw(load('supabase/migrations/20260814090000_room_furniture.sql'));
// 뽑기 제거 — 한정 가구 2종이 여기서 카탈로그에서 사라진다(그 마이그레이션 자체 검증은 t-drop-gacha.mjs).
await raw(readFileSync('supabase/migrations/20260818120000_drop_gacha.sql', 'utf8'));

// ============================================================
// A1) 파츠는 내려가고 가구만 남는다 — 소유 기록은 건드리지 않는다
// ============================================================
const activeParts = Number((await q(`select count(*) c from shop_catalog where active and kind='part'`)).rows[0].c);
eq('A1a 상점에 남은 파츠 0개', activeParts, 0);
ok('A1b 마이그레이션 전에는 파츠가 진열돼 있었다(대조군)', partsBefore > 0, partsBefore);
const inactiveParts = Number((await q(`select count(*) c from shop_catalog where kind='part' and not active`)).rows[0].c);
ok('A1c 파츠 행 자체는 지우지 않았다(이미 산 사람의 이름 표시용)', inactiveParts > 0, inactiveParts);

// ============================================================
// A2) 가구 시드 — 면이 반드시 있고, 상점 진열은 active 만
// ============================================================
const fur = (await q(`select part_key, surface, active, price from shop_catalog where kind='furniture' order by sort_order`)).rows;
eq('A2a 가구 10종', fur.length, 10);
ok('A2b 모든 가구에 면이 있다', fur.every((f) => f.surface === 'floor' || f.surface === 'wall'), fur.map((f) => f.surface));
eq('A2c 전부 상점에 진열된다(뽑기 전용 한정 2종은 삭제됨)', fur.filter((f) => f.active).length, 10);
ok('A2d 진열 가구는 값이 0원이 아니다', fur.filter((f) => f.active).every((f) => f.price > 0), fur.filter((f) => f.active).map((f) => f.price));

// ============================================================
// A3) 면 CHECK — 면 없는 가구도, 면 붙은 파츠도 못 들어간다
//     ⚠️ 이게 없으면 배치 검증이 "면을 모르는 물건" 을 만난다.
// ============================================================
let noSurface = null;
try { await q(`insert into shop_catalog(part_key,price,kind) values ('fur_bad_01',100,'furniture')`); }
catch (e) { noSurface = e.message || String(e); }
ok('A3a 면 없는 가구 거절', noSurface != null && /shop_catalog_kind_surface_chk/.test(noSurface), noSurface);

let partWithSurface = null;
try { await q(`insert into shop_catalog(part_key,price,kind,surface) values ('hat_bad_01',100,'part','wall')`); }
catch (e) { partWithSurface = e.message || String(e); }
ok('A3b 면 붙은 파츠 거절', partWithSurface != null && /shop_catalog_kind_surface_chk/.test(partWithSurface), partWithSurface);

// ============================================================
// A5) shop_buy RPC 는 한 줄도 안 고쳤는데 가구를 팔아야 한다
//     (소유를 user_cosmetics 로 통일한 설계가 실제로 성립하는지)
// ============================================================
const uid = '00000000-0000-0000-0000-0000000000a1';
await q(`insert into user_currency(user_id, points) values ($1, 1000)`, [uid]);
await q(`select shop_buy($1,'fur_sofa_01','n1')`, [uid]);
const boughtPts = Number((await q(`select points from user_currency where user_id=$1`, [uid])).rows[0].points);
eq('A5a 가구 구매로 코인 차감(1000-400)', boughtPts, 600);
const ownsSofa = Number((await q(`select count(*) c from user_cosmetics where user_id=$1 and part_key='fur_sofa_01'`, [uid])).rows[0].c);
eq('A5b 소유는 user_cosmetics 에 그대로 쌓인다', ownsSofa, 1);

let buyInactive = null;
try { await q(`select shop_buy($1,'hat_common_01','n2')`, [uid]); }
catch (e) { buyInactive = e.message || String(e); }
ok('A5c 상점에서 내린 파츠는 코인으로 못 산다(행은 남아 있어도 active=false)', buyInactive != null, buyInactive);

// ============================================================
// A6) user_rooms — service role 전용(정책 미부여)
// ============================================================
const roomTable = Number((await q(`select count(*) c from information_schema.tables where table_name='user_rooms'`)).rows[0].c);
eq('A6a user_rooms 생성됨', roomTable, 1);
const rls = (await q(`select relrowsecurity from pg_class where relname='user_rooms'`)).rows[0].relrowsecurity;
ok('A6b RLS 켜짐', rls === true, rls);
const policies = Number((await q(`select count(*) c from pg_policies where tablename='user_rooms'`)).rows[0].c);
eq('A6c 정책 0개 = service role 전용(클라 직접 쓰기 불가)', policies, 0);

// ============================================================
// B) 배치 검증(_shared/room.ts) — 소유·면·모르는 슬롯
// ============================================================
const surfaces = new Map(fur.map((f) => [f.part_key, f.surface]));
const owned = new Set(['fur_sofa_01', 'fur_clock_01']); // 바닥 하나 + 벽 하나
const floorSlot = ROOM_LAYOUT.find((s) => s.surface === 'floor').key;
const wallSlot = ROOM_LAYOUT.find((s) => s.surface === 'wall').key;

eq('B1 레이아웃 = 벽 2 + 바닥 3', [ROOM_LAYOUT.filter((s) => s.surface === 'wall').length, ROOM_LAYOUT.filter((s) => s.surface === 'floor').length], [2, 3]);
ok('B1b 슬롯이 오른쪽 레일(약 84%)과 겹치지 않는다', ROOM_LAYOUT.every((s) => s.x + 17 <= 84), ROOM_LAYOUT.map((s) => s.x + 17));
// 왼쪽 위 조작 버튼(.room-acts, 약 30%×25%) 자리 — 벽 슬롯을 여기 두면 버튼이 액자를 깔고 앉는다.
ok('B1c 벽 슬롯이 왼쪽 위 조작 버튼과 겹치지 않는다', ROOM_LAYOUT.filter((s) => s.surface === 'wall').every((s) => s.x >= 30), ROOM_LAYOUT.filter((s) => s.surface === 'wall').map((s) => s.x));

const good = validateSlots({ [floorSlot]: 'fur_sofa_01', [wallSlot]: 'fur_clock_01' }, owned, surfaces);
ok('B2 소유 + 면이 맞으면 통과', good.ok && Object.keys(good.slots).length === 2, good);

const notOwned = validateSlots({ [floorSlot]: 'fur_bed_01' }, owned, surfaces);
eq('B3 안 가진 가구는 not_owned', notOwned.ok ? 'ok' : notOwned.error, 'not_owned');

const wrongSurface = validateSlots({ [floorSlot]: 'fur_clock_01' }, owned, surfaces);
eq('B4 벽시계를 바닥에 놓으면 wrong_surface', wrongSurface.ok ? 'ok' : wrongSurface.error, 'wrong_surface');

const notFurniture = validateSlots({ [floorSlot]: 'hat_common_01' }, new Set(['hat_common_01']), surfaces);
eq('B5 가구가 아닌 것은 not_furniture(가진 것이어도)', notFurniture.ok ? 'ok' : notFurniture.error, 'not_furniture');

// 모르는 슬롯은 **거절이 아니라 무시**다 — 슬롯을 줄였을 때 옛 배치 때문에 저장이 통째로 막히면 안 된다.
const stale = validateSlots({ 'floor:99': 'fur_sofa_01', [floorSlot]: 'fur_sofa_01' }, owned, surfaces);
ok('B6 모르는 슬롯은 조용히 버린다(저장 자체를 막지 않는다)', stale.ok && !('floor:99' in stale.slots), stale);

eq('B7 sanitize 는 빈 값·비문자열을 버린다', sanitizeSlots({ [floorSlot]: '', [wallSlot]: 3, 'x:1': 'y' }), {});
eq('B8 sanitize 는 객체가 아니면 빈 방', sanitizeSlots(null), {});

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-ROOM: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-room', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
