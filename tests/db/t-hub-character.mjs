// T-Hub-Character — 캐릭터 선택 · 꾸미기 장착 · 튜토리얼 RPC 를 pglite(WASM Postgres 18)에서 검증.
//   대상 = 20260820120000_hub_character_skin.sql 의 hub_choose_character · hub_equip · hub_tutorial_done
//          + 같은 파일이 갈아끼운 admin_reset_onboarding.
//
// 이 스위트가 지키는 것 — 전부 "틀렸을 때 조용히 손해가 나는" 자리다:
//   1) 첫 선택은 **한 번뿐**이고 무료다. chosen_at 이 그 표시고, 갈아입어도 밀리지 않는다.
//      (밀리면 갈아입을 때마다 첫 선택 무료가 다시 열려 유료 캐릭터를 공짜로 가져간다)
//   2) 첫 선택은 **판매 중인 캐릭터 아무거나** 한 종을 공짜로 준다(값은 안 본다 — 20260824120000).
//      진열에서 내린 것만 거절한다. 그 뒤로는 상점에서 산 것만 갈아입는다.
//   3) 갈아입기는 **소유한 것만**. 상점을 거치지 않고 장착하는 경로를 막는다.
//   4) equip 은 equipped jsonb 의 **한 키만** 갱신한다(통째로 덮으면 다른 종류가 지워진다).
//   5) 종류가 맞아야 한다 — 스킨 자리에 가구를 꽂을 수 없다.
//   6) 튜토리얼 완료 시각은 처음 값을 지킨다(멱등).
//   7) 관리자 초기화는 캐릭터·튜토리얼을 비우되 **소유(user_cosmetics)는 건드리지 않는다**.
//
// ⚠️ auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거(하네스 strip).
// ⚠️ profiles·set_config 트리거가 없는 최소 모형이라 admin_reset_onboarding 은 GUC 만 흉내 낸다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
// jsonb 는 키 순서를 보장하지 않는다 — 통째로 문자열 비교하면 값이 맞아도 어긋난다.
const eqObj = (name, got, want) => {
  const norm = (o) => JSON.stringify(Object.fromEntries(Object.entries(o ?? {}).sort()));
  rec(name, got, want, norm(got) === norm(want));
};
const ok = (name, cond, got) => rec(name, got, true, !!cond);
async function raises(sql, params) {
  try { await q(sql, params); return null; } catch (e) { return e.message || String(e); }
}

// ---- Supabase 롤(revoke 대상) ----
await raw(`create role anon; create role authenticated; create role service_role;`);

// ---- phase2 테이블(user_characters·user_currency·user_cosmetics…) ----
const strip = (s) => s.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(strip(readFileSync('supabase/migrations/20260714000400_phase2_character.sql', 'utf8')));
// shop_catalog 와 shop_buy 는 이쪽에 있다(t-shop.mjs 와 같은 조합).
//   ⚠️ 이 파일은 아직 gacha_* 도 만든다 — 실제 DB 에서 지워진 건 20260818120000 이고,
//      그 제거는 t-drop-gacha.mjs 가 본다. 여기서는 상점 테이블만 있으면 된다.
await raw(readFileSync('supabase/migrations/20260714000500_gacha_shop.sql', 'utf8'));

// ---- profiles 최소 모형 — admin_reset_onboarding 이 만지는 컬럼만 ----
await raw(`
  create table profiles (
    id uuid primary key,
    nickname_set_at   timestamptz,
    region_locked_at  timestamptz,
    region_changed_at timestamptz,
    country_code text,
    region_code  text,
    age_band     text,
    display_name text
  );
`);

// ---- 검증 대상 마이그레이션 ----
// admin_reset_onboarding 은 이 파일이 `create or replace` 로 갈아끼운다 → 원본을 먼저 깔아야
// "반환형을 안 바꿨다"까지 같이 검증된다(바꿨으면 여기서 터진다).
await raw(readFileSync('supabase/migrations/20260819170000_admin_reset_onboarding.sql', 'utf8'));
await raw(readFileSync('supabase/migrations/20260820120000_hub_character_skin.sql', 'utf8'));
// 캐릭터 값 매기기(500) + 첫 선택 자격을 값에서 '판매 중'으로 옮긴 판. 원본을 먼저 깔아야
// `create or replace` 가 실제로 갈아끼우는지까지 같이 검증된다.
await raw(readFileSync('supabase/migrations/20260824120000_hub_character_price.sql', 'utf8'));

const U = '00000000-0000-0000-0000-0000000000a1';
const V = '00000000-0000-0000-0000-0000000000a2';
await q(`insert into profiles (id, display_name, nickname_set_at, region_locked_at, country_code, region_code, age_band, region_changed_at)
         values ($1,'홍길동', now(), now(), 'KR','KR-11','20s', now())`, [U]);
await q(`insert into profiles (id, display_name) values ($1,'이몽룡')`, [V]);

// 유료 캐릭터 · 유료 스킨 한 벌씩 추가(시드는 전부 무료라 자격 판정을 못 본다)
await raw(`
  insert into shop_catalog (part_key, price, kind, sort_order, active) values
    ('char_paid_m', 500, 'character', 90, true),
    ('skin_neon',   800, 'skin',     110, true),
    ('fur_test_01', 100, 'furniture', 200, true)
  on conflict (part_key) do nothing;
`);

// ============================================================
// 0) 마이그레이션이 심은 것
// ============================================================
const priced = (await q(`select count(*)::int n from shop_catalog
                          where part_key in ('char_a_m','char_a_f','char_b_m','char_b_f','char_c_m','char_c_f')
                            and kind='character' and price=500 and active`)).rows[0].n;
eq('0a 캐릭터 6종이 500 으로 매겨졌다(판매 중)', priced, 6);
// ⛔ 값 0인 캐릭터가 남아 있으면 상점에 공짜 캐릭터가 서 있게 된다.
const freeChars = (await q(`select count(*)::int n from shop_catalog where kind='character' and price=0`)).rows[0].n;
eq('0d 값 0인 캐릭터는 남아 있지 않다', freeChars, 0);
const cols = (await q(`select column_name from information_schema.columns
                        where table_name='user_characters' and column_name in ('chosen_at','tutorial_done_at')
                        order by column_name`)).rows.map((r) => r.column_name);
eq('0b user_characters 에 진행 표시 두 칸', cols, ['chosen_at', 'tutorial_done_at']);
// 기본 스킨은 **비판매**다 — 전원이 쓰는 바탕이라 살 물건이 아니다.
const palaceActive = (await q(`select active from shop_catalog where part_key='skin_palace'`)).rows[0].active;
eq('0c 기본 스킨(skin_palace)은 상점에 안 뜬다', palaceActive, false);

// ============================================================
// 1) 첫 선택 — 무료 지급 + 장착 + chosen_at
// ============================================================
const first = (await q(`select hub_choose_character($1,'char_a_m') as r`, [U])).rows[0].r;
eqObj('1a 첫 선택이라고 알려준다', first, { base_key: 'char_a_m', first: true });
const row1 = (await q(`select base_key, chosen_at is not null chosen, tutorial_done_at is null tut_null
                         from user_characters where user_id=$1`, [U])).rows[0];
eq('1b 장착됐다', row1.base_key, 'char_a_m');
ok('1c chosen_at 이 찍혔다', row1.chosen === true, row1.chosen);
ok('1d 튜토리얼은 아직 안 끝났다', row1.tut_null === true, row1.tut_null);
const src = (await q(`select source from user_cosmetics where user_id=$1 and part_key='char_a_m'`, [U])).rows[0];
eq('1e 무료 지급 기록이 starter 로 남는다', src.source, 'starter');
// ⛔ 무료 지급인데 코인이 빠지면 안 된다(shop_buy 와 다른 경로다).
const coin1 = (await q(`select count(*)::int n from shop_purchase where user_id=$1`, [U])).rows[0].n;
eq('1f 첫 선택은 결제 로그를 남기지 않는다', coin1, 0);

// ============================================================
// 2) 두 번째부터는 **소유한 것만** — 첫 선택 무료는 한 번뿐
// ============================================================
const notOwned = await raises(`select hub_choose_character($1,'char_b_f') as r`, [U]);
ok('2a 안 가진 캐릭터로 갈아입기 거절', notOwned != null && /not_owned/.test(notOwned), notOwned);
const stillA = (await q(`select base_key from user_characters where user_id=$1`, [U])).rows[0].base_key;
eq('2b 거절 뒤에도 장착은 그대로', stillA, 'char_a_m');
const grantedN = (await q(`select count(*)::int n from user_cosmetics where user_id=$1`, [U])).rows[0].n;
eq('2c 거절이 소유를 늘리지 않았다', grantedN, 1);

// 사서 가진 뒤에는 갈아입힌다.
await q(`insert into user_cosmetics (user_id, part_key, source) values ($1,'char_b_f','shop')`, [U]);
const second = (await q(`select hub_choose_character($1,'char_b_f') as r`, [U])).rows[0].r;
eqObj('2d 두 번째 선택은 first=false', second, { base_key: 'char_b_f', first: false });

// ⛔ 여기가 이 스위트의 핵심 한 줄 — chosen_at 이 밀리면 첫 선택 무료가 다시 열린다.
const chosenAt1 = (await q(`select chosen_at from user_characters where user_id=$1`, [U])).rows[0].chosen_at;
await q(`select hub_choose_character($1,'char_a_m')`, [U]);
const chosenAt2 = (await q(`select chosen_at from user_characters where user_id=$1`, [U])).rows[0].chosen_at;
ok('2e ⭐ 갈아입어도 chosen_at 은 처음 값 그대로', String(chosenAt1) === String(chosenAt2), { chosenAt1, chosenAt2 });

// ============================================================
// 3) 첫 선택은 **판매 중이면 값과 무관하게** 공짜 — 진열에서 내린 것만 거절
// ============================================================
const paidFirst = (await q(`select hub_choose_character($1,'char_paid_m') as r`, [V])).rows[0].r;
eqObj('3a ⭐ 유료 캐릭터도 첫 선택이면 공짜로 준다', paidFirst, { base_key: 'char_paid_m', first: true });
const vSrc = (await q(`select source from user_cosmetics where user_id=$1 and part_key='char_paid_m'`, [V])).rows[0];
eq('3b 그 지급도 starter 로 남는다', vSrc.source, 'starter');
const vSpent = (await q(`select count(*)::int n from shop_purchase where user_id=$1`, [V])).rows[0].n;
eq('3c 값이 있어도 첫 선택은 코인을 안 쓴다', vSpent, 0);
// 첫 선택을 쓴 뒤에는 500 이 실제로 값으로 작동한다 — 안 산 것은 거절.
const vSecond = await raises(`select hub_choose_character($1,'char_a_m') as r`, [V]);
ok('3d ⭐ 첫 선택을 쓴 뒤에는 안 산 캐릭터 거절', vSecond != null && /not_owned/.test(vSecond), vSecond);

// 진열에서 내린 캐릭터(active=false)는 준다고 말한 적이 없다 — 선택 화면에도 안 뜬다(get-hub 가 active 만 내려준다).
await raw(`
  insert into shop_catalog (part_key, price, kind, sort_order, active) values
    ('char_hidden_m', 500, 'character', 95, false)
  on conflict (part_key) do nothing;
`);
const X = '00000000-0000-0000-0000-0000000000a4';
const hiddenFirst = await raises(`select hub_choose_character($1,'char_hidden_m') as r`, [X]);
ok('3e ⭐ 진열에서 내린 캐릭터는 첫 선택으로도 못 가져간다', hiddenFirst != null && /not_owned/.test(hiddenFirst), hiddenFirst);
const xChosen = (await q(`select chosen_at from user_characters where user_id=$1`, [X])).rows;
ok('3f 거절이 첫 선택을 소진시키지 않았다', xChosen.length === 0 || xChosen[0].chosen_at === null, xChosen);
// 반대로 **이미 가진 사람**은 진열에서 내려가도 계속 입어야 한다(그래서 (2b) 는 active 를 안 본다).
await q(`insert into user_cosmetics (user_id, part_key, source) values ($1,'char_hidden_m','shop')`, [V]);
const hiddenWear = (await q(`select hub_choose_character($1,'char_hidden_m') as r`, [V])).rows[0].r;
eqObj('3g ⭐ 진열에서 내려도 가진 사람은 계속 입는다', hiddenWear, { base_key: 'char_hidden_m', first: false });
// 그리고 판매 중 캐릭터로는 여전히 첫 선택이 된다.
const xFree = (await q(`select hub_choose_character($1,'char_c_f') as r`, [X])).rows[0].r;
eqObj('3h 판매 중 캐릭터로는 첫 선택이 된다', xFree, { base_key: 'char_c_f', first: true });

// 캐릭터가 아닌 키는 애초에 거절
const notChar = await raises(`select hub_choose_character($1,'skin_neon') as r`, [U]);
ok('3i 캐릭터가 아닌 키는 invalid_character', notChar != null && /invalid_character/.test(notChar), notChar);

// ============================================================
// 4) hub_equip — 소유·종류 검사, 한 키만 갱신
// ============================================================
// 기본 스킨은 산 적이 없어도 장착된다(비판매라 소유할 길이 없다 → 안 열면 되돌아갈 수 없다).
await q(`select hub_equip($1,'skin','skin_palace')`, [U]);
const eq1 = (await q(`select equipped from user_characters where user_id=$1`, [U])).rows[0].equipped;
eq('4a 기본 스킨은 안 사도 장착된다', eq1, { skin: 'skin_palace' });

const skinNotOwned = await raises(`select hub_equip($1,'skin','skin_neon')`, [U]);
ok('4b 안 산 유료 스킨은 거절', skinNotOwned != null && /not_owned/.test(skinNotOwned), skinNotOwned);

await q(`insert into user_cosmetics (user_id, part_key, source) values ($1,'skin_neon','shop')`, [U]);
await q(`select hub_equip($1,'skin','skin_neon')`, [U]);
const eq2 = (await q(`select equipped from user_characters where user_id=$1`, [U])).rows[0].equipped;
eq('4c 산 스킨은 장착된다', eq2, { skin: 'skin_neon' });

// ⭐ 한 키만 갱신 — 다른 종류가 딸려 지워지면 안 된다.
await q(`update user_characters set equipped = equipped || '{"frame":"frame_x"}'::jsonb where user_id=$1`, [U]);
await q(`select hub_equip($1,'skin','skin_palace')`, [U]);
const eq3 = (await q(`select equipped from user_characters where user_id=$1`, [U])).rows[0].equipped;
eq('4d ⭐ 스킨을 바꿔도 다른 장착은 남는다', eq3, { skin: 'skin_palace', frame: 'frame_x' });

// 종류 불일치 — 스킨 자리에 가구
const wrongKind = await raises(`select hub_equip($1,'skin','fur_test_01')`, [U]);
ok('4e 스킨 자리에 가구는 invalid_part', wrongKind != null && /invalid_part/.test(wrongKind), wrongKind);
// 캐릭터는 이 경로로 못 바꾼다(첫 선택 무료 규칙이 전용 함수에 있다)
const viaEquip = await raises(`select hub_equip($1,'character','char_a_m')`, [U]);
ok('4f ⭐ 캐릭터는 hub_equip 으로 못 바꾼다', viaEquip != null && /invalid_kind/.test(viaEquip), viaEquip);

// ============================================================
// 5) 튜토리얼 — 멱등
// ============================================================
await q(`select hub_tutorial_done($1)`, [U]);
const t1 = (await q(`select tutorial_done_at from user_characters where user_id=$1`, [U])).rows[0].tutorial_done_at;
ok('5a 완료 시각이 찍힌다', t1 != null, t1);
await q(`select hub_tutorial_done($1)`, [U]);
const t2 = (await q(`select tutorial_done_at from user_characters where user_id=$1`, [U])).rows[0].tutorial_done_at;
ok('5b ⭐ 두 번 불러도 처음 시각 그대로', String(t1) === String(t2), { t1, t2 });
// 행이 없던 사람도 그냥 통과해야 한다(허브에 처음 들어온 순간 부를 수 있다).
const W = '00000000-0000-0000-0000-0000000000a3';
await q(`select hub_tutorial_done($1)`, [W]);
const wRow = (await q(`select tutorial_done_at is not null d from user_characters where user_id=$1`, [W])).rows[0];
ok('5c 장착 행이 없던 사람도 완료 처리된다', wRow?.d === true, wRow);

// ============================================================
// 6) 관리자 초기화 — 캐릭터·튜토리얼은 비우고, **소유는 지키고**
// ============================================================
const ownedBefore = (await q(`select part_key from user_cosmetics where user_id=$1 order by part_key`, [U])).rows.map((r) => r.part_key);
await q(`select admin_reset_onboarding($1)`, [U]);
const after = (await q(`select base_key, chosen_at, tutorial_done_at from user_characters where user_id=$1`, [U])).rows[0];
eq('6a 캐릭터가 미선택으로 돌아간다', after.base_key, 'default');
ok('6b chosen_at 이 비워진다(첫 선택 무료 부활)', after.chosen_at === null, after.chosen_at);
ok('6c tutorial_done_at 이 비워진다', after.tutorial_done_at === null, after.tutorial_done_at);
const ownedAfter = (await q(`select part_key from user_cosmetics where user_id=$1 order by part_key`, [U])).rows.map((r) => r.part_key);
eq('6d ⭐ 산 물건은 그대로 남는다(초기화지 몰수가 아니다)', ownedAfter, ownedBefore);
// 기존 초기화 대상(프로필)도 계속 비워져야 한다 — 갈아끼우면서 흘리지 않았는지.
const p = (await q(`select nickname_set_at, region_locked_at, country_code, region_code, age_band, region_changed_at, display_name
                      from profiles where id=$1`, [U])).rows[0];
ok('6e 프로필 온보딩 값도 그대로 비워진다',
  p.nickname_set_at === null && p.region_locked_at === null && p.country_code === null &&
  p.region_code === null && p.age_band === null && p.region_changed_at === null, p);
eq('6f ⛔ display_name 은 안 건드린다', p.display_name, '홍길동');
// 초기화 뒤 첫 선택이 실제로 다시 열리는가 — 6b 의 결과가 말이 되는지 끝까지 본다.
const again = (await q(`select hub_choose_character($1,'char_a_f') as r`, [U])).rows[0].r;
eqObj('6g ⭐ 초기화 뒤 첫 선택이 다시 열린다', again, { base_key: 'char_a_f', first: true });

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-HUB-CHARACTER: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-hub-character', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
