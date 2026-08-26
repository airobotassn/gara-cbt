// T-season-reset — 랭킹 통합 재설계 STAGE 1e (migrations/20260721050000_reset_season_fn.sql) 를
// pglite(PostgreSQL 18) 로 검증한다. 1a(skill/activity 컬럼)·1c(시즌 아카이브)·1e(reset_season fn) DDL 을 그대로 적용한다.
//  · 스냅샷: ranking_season_result 에 season_total 내림차순 final_rank + final_tier(season_total 백분위 5티어, cume_dist) 기록.
//  · final_tier 밴드: 다이아≤5% · 플래≤20% · 골드≤45% · 실버≤75% · 브론즈. 20 활성유저로 각 밴드 실증.
//  · activity_score 만 0, skill_score 는 불변.
//  · 시즌 롤오버: 현재 시즌 archived, 신규 시즌 active.
//  · 멱등: (season_id,user_id) pk + on conflict do nothing → 같은 시즌에 중복 스냅샷 불가.
//  · 두 번 연속 실행해도(각각 새 시즌 처리) activity 재-0/중복행 없이 안전, 활성 시즌 없으면 no-op.
// auth 스키마가 pglite 에 없으므로 auth.users FK 는 정규식으로 제거하고 plain uuid 컬럼으로 최소 테이블만 만든다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// 활성 유저 20명 u1..u20 (season_total 내림차순) + 탈퇴자 1명(제외 확인용).
const uid = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const N = 20;
const users = Array.from({ length: N }, (_, i) => {
  const k = i + 1;                 // 1..20
  const skill = (N + 1 - k) * 100; // u1=2000 ... u20=100
  const activity = 50;             // 리셋 대상(→0)
  return { id: uid(k), k, skill, activity, total: skill + activity };
});
const uGone = '00000000-0000-0000-0000-0000000000d0'; // 탈퇴자 — 스냅샷에서 제외되어야 함
const u1 = users[0].id;   // 최상위(cume_dist 0.05 → diamond)
const u4 = users[3].id;   // 0.20 → platinum
const u9 = users[8].id;   // 0.45 → gold
const u15 = users[14].id; // 0.75 → silver
const u20 = users[19].id; // 1.00 → bronze

const db = await PGlite.create();

await db.exec(`
  create table profiles (
    id uuid primary key,
    deactivated_at timestamptz
  );
  create table user_progress (
    user_id uuid primary key,
    rank int not null default 1,
    skill_score numeric not null default 0,
    activity_score numeric not null default 0,
    season_total numeric generated always as (skill_score + activity_score) stored,
    season_id int,
    updated_at timestamptz default now()
  );
`);

// 1c(시즌 아카이브 테이블 + 활성 시즌 seed) 적용.
const raw1c = readFileSync('supabase/migrations/20260721030000_ranking_season_archive.sql', 'utf8');
const ddl1c = raw1c.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await db.exec(ddl1c);

// 1e(reset_season fn) 적용 — role 부재라 revoke/grant 라인은 제외.
const raw1e = readFileSync('supabase/migrations/20260721050000_reset_season_fn.sql', 'utf8');
const ddl1e = raw1e.split('\n').filter((l) => !/^revoke|^grant/.test(l.trim())).join('\n');
await db.exec(ddl1e);

// ARENA 레벨업(20260826150000)이 reset_season 을 갈아끼운다(워터마크 재동기화 한 문장이 늘었다).
//   ⚠️ 이걸 안 얹으면 아래 검증이 통째로 **옛 몸통**을 향한다 — 갈아끼우면서 탈퇴자 제외나 티어
//      계산을 흘려도 여기서 안 잡힌다. 그래서 최신판까지 깔고 전부를 그 위에서 돌린다.
//   ⚠️ 그 마이그레이션은 user_characters 를 만지므로 최소 모형이 먼저 필요하다(레벨업 연출 자체의
//      검증은 t-arena-level.mjs 소관이고, 여기서는 시즌 리셋 본래 일이 안 흐트러졌는지만 본다).
await db.exec(`create table user_characters (user_id uuid primary key, updated_at timestamptz default now());`);
const rawLv = readFileSync('supabase/migrations/20260826150000_arena_level_up.sql', 'utf8');
await db.exec(rawLv.split('\n').filter((l) => !/^revoke|^grant/.test(l.trim())).join('\n'));

// 시드: 활성 20명 + 탈퇴자(total 9999, 제외 확인용).
for (const u of users) {
  await db.query(`insert into profiles (id) values ($1)`, [u.id]);
  await db.query(`insert into user_progress (user_id, rank, skill_score, activity_score) values ($1,1,$2,$3)`, [u.id, u.skill, u.activity]);
}
await db.query(`insert into profiles (id, deactivated_at) values ($1, now())`, [uGone]);
await db.query(`insert into user_progress (user_id, rank, skill_score, activity_score) values ($1,7,9999,99)`, [uGone]);

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const qAll = async (sql, p = []) => (await db.query(sql, p)).rows;
const callReset = async () => (await db.query(`select reset_season() as j`)).rows[0].j;
const progress = async (u) => q1(`select skill_score, activity_score, season_total from user_progress where user_id=$1`, [u]);
const resultRows = async (seasonId) => qAll(`select * from ranking_season_result where season_id=$1 order by final_rank asc`, [seasonId]);
const tierOf = (rows, u) => rows.find((r) => r.user_id === u)?.final_tier;
const seasonRow = async (id) => q1(`select id, status, code from ranking_season where id=$1`, [id]);

// --- (1) 활성 시즌 seed(2026Q3) 확인 ---
const activeBefore = await q1(`select id, code, status from ranking_season where status='active'`);
rec('seed: 1 active season (2026Q3)', [activeBefore.code, activeBefore.status], ['2026Q3', 'active']);
const season1Id = activeBefore.id;

// --- (2) 1차 reset_season() ---
const r1 = await callReset();
rec('reset#1: ok=true', r1.ok, true);
rec('reset#1: archived_season_id = season1', r1.archived_season_id, season1Id);

const s1rows = await resultRows(season1Id);
rec('reset#1: season1 result rows = 20 (탈퇴자 제외)', s1rows.length, N);
rec('reset#1: 탈퇴자 uGone 스냅샷 제외', s1rows.some((r) => r.user_id === uGone), false);
rec('reset#1: final_rank 1 = u1(최상위)', s1rows[0].user_id, u1);
rec('reset#1: final_rank 20 = u20(최하위)', s1rows[N - 1].user_id, u20);

// 백분위 5티어 밴드 실증 (cume_dist = k/20)
rec('reset#1: u1 final_tier = diamond (0.05)', tierOf(s1rows, u1), 'diamond');
rec('reset#1: u4 final_tier = platinum (0.20)', tierOf(s1rows, u4), 'platinum');
rec('reset#1: u9 final_tier = gold (0.45)', tierOf(s1rows, u9), 'gold');
rec('reset#1: u15 final_tier = silver (0.75)', tierOf(s1rows, u15), 'silver');
rec('reset#1: u20 final_tier = bronze (1.00)', tierOf(s1rows, u20), 'bronze');

rec('reset#1: u1 season_total snapshot = 2050', Number(s1rows[0].season_total), 2050);

const p1u1 = await progress(u1);
const p1u20 = await progress(u20);
rec('reset#1: u1 activity_score reset to 0', Number(p1u1.activity_score), 0);
rec('reset#1: u1 skill_score UNCHANGED (2000)', Number(p1u1.skill_score), 2000);
rec('reset#1: u20 activity_score reset to 0', Number(p1u20.activity_score), 0);
rec('reset#1: u20 skill_score UNCHANGED (100)', Number(p1u20.skill_score), 100);

const s1meta = await seasonRow(season1Id);
rec('reset#1: season1 status archived', s1meta.status, 'archived');
const activeAfter1 = await q1(`select id, status from ranking_season where status='active'`);
rec('reset#1: new season active, id != season1', activeAfter1.id !== season1Id, true);
const season2Id = activeAfter1.id;

// --- (3) 멱등 가드: 같은 시즌(season1) 스냅샷 직접 재삽입 → on conflict do nothing, 원본 보존 ---
const beforeDupCount = (await resultRows(season1Id)).length;
await db.query(
  `insert into ranking_season_result (season_id, user_id, final_tier, final_rank, skill_score, activity_score, season_total)
   values ($1,$2,'bogus',999,-1,-1,-1) on conflict (season_id,user_id) do nothing`,
  [season1Id, u1],
);
const afterDup = await resultRows(season1Id);
rec('idempotent guard: duplicate (season,user) insert ignored — row count unchanged', afterDup.length, beforeDupCount);
rec('idempotent guard: original snapshot preserved (u1 still diamond, not bogus)', tierOf(afterDup, u1), 'diamond');

// --- (4) 2차 reset_season() — season2 처리(정상 롤오버), 이미 0인 activity 유지 ---
const r2 = await callReset();
rec('reset#2: ok=true', r2.ok, true);
rec('reset#2: archived_season_id = season2 (다른 시즌, season1 재처리 아님)', r2.archived_season_id, season2Id);

const s2rows = await resultRows(season2Id);
rec('reset#2: season2 result rows = 20', s2rows.length, N);
rec('reset#2: season2 u1 season_total = 2000 (activity 이미 0, skill 불변)', Number(s2rows.find((r) => r.user_id === u1).season_total), 2000);
rec('reset#2: season2 u1 still diamond', tierOf(s2rows, u1), 'diamond');

const s1rowsAfter2 = await resultRows(season1Id);
rec('reset#2: season1 rows still 20 (no duplicate growth across resets)', s1rowsAfter2.length, N);

const p2u1 = await progress(u1);
rec('reset#2: u1 activity_score still 0 (idempotent zero, no corruption)', Number(p2u1.activity_score), 0);
rec('reset#2: u1 skill_score UNCHANGED across both resets (2000)', Number(p2u1.skill_score), 2000);

// --- (5) 활성 시즌이 없으면 no-op(가드) ---
const activeNow = await q1(`select id from ranking_season where status='active'`);
await db.query(`update ranking_season set status='archived' where id=$1`, [activeNow.id]);
const rNoActive = await callReset();
rec('no active season: reset_season() no-op (ok=false)', [rNoActive.ok, rNoActive.reason], [false, 'no_active_season']);
const seasonCountAfterNoop = (await qAll(`select id from ranking_season`)).length;
rec('no active season: no new season row created', seasonCountAfterNoop, 3);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter(x => !x.pass).length;
console.log(`\nT-SEASON-RESET: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-season-reset', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
