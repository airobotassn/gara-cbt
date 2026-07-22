// T-stage1-redteam — 랭킹 통합 재설계 STAGE 1 (DB) 적대적(red-team) 검증.
// migrations/20260721010000..050000 을 pglite(PostgreSQL 18) 로 그대로 적용하고, 깨뜨리기를 시도한다.
//  (1) 연속 다건 insert 시 activity_score 합산 손실 없음(트리거 원자성).
//  (2) 멱등 우회 시도 — (user,kind,day) / (user,day,source_ref) 재삽입 거부, kind 만 다르면 허용되는 경계.
//  (3) 음수 delta — CHECK(delta >= 0) 로 DB 레벨 거부 확인(STAGE1 하드닝 이후 finding→pass 전환).
//  (4) generated column(season_total) 직접 insert/update 시도 거부.
//  (5) reset_season() 이중/연속 호출 — 이미 archived 시즌 재처리 없음, activity 재-0/음수 없음.
//  (6) 1a 백필 UPDATE 두 번 적용해도 이미 >0 인 skill_score 불변.
// auth 스키마가 pglite 에 없으므로 auth.users FK 는 정규식으로 제거하고 plain uuid 컬럼으로 최소 테이블만 만든다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const uid = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const u1 = uid(1);
const u2 = uid(2);

const db = await PGlite.create();

await db.exec(`
  create table profiles (
    id uuid primary key,
    deactivated_at timestamptz
  );
  create table user_progress (
    user_id uuid primary key,
    rank int not null default 1,
    points int not null default 0,
    skill_score numeric not null default 0,
    activity_score numeric not null default 0,
    season_total numeric generated always as (skill_score + activity_score) stored,
    season_id int,
    updated_at timestamptz default now()
  );
  insert into profiles (id) values ('${u1}'), ('${u2}');
  insert into user_progress (user_id) values ('${u1}'), ('${u2}');
`);

const stripFk = (raw) => raw.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
const stripPriv = (raw) => raw.split('\n').filter((l) => !/^revoke|^grant/.test(l.trim())).join('\n');

// 1b(activity_ledger) + 1c(시즌 아카이브) + 1e(reset_season fn) 적용. (1a 는 위 스텁 테이블에 이미 반영된 형태로 대신함.)
const raw1b = readFileSync('supabase/migrations/20260721020000_activity_ledger.sql', 'utf8');
await db.exec(stripPriv(stripFk(raw1b)));

const raw1c = readFileSync('supabase/migrations/20260721030000_ranking_season_archive.sql', 'utf8');
await db.exec(stripFk(raw1c));

const raw1e = readFileSync('supabase/migrations/20260721050000_reset_season_fn.sql', 'utf8');
await db.exec(stripPriv(raw1e));

const results = [];
const rec = (name, verdict, detail) => results.push({ name, verdict, detail });

const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const qAll = async (sql, p = []) => (await db.query(sql, p)).rows;
const activityScore = async (u) => Number((await q1(`select activity_score from user_progress where user_id=$1`, [u])).activity_score);
const skillScore = async (u) => Number((await q1(`select skill_score from user_progress where user_id=$1`, [u])).skill_score);

async function insertLedger(user, kind, delta, day, sourceRef = null) {
  return db.query(
    `insert into activity_ledger (user_id, season_id, kind, delta, day, source_ref) values ($1,1,$2,$3,$4,$5)`,
    [user, kind, delta, day, sourceRef],
  );
}

// ============================================================
// (1) 연속 다건 insert — activity_score 합산 손실 없음 (트리거 원자성)
// ============================================================
{
  const before = await activityScore(u1);
  const N = 50;
  const deltas = Array.from({ length: N }, (_, i) => i + 1); // 1..50
  // 서로 다른 source_ref(부분 unique 충돌 회피)로 같은 날 N 건을 "동시에" 발사한다.
  // pglite 는 단일 커넥션이라 실제 병렬 트랜잭션은 아니지만, 트리거의 원자 증분(단일 UPDATE 문)이
  // read-modify-write 경합 없이 정확히 합산되는지는 이 방식으로도 검증 가능하다(N건 순차/큐잉 실행 후 합 검사).
  await Promise.all(deltas.map((d, i) => insertLedger(u1, 'minigame', d, '2026-08-01', `game-${i}`)));
  const after = await activityScore(u1);
  const expectedSum = deltas.reduce((a, b) => a + b, 0);
  const got = after - before;
  rec(
    '(1) concurrent-ish N=50 inserts: activity_score sum has zero loss',
    got === expectedSum ? 'pass' : 'FAIL',
    `before=${before} after=${after} delta_sum_expected=${expectedSum} delta_sum_got=${got}`,
  );
  const rowCount = Number((await q1(`select count(*)::int as c from activity_ledger where user_id=$1 and day='2026-08-01'`, [u1])).c);
  rec(
    '(1) all 50 ledger rows persisted (no silent drop under rapid insert)',
    rowCount === N ? 'pass' : 'FAIL',
    `expected=${N} got=${rowCount}`,
  );
}

// ============================================================
// (2) 멱등 우회 시도
// ============================================================
{
  await insertLedger(u2, 'attendance', 5, '2026-08-02');
  let dupErr = null;
  try {
    await insertLedger(u2, 'attendance', 5, '2026-08-02');
  } catch (e) { dupErr = e.code || String(e); }
  rec(
    '(2) attendance dup (user,kind,day) rejected 23505',
    dupErr === '23505' ? 'pass' : 'FAIL',
    `err=${dupErr}`,
  );

  await insertLedger(u2, 'minigame', 5, '2026-08-02', 'shoot-cari');
  let mgDupErr = null;
  try {
    await insertLedger(u2, 'minigame', 999, '2026-08-02', 'shoot-cari');
  } catch (e) { mgDupErr = e.code || String(e); }
  rec(
    '(2) minigame dup (user,day,source_ref) rejected 23505',
    mgDupErr === '23505' ? 'pass' : 'FAIL',
    `err=${mgDupErr}`,
  );

  // 경계: kind 만 다르면(같은 user, 같은 day) 허용되어야 한다 — daily_learn 은 attendance 와 별개 키.
  let sameDayDiffKindErr = null;
  let scoreAfterDiffKind = null;
  try {
    await insertLedger(u2, 'daily_learn', 3, '2026-08-02');
    scoreAfterDiffKind = await activityScore(u2);
  } catch (e) { sameDayDiffKindErr = e.code || String(e); }
  rec(
    '(2) same user+day, DIFFERENT kind (daily_learn vs attendance) allowed, not blocked by unique idx',
    sameDayDiffKindErr === null ? 'pass' : 'FAIL',
    `err=${sameDayDiffKindErr} score_after=${scoreAfterDiffKind}`,
  );

  // 재확인: 위 두 dup 거부 시도가 실제로 activity_score 를 오염시키지 않았는지.
  const finalScore = await activityScore(u2); // 5(attendance) + 5(minigame) + 3(daily_learn) = 13
  rec(
    '(2) rejected duplicates left NO side-effect on activity_score (still 13)',
    finalScore === 13 ? 'pass' : 'FAIL',
    `got=${finalScore} want=13`,
  );
}

// ============================================================
// (3) 음수 delta — STAGE1 하드닝 이후: CHECK(delta >= 0) 로 DB 레벨 거부됨 (finding → pass 전환)
// ============================================================
{
  const before = await activityScore(u1);
  let negErr = null;
  try {
    await insertLedger(u1, 'attendance', -500, '2026-08-03');
  } catch (e) { negErr = e.code || String(e); }
  const after = await activityScore(u1);
  rec(
    '(3) negative delta rejected by CHECK(delta >= 0) at DB level (23514) — no decrement, no residue',
    negErr === '23514' && after === before ? 'pass(rejected)' : `FAIL(err=${negErr} before=${before} after=${after})`,
    `before=${before} after=${after} err=${negErr}. delta>=0 CHECK 제약이 activity_ledger 테이블 레벨에 추가되어 ` +
      `service_role/서버 경로로도 음수 delta 삽입이 원천 차단된다(애플리케이션 레이어에만 의존하지 않는 DB 레이어 방어선 확보).`,
  );
  // 큰 음수도 동일하게 삽입 자체가 거부되어 activity_score 하한(0) 붕괴가 원천적으로 불가능함을 확인.
  let bigNegErr = null;
  try {
    await insertLedger(u1, 'daily_learn', -100000, '2026-08-04');
  } catch (e) { bigNegErr = e.code || String(e); }
  const afterBigNeg = await activityScore(u1);
  rec(
    '(3) large negative delta also rejected by CHECK (no floor-at-0 bypass possible — insert never reaches trigger)',
    bigNegErr === '23514' && afterBigNeg === before ? 'pass(rejected)' : `FAIL(err=${bigNegErr} after=${afterBigNeg})`,
    `activity_score_after=${afterBigNeg} err=${bigNegErr}`,
  );
}

// ============================================================
// (4) generated column(season_total) 불변성 — 직접 insert/update 시도 거부
// ============================================================
{
  const u3 = uid(3);
  let insertErr = null;
  try {
    await db.query(
      `insert into user_progress (user_id, skill_score, activity_score, season_total) values ($1,10,10,999)`,
      [u3],
    );
  } catch (e) { insertErr = e.code || String(e); }
  rec(
    '(4) direct INSERT into generated column season_total rejected',
    insertErr ? 'pass' : 'FAIL',
    `err=${insertErr}`,
  );

  let updateErr = null;
  try {
    await db.query(`update user_progress set season_total = 999 where user_id=$1`, [u1]);
  } catch (e) { updateErr = e.code || String(e); }
  rec(
    '(4) direct UPDATE of generated column season_total rejected',
    updateErr ? 'pass' : 'FAIL',
    `err=${updateErr}`,
  );

  // 정상 경로(skill/activity 갱신)로는 season_total 이 자동 파생되는지 재확인.
  const skill = await skillScore(u1);
  const activity = await activityScore(u1);
  const row = await q1(`select season_total from user_progress where user_id=$1`, [u1]);
  rec(
    '(4) season_total still correctly derives from skill+activity after failed direct-write attempts',
    Number(row.season_total) === skill + activity ? 'pass' : 'FAIL',
    `season_total=${row.season_total} skill=${skill} activity=${activity}`,
  );
}

// ============================================================
// (5) reset_season() 이중/연속 호출 — 재처리·재-0·음수 없음
// ============================================================
{
  const callReset = async () => (await db.query(`select reset_season() as j`)).rows[0].j;
  const before1 = await activityScore(u1);
  const r1 = await callReset();
  const afterFirst = await activityScore(u1);
  rec('(5) reset#1 ok=true', r1.ok === true ? 'pass' : 'FAIL', JSON.stringify(r1));
  rec(
    '(5) reset#1 zeroed activity_score (no negative, no residue)',
    afterFirst === 0 ? 'pass' : 'FAIL',
    `before=${before1} after=${afterFirst}`,
  );

  const archivedSeasonId = r1.archived_season_id;
  const rowsAfterFirst = await qAll(
    `select * from ranking_season_result where season_id=$1`,
    [archivedSeasonId],
  );
  const countAfterFirst = rowsAfterFirst.length;

  // 연속(back-to-back) 재호출 — 두 번째는 신규 시즌을 처리해야 하며 season1 을 재처리해서는 안 된다.
  const r2 = await callReset();
  rec(
    '(5) reset#2 archives a DIFFERENT season (no reprocessing of already-archived season1)',
    r2.archived_season_id !== archivedSeasonId ? 'pass' : 'FAIL',
    `season1=${archivedSeasonId} reset#2_archived=${r2.archived_season_id}`,
  );
  const rowsAfterSecond = await qAll(
    `select * from ranking_season_result where season_id=$1`,
    [archivedSeasonId],
  );
  rec(
    '(5) season1 snapshot row count UNCHANGED after reset#2 (no duplicate/growth)',
    rowsAfterSecond.length === countAfterFirst ? 'pass' : 'FAIL',
    `before=${countAfterFirst} after=${rowsAfterSecond.length}`,
  );
  const activityAfterSecond = await activityScore(u1);
  rec(
    '(5) activity_score stays exactly 0 across back-to-back resets (no negative underflow)',
    activityAfterSecond === 0 ? 'pass' : 'FAIL',
    `got=${activityAfterSecond}`,
  );

  // "동시" 호출 시도: Promise.all 로 두 reset_season() 을 함께 발사(advisory lock 직렬화 검증).
  // pglite 는 단일 커넥션이라 진짜 병렬 트랜잭션은 아니지만, advisory lock 이 직렬화를 보장한다면
  // 두 호출 모두 성공하되 서로 DIFFERENT 시즌을 처리해야 한다(첫 호출이 활성 시즌을 archived 처리 +
  // 신규 시즌 개시까지 끝낸 뒤에야 두 번째 호출이 그 신규 시즌을 본다) — 같은 시즌을 두 번 archived 하면 결함.
  const activeBeforeConcurrent = await q1(`select id from ranking_season where status='active'`);
  const [rc1, rc2] = await Promise.all([callReset(), callReset()]);
  const outcomes = [rc1, rc2];
  const oks = outcomes.filter((r) => r.ok).length;
  const archivedIds = outcomes.filter((r) => r.ok).map((r) => r.archived_season_id);
  const distinctArchived = new Set(archivedIds).size;
  rec(
    '(5) concurrent double-call: both succeed but each archives a DIFFERENT season (advisory-lock serialized, no double-archive of same season)',
    oks === 2 && distinctArchived === 2 ? 'pass' : `FAIL(oks=${oks} archivedIds=${JSON.stringify(archivedIds)})`,
    `activeBefore=${activeBeforeConcurrent.id} outcomes=${JSON.stringify(outcomes)}`,
  );
  const seasonRows = await qAll(`select id, status from ranking_season where id=$1`, [activeBeforeConcurrent.id]);
  rec(
    '(5) the concurrently-targeted season ends up archived exactly once (status consistent, not corrupted)',
    seasonRows.length === 1 && seasonRows[0].status === 'archived' ? 'pass' : 'FAIL',
    JSON.stringify(seasonRows),
  );
}

// ============================================================
// (6) 1a 백필 UPDATE 두 번 적용 — 이미 >0 인 skill_score 불변
// ============================================================
{
  const db6 = await PGlite.create();
  await db6.exec(`
    create table user_progress (
      user_id uuid primary key,
      points int not null default 0,
      skill_score numeric not null default 0,
      activity_score numeric not null default 0,
      updated_at timestamptz default now()
    );
  `);
  const uA = uid(10); // points>0, skill_score=0 최초(백필 대상)
  const uB = uid(11); // points=0(미응시), skill_score=0(스킵 대상)
  const uC = uid(12); // 이미 skill_score>0(다른 소스로 이미 설정됨) — 백필이 절대 건드리면 안 됨
  await db6.query(`insert into user_progress (user_id, points, skill_score) values ($1,7000,0)`, [uA]);
  await db6.query(`insert into user_progress (user_id, points, skill_score) values ($1,0,0)`, [uB]);
  await db6.query(`insert into user_progress (user_id, points, skill_score) values ($1,7000,42)`, [uC]);

  const raw1a = readFileSync('supabase/migrations/20260721010000_ranking_progress_columns.sql', 'utf8');
  // 1a 는 alter table add column if not exists 를 포함하므로, 이미 컬럼이 있는 이 스텁 테이블에도 안전히 재적용 가능해야 한다.
  await db6.exec(raw1a);
  const s1 = await (async () => (await db6.query(
    `select user_id, skill_score from user_progress order by user_id`,
  )).rows)();
  const byId = Object.fromEntries(s1.map((r) => [r.user_id, Number(r.skill_score)]));

  rec('(6) backfill#1: uA(points=7000,skill=0) backfilled to 7000', byId[uA] === 7000 ? 'pass' : 'FAIL', `got=${byId[uA]}`);
  rec('(6) backfill#1: uB(points=0) skipped, stays 0', byId[uB] === 0 ? 'pass' : 'FAIL', `got=${byId[uB]}`);
  rec('(6) backfill#1: uC(already skill=42) UNTOUCHED, stays 42 (not overwritten by points=7000)', byId[uC] === 42 ? 'pass' : 'FAIL', `got=${byId[uC]}`);

  // 백필을 한 번 더(마이그레이션 재실행 시나리오) 적용 — 멱등성.
  await db6.exec(raw1a);
  const s2 = await (async () => (await db6.query(
    `select user_id, skill_score from user_progress order by user_id`,
  )).rows)();
  const byId2 = Object.fromEntries(s2.map((r) => [r.user_id, Number(r.skill_score)]));
  rec(
    '(6) backfill#2 (re-run): uA skill_score UNCHANGED at 7000 (no double-apply)',
    byId2[uA] === 7000 ? 'pass' : 'FAIL',
    `got=${byId2[uA]}`,
  );
  rec(
    '(6) backfill#2 (re-run): uC skill_score UNCHANGED at 42 (still not overwritten)',
    byId2[uC] === 42 ? 'pass' : 'FAIL',
    `got=${byId2[uC]}`,
  );
  rec(
    '(6) backfill#2 (re-run): uB(points=0) still skipped, stays 0',
    byId2[uB] === 0 ? 'pass' : 'FAIL',
    `got=${byId2[uB]}`,
  );
}

// ============================================================
// 출력 + JSON 아티팩트
// ============================================================
const isPass = (v) => v === 'pass' || v === 'pass(rejected)';
for (const x of results) console.log(`${isPass(x.verdict) ? 'PASS' : x.verdict.startsWith('FINDING') ? 'FIND' : 'FAIL'} | ${x.name} :: ${x.verdict} :: ${x.detail}`);

const total = results.length;
const passed = results.filter((x) => isPass(x.verdict)).length;
const failed = results.filter((x) => !isPass(x.verdict) && !x.verdict.startsWith('FINDING')).length;
const findings = results.filter((x) => x.verdict.startsWith('FINDING'));

console.log(`\nT-STAGE1-REDTEAM: ${passed}/${total} passed, ${failed} failed, ${findings.length} findings`);
console.log(JSON.stringify({ suite: 't-stage1-redteam', pg: 'pglite/postgres-18', total, passed, failed, findings: findings.length }));

const report = {
  schemaVersion: 1,
  kind: 'algorithm-boundary-report',
  suite: 't-stage1-redteam',
  total,
  passed,
  failed,
  cases: results.map((x) => ({ name: x.name, verdict: x.verdict, detail: x.detail })),
};
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/stage1-db-redteam-report.json', JSON.stringify(report, null, 2));

process.exit(failed === 0 ? 0 : 1);
