// T-complete-daily — complete_daily() 원자 SECURITY DEFINER fn 을 pglite(PostgreSQL 18) 로 검증한다.
//  · 기존 JS select→절대값 upsert(read-modify-write) 를 대체한 원자 증분 fn. 실제 마이그레이션 DDL 을 적용해 호출한다.
//  · 오늘 최초 호출: daily_activity 삽입 + 재화=10 + 스탬프=1 (first=true).
//  · 같은 날 재호출: first=false, 재화·스탬프 불변(1/day, 재적립 없음).
//  · 다음 날: 재화 20, 스탬프 2 — 증분은 원자(points = 기존 + p_points), 절대값 아님.
//  · cosmetic-only 하드 불변식: user_progress / user_level_skill 행은 전 과정에서 불변.
// fn 은 day 를 now()(KST) 로 내부 계산하므로, '다음 날' 은 기존 가드 행을 과거 날짜로 노후화(=새 달력일 도래)해 재현한다.
// auth 스키마가 pglite 에 없으므로 auth.users FK 없이 plain uuid 컬럼으로 최소 테이블만 만든다.
// role(anon/authenticated/service_role) 이 없으므로 마이그레이션의 revoke/grant 는 제외하고 fn DDL 만 적용한다.
import { PGlite } from '@electric-sql/pglite';

const DAILY_POINTS = 10;
const uid = '00000000-0000-0000-0000-000000000001';

const db = await PGlite.create();
await db.exec(`
  create table daily_activity (
    user_id uuid not null,
    day date not null,
    first_seen_at timestamptz default now(),
    primary key (user_id, day)
  );
  create table user_currency (
    user_id uuid primary key,
    points bigint not null default 0,
    updated_at timestamptz default now()
  );
  create table user_stamps (
    user_id uuid not null,
    stamp_kind text not null,
    count int not null default 0,
    updated_at timestamptz default now(),
    primary key (user_id, stamp_kind)
  );
  -- cosmetic-only 불변식 감시용 최소 테이블(경제 fn 이 절대 건드리면 안 됨).
  create table user_progress (
    user_id uuid primary key,
    xp int not null default 0
  );
  create table user_level_skill (
    user_id uuid not null,
    skill_key text not null,
    level int not null default 0,
    primary key (user_id, skill_key)
  );
`);

// 실제 마이그레이션과 동일한 complete_daily fn DDL 적용(revoke/grant 는 role 부재로 제외).
await db.exec(`
  create or replace function complete_daily(p_uid uuid, p_points int)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_day date := (now() at time zone 'Asia/Seoul')::date;
    v_first boolean;
  begin
    insert into daily_activity (user_id, day) values (p_uid, v_day)
      on conflict (user_id, day) do nothing;
    v_first := found;
    if v_first then
      insert into user_currency (user_id, points) values (p_uid, p_points)
        on conflict (user_id) do update
          set points = user_currency.points + p_points, updated_at = now();
      insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily', 1)
        on conflict (user_id, stamp_kind) do update
          set count = user_stamps.count + 1, updated_at = now();
    end if;
    return jsonb_build_object('ok', true, 'day', v_day, 'first', v_first);
  end
  $$;
`);

// cosmetic-only 감시 대상 시드(경제 흐름 전후로 반드시 그대로여야 한다).
await db.query(`insert into user_progress (user_id, xp) values ($1, 777)`, [uid]);
await db.query(`insert into user_level_skill (user_id, skill_key, level) values ($1, 'grammar', 5)`, [uid]);

// complete_daily(uid, DAILY_POINTS) 를 호출하고 반환 jsonb 의 first 를 돌려준다.
async function completeDaily() {
  const { rows } = await db.query(`select complete_daily($1, $2) as r`, [uid, DAILY_POINTS]);
  return Boolean(rows[0].r.first);
}

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const daN = async () => Number((await q1(`select count(*)::int n from daily_activity where user_id=$1`, [uid])).n);
const points = async () => Number((await q1(`select points from user_currency where user_id=$1`, [uid]))?.points ?? 0);
const stamp = async () => Number((await q1(`select count from user_stamps where user_id=$1 and stamp_kind='daily'`, [uid]))?.count ?? 0);

// --- 같은 날 1회차: 최초 삽입 → 적립 ---
const first1 = await completeDaily();
rec('day A 1st call inserts (first=true)', first1, true);
rec('day A 1st: 1 daily_activity row', await daN(), 1);
rec('day A 1st: points = DAILY_POINTS', await points(), DAILY_POINTS);
rec('day A 1st: stamp = 1', await stamp(), 1);

// --- 같은 날 2회차: 0행 삽입 + 재적립 없음(멱등) ---
const first2 = await completeDaily();
rec('day A 2nd call inserts nothing (first=false)', first2, false);
rec('day A 2nd: still 1 daily_activity row', await daN(), 1);
rec('day A 2nd: points unchanged (no re-credit)', await points(), DAILY_POINTS);
rec('day A 2nd: stamp unchanged (no re-credit)', await stamp(), 1);

// --- 다음 날 재현: 오늘 가드 행을 과거 날짜로 노후화(=새 달력일 도래) 후 재호출 → 다시 적립 ---
await db.query(`update daily_activity set day='2000-01-01' where user_id=$1`, [uid]);
const first3 = await completeDaily();
rec('day B call inserts (first=true)', first3, true);
rec('day B: 2 daily_activity rows', await daN(), 2);
rec('day B: points = 2*DAILY_POINTS (atomic increment)', await points(), 2 * DAILY_POINTS);
rec('day B: stamp = 2', await stamp(), 2);

// --- cosmetic-only 불변식: user_progress / user_level_skill 전 과정 불변 ---
const prog = await q1(`select xp from user_progress where user_id=$1`, [uid]);
rec('user_progress.xp UNCHANGED (cosmetic-only)', Number(prog.xp), 777);
const skill = await q1(`select level from user_level_skill where user_id=$1 and skill_key='grammar'`, [uid]);
rec('user_level_skill.level UNCHANGED (cosmetic-only)', Number(skill.level), 5);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter(x => !x.pass).length;
console.log(`\nT-COMPLETE-DAILY: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-complete-daily', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
