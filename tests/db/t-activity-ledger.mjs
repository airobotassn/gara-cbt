// T-activity-ledger — 랭킹 통합 재설계 STAGE 1b (migrations/20260721020000_activity_ledger.sql) 를
// pglite(PostgreSQL 18) 로 검증한다. 실제 마이그레이션 DDL 을 그대로 적용한다.
//  · AFTER INSERT 트리거가 user_progress.activity_score 를 원자 증분(complete_daily 패턴)하는지.
//  · 하루-cap 소스(attendance/daily_learn) 부분 unique(user_id,kind,day) 가 같은 날 중복을 거부하는지.
//  · minigame 부분 unique(user_id,day,source_ref) 가 같은 게임·같은 날 중복 삽입을 거부하는지(게임별 1행/일).
//  · delta>=0 CHECK, minigame source_ref NOT NULL CHECK 가 오염 데이터를 거부하는지(23514).
//  · user_progress 행이 아직 없는 유저에게도 트리거가 upsert 로 행을 생성 + activity_score=delta 로 초기화하는지.
//  · user_currency(cosmetic 재화)와 무조인 — 원장 삽입 전후 user_currency 는 전혀 건드리지 않는다.
// auth 스키마가 pglite 에 없으므로 auth.users FK 는 정규식으로 제거하고 plain uuid 컬럼으로 최소 테이블만 만든다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const uid = '00000000-0000-0000-0000-000000000001';
const uid2 = '00000000-0000-0000-0000-000000000002';
const uid3 = '00000000-0000-0000-0000-000000000003'; // user_progress 행 없음 — upsert 검증용

const db = await PGlite.create();

// 최소 user_progress(1a 결과물 형태) + user_currency(무관성 검증용) 스텁.
await db.exec(`
  create table user_progress (
    user_id uuid primary key,
    rank int not null default 1,
    demotion_strikes int not null default 0,
    points int not null default 0,
    skill_score numeric not null default 0,
    activity_score numeric not null default 0,
    season_total numeric generated always as (skill_score + activity_score) stored,
    season_id int,
    updated_at timestamptz default now()
  );
  create table user_currency (
    user_id uuid primary key,
    points bigint not null default 0,
    updated_at timestamptz default now()
  );
  insert into user_progress (user_id) values ('${uid}'), ('${uid2}');
  insert into user_currency (user_id, points) values ('${uid}', 500);
`);

// 실제 마이그레이션 DDL 적용(auth.users FK 만 제거).
const raw = readFileSync('supabase/migrations/20260721020000_activity_ledger.sql', 'utf8');
const ddl = raw
  .replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '')
  .split('\n').filter((l) => !/^revoke|^grant/.test(l.trim())).join('\n');
await db.exec(ddl);

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const activityScore = async (u) => Number((await q1(`select activity_score from user_progress where user_id=$1`, [u])).activity_score);
const currencyPoints = async (u) => Number((await q1(`select points from user_currency where user_id=$1`, [u]))?.points ?? 0);

async function insertLedger(user, kind, delta, day, sourceRef = null) {
  return db.query(
    `insert into activity_ledger (user_id, season_id, kind, delta, day, source_ref) values ($1,1,$2,$3,$4,$5)`,
    [user, kind, delta, day, sourceRef],
  );
}

// --- (1) attendance 첫 삽입 → activity_score 원자 증분 ---
await insertLedger(uid, 'attendance', 5, '2026-07-21');
rec('attendance 1st insert: activity_score += 5', await activityScore(uid), 5);

// --- (2) daily_learn 같은 날 추가 삽입 → 누적 증분(원자, 서로 다른 kind 는 합산) ---
await insertLedger(uid, 'daily_learn', 3, '2026-07-21');
rec('daily_learn same-day insert: activity_score cumulates to 8', await activityScore(uid), 8);

// --- (3) attendance 같은 (user,kind,day) 재삽입 → 부분 unique 위반(23505), 재적립 없음 ---
let dupErr = null;
try {
  await insertLedger(uid, 'attendance', 5, '2026-07-21');
} catch (e) { dupErr = e.code || 'error'; }
rec('attendance dup (user,kind,day) rejected (23505)', dupErr, '23505');
rec('attendance dup rejected: activity_score unchanged (still 8)', await activityScore(uid), 8);

// --- (4) 다른 날짜 attendance 는 허용 + 증분 ---
await insertLedger(uid, 'attendance', 5, '2026-07-22');
rec('attendance next-day insert allowed: activity_score = 13', await activityScore(uid), 13);

// --- (5) minigame 부분 unique(user_id, day, source_ref) — 같은 게임 같은 날 중복 삽입 거부(1행/일/게임) ---
await insertLedger(uid, 'minigame', 10, '2026-07-21', 'shoot-cari');
rec('minigame 1st insert (shoot-cari): activity_score = 23', await activityScore(uid), 23);

let mgDupErr = null;
try {
  await insertLedger(uid, 'minigame', 20, '2026-07-21', 'shoot-cari');
} catch (e) { mgDupErr = e.code || 'error'; }
rec('minigame dup (user,day,source_ref) rejected (23505)', mgDupErr, '23505');
rec('minigame dup rejected: activity_score unchanged (still 23)', await activityScore(uid), 23);

// 다른 게임(source_ref) 같은 날은 허용 — 게임별 독립 슬롯.
await insertLedger(uid, 'minigame', 7, '2026-07-21', 'beat-cari');
rec('minigame different source_ref same day allowed: activity_score = 30', await activityScore(uid), 30);

// --- (6) kind check 제약 — 허용되지 않은 kind 는 거부(23514) ---
let kindErr = null;
try {
  await insertLedger(uid, 'bogus', 1, '2026-07-23');
} catch (e) { kindErr = e.code || 'error'; }
rec('unknown kind rejected by check constraint (23514)', kindErr, '23514');

// --- (7) 다른 유저는 서로 격리 ---
await insertLedger(uid2, 'attendance', 9, '2026-07-21');
rec('other user isolated: uid2 activity_score = 9', await activityScore(uid2), 9);
rec('other user isolated: uid activity_score untouched (still 30)', await activityScore(uid), 30);

// --- (8) user_currency 무조인 불변식: 원장 삽입 전후 완전히 불변 ---
rec('user_currency UNCHANGED across all ledger inserts (no join)', await currencyPoints(uid), 500);

// --- (9) 음수 delta 는 CHECK 로 거부(23514) — activity_score 오염 차단 ---
let negErr = null;
try {
  await insertLedger(uid, 'attendance', -5, '2026-07-24');
} catch (e) { negErr = e.code || 'error'; }
rec('negative delta rejected by check constraint (23514)', negErr, '23514');
rec('negative delta rejected: activity_score unchanged (still 30)', await activityScore(uid), 30);

// --- (10) minigame source_ref NULL 은 CHECK 로 거부(23514) ---
let noRefErr = null;
try {
  await insertLedger(uid, 'minigame', 10, '2026-07-25', null);
} catch (e) { noRefErr = e.code || 'error'; }
rec('minigame with NULL source_ref rejected by check constraint (23514)', noRefErr, '23514');

// --- (11) user_progress 행이 없는 유저 — 트리거가 upsert 로 신규 행 생성 + activity_score=delta ---
const preExisting = await q1(`select 1 as x from user_progress where user_id=$1`, [uid3]);
rec('uid3 has no user_progress row before ledger insert', preExisting ?? null, null);
await insertLedger(uid3, 'attendance', 12, '2026-07-21');
rec('uid3 ledger insert upserts new user_progress row: activity_score = 12', await activityScore(uid3), 12);

// --- (12) minigame 하루-최고 개선: 같은 게임/날 upsert(greatest) UPDATE 경로 → 트리거가 차분(new-old)만큼 증분 ---
//   submit-minigame 이 쓰는 on conflict(user_id,day,source_ref) 가 인덱스와 호환되는지도 실증(부분 인덱스면 predicate 필요).
const mgUpsert = async (u, delta, day, ref) => db.query(
  `insert into activity_ledger (user_id, season_id, kind, delta, day, source_ref)
   values ($1, 1, 'minigame', $2, $3, $4)
   on conflict (user_id, day, source_ref) do update set delta = greatest(activity_ledger.delta, excluded.delta)`,
  [u, delta, day, ref],
);
const beforeImprove = await activityScore(uid); // 30
await mgUpsert(uid, 25, '2026-07-21', 'shoot-cari'); // 기존 delta 10 → 25, 차분 +15
rec('minigame improved daily-best (10→25) via upsert: activity_score += 15', await activityScore(uid), beforeImprove + 15);
await mgUpsert(uid, 5, '2026-07-21', 'shoot-cari'); // greatest 로 25 유지, 차분 0
rec('minigame lower re-submit ignored (greatest): activity_score unchanged', await activityScore(uid), beforeImprove + 15);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter(x => !x.pass).length;
console.log(`\nT-ACTIVITY-LEDGER: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-activity-ledger', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
