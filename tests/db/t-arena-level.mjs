// T-Arena-Level — ARENA 레벨 저장 + 레벨업 연출 판정(20260826150000_arena_level_up.sql)을
// pglite(WASM Postgres 18)에서 검증한다.
//
// 이 스위트가 지키는 것 — 전부 "틀렸을 때 조용히 손해가 나는" 자리다:
//   1) 레벨 공식이 scoring.ts 와 같은 답을 낸다(1,000점 균등 밴드 · 1~7 클램프).
//      셋(화면·엣지·SQL) 중 하나만 어긋나면 화면이 말하는 레벨과 DB 가 저장한 레벨이 갈린다.
//   2) 트리거가 **skill_score + activity_score 로** 레벨을 계산한다.
//      ⛔ season_total(generated)을 읽으면 BEFORE 트리거에서 옛 값이 잡힌다 — 이 스위트의 핵심 회귀다.
//   3) 워터마크(arena_level_seen)는 올라가기만 하고 **지금 레벨을 넘지 못한다**.
//      넘으면 아직 오지도 않은 레벨을 '봤다'로 찍어 진짜 레벨업 때 축하가 통째로 사라진다.
//   4) 첫 캐릭터 선택은 워터마크를 **지금 레벨로** 시작한다(가짜 축하 방지).
//   5) 시즌 리셋은 워터마크를 그 시점 레벨로 재동기화한다 —
//      안 하면 활동으로 오르던 사람은 축하가 영영 안 뜨고, 일괄 1로 밀면 Lv.7 이 가짜 6단계 축하를 받는다.
//   6) 실행권한: service_role 만.
//
// ⚠️ auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거(하네스 strip).
// ⚠️ **bun 으로 돌린다**(`bun tests/db/t-arena-level.mjs`). scoring.ts 를 그대로 import 해서 SQL 과
//    맞대보기 때문이다 — node 로는 .ts 확장자 해석이 안 된다(t-scoring-parity.mjs 와 같은 조건).
//    소스를 정규식으로 훑는 대신 **진짜 함수를 실행해 비교**해야 포맷만 다르게 베낀 실수까지 잡힌다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { arenaLevelForScore, ARENA_BAND_STEP } from '../../src/lib/scoring.ts';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);
async function raises(sql, params) {
  try { await q(sql, params); return null; } catch (e) { return e.message || String(e); }
}
// ⚠️ 여러 문장짜리(마이그레이션 전체)는 exec 로 돌려야 한다 — query 는 prepared statement 라
//    "cannot insert multiple commands into a prepared statement" 로 죽는다(제품이 아니라 하네스 문제다).
async function rawRaises(sql) {
  try { await raw(sql); return null; } catch (e) { return e.message || String(e); }
}

// ---- Supabase 롤(revoke 대상) ----
await raw(`create role anon; create role authenticated; create role service_role;`);

// ---- 최소 스키마 ----
const strip = (s) => s.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(`
  create table user_progress (
    user_id uuid primary key,
    rank int not null default 1,
    demotion_strikes int not null default 0,
    points int not null default 0,
    updated_at timestamptz default now()
  );
  create table profiles (
    id uuid primary key,
    display_name text,
    deactivated_at timestamptz
  );
`);
await raw(readFileSync('supabase/migrations/20260721010000_ranking_progress_columns.sql', 'utf8'));
await raw(strip(readFileSync('supabase/migrations/20260714000400_phase2_character.sql', 'utf8')));
await raw(readFileSync('supabase/migrations/20260714000500_gacha_shop.sql', 'utf8'));
await raw(strip(readFileSync('supabase/migrations/20260721030000_ranking_season_archive.sql', 'utf8')));
await raw(readFileSync('supabase/migrations/20260721050000_reset_season_fn.sql', 'utf8'));
// hub_choose_character 원본 → 값 매기기 판 → 이번 판. 순서대로 깔아야 `create or replace` 가
// 실제로 갈아끼우는지까지 같이 검증된다.
await raw(strip(readFileSync('supabase/migrations/20260819170000_admin_reset_onboarding.sql', 'utf8')));
await raw(readFileSync('supabase/migrations/20260820120000_hub_character_skin.sql', 'utf8'));
await raw(readFileSync('supabase/migrations/20260824120000_hub_character_price.sql', 'utf8'));

// ---- 검증 대상 ----
await raw(readFileSync('supabase/migrations/20260826150000_arena_level_up.sql', 'utf8'));

const U = '00000000-0000-0000-0000-0000000000b1'; // 활동으로 오르는 사람
const V = '00000000-0000-0000-0000-0000000000b2'; // 레벨테스트로 오르는 사람(skill 고정)
const W = '00000000-0000-0000-0000-0000000000b3'; // 캐릭터를 아직 안 고른 사람
for (const id of [U, V, W]) {
  await q(`insert into profiles (id, display_name) values ($1,'t')`, [id]);
  await q(`insert into user_progress (user_id) values ($1)`, [id]);
}

// ============================================================
// 1) 레벨 공식 — scoring.ts 동기화 페어
// ============================================================
// 밴드 경계와 그 양옆을 전부 훑어 **실제 TS 함수**와 대조한다.
//   ⚠️ 기대값을 테스트 안에 다시 적으면 안 된다 — 그건 공식의 네 번째 사본이 되고, TS 를 고쳤을 때
//      테스트가 조용히 통과한다. 반드시 scoring.ts 가 내놓는 값과 맞댄다.
const probes = [];
for (let b = 0; b <= 12; b++) probes.push(b * ARENA_BAND_STEP - 1, b * ARENA_BAND_STEP, b * ARENA_BAND_STEP + 1);
probes.push(-5, 0, 999.9, 1000.5, 6999, 11745, 99999);
let sweepBad = null;
for (const t of probes) {
  const got = (await q(`select arena_level_of($1::numeric) as l`, [t])).rows[0].l;
  const want = arenaLevelForScore(t);
  if (got !== want) { sweepBad = { t, sql: got, ts: want }; break; }
}
eq(`1a ⭐ SQL 공식이 ${probes.length}개 지점에서 scoring.ts 와 같은 답`, sweepBad, null);

// 경계값을 한 번 더 못박는다 — 위 대조는 "둘이 같다"만 보므로, 둘이 **같이** 틀리면 못 잡는다.
eq('1b 밴드 경계가 원안 그대로(0·999·1000 → 1·1·2)',
  [arenaLevelForScore(0), arenaLevelForScore(999), arenaLevelForScore(1000)], [1, 1, 2]);
eq('1c 천장이 Lv.7 이다(5999·6000·11745 → 6·7·7)',
  [arenaLevelForScore(5999), arenaLevelForScore(6000), arenaLevelForScore(11745)], [6, 7, 7]);
eq('1d 음수·null 은 Lv.1 로 접힌다',
  (await q(`select arena_level_of(null) a, arena_level_of(-999) b`)).rows[0], { a: 1, b: 1 });
eq('1e 상한을 넘겨도 Lv.7 을 안 넘는다', (await q(`select arena_level_of(999999) l`)).rows[0].l, 7);

// ============================================================
// 2) 트리거 — 저장된 레벨이 점수를 따라간다
// ============================================================
// ⛔ **이 스위트의 핵심 회귀.** BEFORE 트리거는 generated 컬럼(season_total)을 못 본다
//    (Postgres 가 BEFORE 트리거가 끝난 뒤에 계산한다). 원천 두 컬럼을 더하지 않으면 여기서 옛 값이 잡힌다.
await q(`update user_progress set activity_score = 2500 where user_id=$1`, [U]);
const t2 = (await q(`select arena_level, season_total from user_progress where user_id=$1`, [U])).rows[0];
eq('2a ⭐ UPDATE 즉시 레벨이 따라온다(generated 를 안 읽는 증거)', t2.arena_level, 3);
eq('2b season_total 자체는 그대로 맞다', Number(t2.season_total), 2500);

// 두 트랙이 **합쳐져야** 한다 — 한쪽만 보면 여기서 갈린다.
await q(`update user_progress set skill_score = 3000 where user_id=$1`, [U]);
eq('2c ⭐ 두 트랙의 합으로 계산한다(3000+2500=5500 → Lv.6)',
  (await q(`select arena_level from user_progress where user_id=$1`, [U])).rows[0].arena_level, 6);

// INSERT 경로도 같이 본다(트리거가 insert or update 양쪽에 걸려 있어야 한다).
const X = '00000000-0000-0000-0000-0000000000b9';
await q(`insert into user_progress (user_id, skill_score) values ($1, 4000)`, [X]);
eq('2d INSERT 로 만든 행도 레벨이 맞다',
  (await q(`select arena_level from user_progress where user_id=$1`, [X])).rows[0].arena_level, 5);

// ============================================================
// 3) 첫 캐릭터 선택 — 워터마크를 지금 레벨로 심는다
// ============================================================
// ⚠️ 안 심으면 이렇다: 레벨테스트만 보고 허브엔 한 번도 안 온 사람(이미 Lv.4)이 캐릭터를 고르는
//    순간 워터마크가 1로 시작해 "1 → 4" 가짜 축하가 뜬다.
await q(`update user_progress set skill_score = 3000 where user_id=$1`, [V]); // Lv.4
await q(`select hub_choose_character($1,'char_a_m')`, [V]);
eq('3a ⭐ 첫 선택이 워터마크를 지금 레벨로 시작한다',
  (await q(`select arena_level_seen from user_characters where user_id=$1`, [V])).rows[0].arena_level_seen, 4);
// 그래서 그 순간 축하할 게 없다(level == seen).
const noCelebrate = (await q(
  `select up.arena_level > uc.arena_level_seen as pending
     from user_progress up join user_characters uc on uc.user_id = up.user_id
    where up.user_id=$1`, [V])).rows[0].pending;
eq('3b 첫 선택 직후에는 축하할 게 없다', noCelebrate, false);

// 점수가 없는 사람은 Lv.1 로 시작한다.
await q(`select hub_choose_character($1,'char_a_m')`, [W]);
eq('3c 점수 없는 신규는 워터마크가 1',
  (await q(`select arena_level_seen from user_characters where user_id=$1`, [W])).rows[0].arena_level_seen, 1);

// ============================================================
// 4) hub_level_seen — 워터마크는 올라가기만, 지금 레벨까지만
// ============================================================
await q(`update user_progress set skill_score = 5000 where user_id=$1`, [V]); // Lv.6
eq('4a 레벨이 올랐는데 워터마크는 아직 옛 값',
  (await q(`select up.arena_level l, uc.arena_level_seen s
              from user_progress up join user_characters uc on uc.user_id=up.user_id
             where up.user_id=$1`, [V])).rows[0], { l: 6, s: 4 });

eq('4b 연출을 본 뒤 워터마크가 올라간다',
  (await q(`select hub_level_seen($1, 6) r`, [V])).rows[0].r, { seen: 6, level: 6 });

// ⛔ 지금 레벨을 넘겨서 찍을 수 없다 — 넘으면 진짜 레벨업 때 축하가 통째로 사라진다.
await q(`select hub_level_seen($1, 7)`, [V]);
eq('4c ⭐ 지금 레벨을 넘겨 찍을 수 없다(least)',
  (await q(`select arena_level_seen from user_characters where user_id=$1`, [V])).rows[0].arena_level_seen, 6);
// 실제로 Lv.7 이 되면 축하가 뜨는지 — 4c 가 말이 되는지 끝까지 본다.
await q(`update user_progress set skill_score = 6000 where user_id=$1`, [V]); // Lv.7
const pending7 = (await q(
  `select up.arena_level > uc.arena_level_seen as pending
     from user_progress up join user_characters uc on uc.user_id=up.user_id where up.user_id=$1`, [V])).rows[0].pending;
ok('4d ⭐ 그 뒤 진짜 Lv.7 이 되면 축하가 살아 있다', pending7 === true, pending7);

// ⚠️ 늦게 도착한 옛 요청이 워터마크를 되돌리면 같은 축하가 두 번 뜬다.
await q(`select hub_level_seen($1, 7)`, [V]);
await q(`select hub_level_seen($1, 2)`, [V]);
eq('4e ⭐ 워터마크는 내려가지 않는다(greatest)',
  (await q(`select arena_level_seen from user_characters where user_id=$1`, [V])).rows[0].arena_level_seen, 7);

// 행이 없는 사람도 견딘다(캐릭터 선택 전에 불려도 터지지 않는다).
const Y = '00000000-0000-0000-0000-0000000000c1';
await q(`insert into profiles (id, display_name) values ($1,'t')`, [Y]);
await q(`insert into user_progress (user_id, skill_score) values ($1, 2000)`, [Y]);
eq('4f user_characters 행이 없어도 견딘다',
  (await q(`select hub_level_seen($1, 3) r`, [Y])).rows[0].r, { seen: 3, level: 3 });
// ⛔ 그때 만든 행은 **1이 아니라 지금 레벨**로 시작해야 한다. 1로 두면 나중에 캐릭터를 고를 때
//    hub_choose_character 의 insert 가 on conflict do nothing 이라 그 1이 남아 가짜 축하가 뜬다.
const Z = '00000000-0000-0000-0000-0000000000c2';
await q(`insert into profiles (id, display_name) values ($1,'t')`, [Z]);
await q(`insert into user_progress (user_id, skill_score) values ($1, 4000)`, [Z]); // Lv.5
await q(`select hub_level_seen($1, 1)`, [Z]);                                      // 낮은 값으로 불려도
await q(`select hub_choose_character($1,'char_a_m')`, [Z]);
eq('4g ⭐ 캐릭터 선택 전에 불려도 워터마크가 1에 눌러앉지 않는다',
  (await q(`select arena_level_seen from user_characters where user_id=$1`, [Z])).rows[0].arena_level_seen, 5);
eq('4h 인자가 없으면 unauthorized', (await raises(`select hub_level_seen(null, 3)`)) != null, true);

// ============================================================
// 5) 시즌 리셋 — 워터마크를 그 시점 레벨로 재동기화
// ============================================================
// ⛔ 이 한 문장이 없으면 둘 중 하나로 터진다(migration (6) 주석 참고).
//    U = 활동으로 Lv.6 → 리셋으로 떨어진다.  V = skill 로 Lv.7 → 리셋에도 그대로다.
await q(`select hub_level_seen($1, 6)`, [U]);           // U 도 축하를 다 봤다고 가정
await q(`select hub_choose_character($1,'char_a_m')`, [U]);
await q(`update user_characters set arena_level_seen = 6 where user_id=$1`, [U]);
const beforeReset = (await q(
  `select user_id, arena_level from user_progress where user_id in ($1,$2) order by user_id`, [U, V])).rows;
eq('5a 리셋 전 레벨', beforeReset.map((r) => r.arena_level), [6, 7]);

await q(`select reset_season()`);

const afterU = (await q(`select up.arena_level l, uc.arena_level_seen s
                           from user_progress up join user_characters uc on uc.user_id=up.user_id
                          where up.user_id=$1`, [U])).rows[0];
eq('5b ⭐ 활동으로 오르던 사람은 레벨이 떨어지고 워터마크도 같이 내려간다(Lv.4=skill 3000)', afterU, { l: 4, s: 4 });
const afterV = (await q(`select up.arena_level l, uc.arena_level_seen s
                           from user_progress up join user_characters uc on uc.user_id=up.user_id
                          where up.user_id=$1`, [V])).rows[0];
eq('5c ⭐ skill 로 Lv.7 인 사람은 아무 일도 안 일어난다(가짜 6단계 축하 없음)', afterV, { l: 7, s: 7 });

// 리셋 직후에는 아무도 축하 대기가 아니다.
const pendingAny = (await q(
  `select count(*)::int n from user_progress up join user_characters uc on uc.user_id=up.user_id
    where up.arena_level > uc.arena_level_seen`)).rows[0].n;
eq('5d ⭐ 리셋 직후 축하 대기가 0명', pendingAny, 0);

// 떨어진 사람이 다시 오르면 축하가 정상적으로 살아난다 — 5b 가 말이 되는지 끝까지 본다.
await q(`update user_progress set activity_score = 1200 where user_id=$1`, [U]); // 3000+1200 → Lv.5
const revived = (await q(`select up.arena_level > uc.arena_level_seen as pending
                            from user_progress up join user_characters uc on uc.user_id=up.user_id
                           where up.user_id=$1`, [U])).rows[0].pending;
ok('5e ⭐ 다시 오르면 축하가 살아난다', revived === true, revived);

// 아카이브 스냅샷은 여전히 남는다(리셋 본래 일을 흘리지 않았는지).
const archived = (await q(`select count(*)::int n from ranking_season_result`)).rows[0].n;
ok('5f 시즌 스냅샷은 그대로 쌓인다', archived > 0, archived);

// ============================================================
// 6) 실행권한 · 되풀이 안전
// ============================================================
const grants = (await q(
  `select grantee from information_schema.routine_privileges
    where routine_name='hub_level_seen' and privilege_type='EXECUTE' order by grantee`)).rows.map((r) => r.grantee);
ok('6a hub_level_seen 은 service_role 만 실행한다',
  grants.includes('service_role') && !grants.includes('anon') && !grants.includes('authenticated'), grants);

// 같은 마이그레이션을 다시 얹어도 죽지 않는다(멱등).
const again = await rawRaises(readFileSync('supabase/migrations/20260826150000_arena_level_up.sql', 'utf8'));
ok('6b 마이그레이션 재실행이 안전하다', again === null, again);
// 재실행이 값을 흔들지 않았는지 — 멱등의 진짜 의미는 "다시 돌려도 같은 상태"다.
eq('6c 재실행 뒤에도 워터마크 그대로',
  (await q(`select arena_level_seen from user_characters where user_id=$1`, [V])).rows[0].arena_level_seen, 7);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-ARENA-LEVEL: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-arena-level', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
