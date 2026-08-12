// T-complete-daily — 출석/학습 적립 fn 을 pglite(PostgreSQL 18) 로 검증한다.
//  ⚠️ 이 테스트는 **마이그레이션 파일을 그대로 읽어서** 적용한다. 예전엔 fn 본문을 테스트 안에 복사해 뒀는데,
//     그 사본이 2026-07 개편(complete_daily_kind) 이후로 갱신되지 않아 **죽은 코드를 검증하고 있었다**.
//     사본을 두면 제품이 바뀌어도 테스트는 계속 초록불이다 — 다시 복사해 넣지 말 것.
//  검증 범위:
//   · 하루 1회 가드(같은 날 재호출은 재적립 없음) · 날이 바뀌면 다시 적립(원자 증분)
//   · 스탬프 7일 사이클: 1..7 로 차고, 7 을 찍은 날은 판이 꽉 찬 채로 남고, **다음 출석에서 1 로** 새 사이클
//   · 7일 완주 보너스 코인(+20)은 7 을 찍은 그 호출에서만
//   · 총 누적 출석일('daily_total')은 사이클 리셋과 무관하게 계속 증가
//   · 백필: 리셋 없이 쌓여 있던 옛 누적값이 (총 누적, 사이클 위치)로 갈라진다
//   · cosmetic-only 하드 불변식: user_progress / user_level_skill 행은 전 과정에서 불변
// fn 은 day 를 now()(KST) 로 내부 계산하므로, '다음 날' 은 가드 행을 과거 날짜로 노후화해 재현한다.
// auth 스키마가 pglite 에 없으므로 auth.users FK 없이 plain uuid 컬럼으로 최소 테이블만 만든다.
// role(anon/authenticated/service_role) 이 없으므로 마이그레이션의 revoke/grant 줄만 걷어낸다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const DAILY_POINTS = 10;
const CYCLE_BONUS = 20; // 마이그레이션의 c_cycle_bonus 와 같은 값
const uid = '00000000-0000-0000-0000-000000000001';
const uidOld = '00000000-0000-0000-0000-0000000000ff'; // 백필 대상(옛 누적값 보유)

const db = await PGlite.create();
await db.exec(`
  create table daily_activity (
    user_id uuid not null,
    day date not null,
    first_seen_at timestamptz default now(),
    did_attendance boolean not null default false,
    did_learn boolean not null default false,
    did_minigame boolean not null default false,
    did_leveltest boolean not null default false,
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

// 백필 대상: 리셋이 없던 시절의 누적 스탬프 23회. 23 = 7*3 + 2 → 사이클 위치 2, 총 누적 23.
await db.query(`insert into user_stamps (user_id, stamp_kind, count) values ($1,'daily',23)`, [uidOld]);

// 실제 마이그레이션 파일을 그대로 적용(권한 구문만 제외 — pglite 엔 role 이 없다).
const applyMigration = async (file) => {
  const sql = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(revoke|grant)\s/i.test(l))
    .join('\n');
  await db.exec(sql);
};
await applyMigration('20260727010000_complete_daily_per_kind.sql');
await applyMigration('20260812120000_stamp_7day_cycle.sql');

// cosmetic-only 감시 대상 시드(경제 흐름 전후로 반드시 그대로여야 한다).
await db.query(`insert into user_progress (user_id, xp) values ($1, 777)`, [uid]);
await db.query(`insert into user_level_skill (user_id, skill_key, level) values ($1, 'grammar', 5)`, [uid]);

const results = [];
const rec = (name, got, want) => results.push({ name, got, want, pass: JSON.stringify(got) === JSON.stringify(want) });

const q1 = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const daN = async () => Number((await q1(`select count(*)::int n from daily_activity where user_id=$1`, [uid])).n);
const points = async () => Number((await q1(`select points from user_currency where user_id=$1`, [uid]))?.points ?? 0);
const stampOf = async (who, kind) =>
  Number((await q1(`select count from user_stamps where user_id=$1 and stamp_kind=$2`, [who, kind]))?.count ?? 0);
const cycle = () => stampOf(uid, 'daily');
const total = () => stampOf(uid, 'daily_total');

/** 출석 1회. 반환 = fn 의 jsonb 전체(first / stamps / bonus 를 본다). */
async function checkIn() {
  const { rows } = await db.query(`select complete_daily_kind($1, $2, 'attendance') as r`, [uid, DAILY_POINTS]);
  return rows[0].r;
}
/** 다음 날 재현 — 오늘 가드 행만 **서로 겹치지 않는** 과거 날짜로 밀어낸다(=새 달력일 도래).
 *  ⚠️ 전체 행을 한꺼번에 당기면 여러 날을 돌릴 때 (user_id, day) 가 충돌한다. */
let aged = 0;
const nextDay = () =>
  db.query(`update daily_activity set day = date '1990-01-01' + $2::int where user_id=$1 and day > date '2000-01-01'`,
    [uid, aged++]);

// ── 백필 ────────────────────────────────────────────────────
rec('backfill: 옛 누적 23 → 총 누적 23 보존', await stampOf(uidOld, 'daily_total'), 23);
rec('backfill: 옛 누적 23 → 사이클 위치 2', await stampOf(uidOld, 'daily'), 2);

// ── 같은 날 1회차 / 2회차(멱등) ──────────────────────────────
const r1 = await checkIn();
rec('day 1: first=true', r1.first, true);
rec('day 1: daily_activity 1행', await daN(), 1);
rec('day 1: 코인 = DAILY_POINTS', await points(), DAILY_POINTS);
rec('day 1: 사이클 1', await cycle(), 1);
rec('day 1: 총 누적 1', await total(), 1);
rec('day 1: 보너스 없음', r1.bonus, 0);

const r2 = await checkIn();
rec('day 1 재호출: first=false', r2.first, false);
rec('day 1 재호출: 코인 불변', await points(), DAILY_POINTS);
rec('day 1 재호출: 사이클 불변', await cycle(), 1);
rec('day 1 재호출: 총 누적 불변', await total(), 1);

// ── 2~6일차: 사이클이 차오른다(보너스 없음) ──────────────────
for (let d = 2; d <= 6; d++) {
  await nextDay();
  const r = await checkIn();
  rec(`day ${d}: 사이클 ${d}`, await cycle(), d);
  rec(`day ${d}: 보너스 없음`, r.bonus, 0);
}
rec('day 6: 코인 = 60', await points(), 6 * DAILY_POINTS);
rec('day 6: 총 누적 6', await total(), 6);

// ── 7일차: 판이 꽉 차고 보너스가 붙는다 ──────────────────────
await nextDay();
const r7 = await checkIn();
rec('day 7: 사이클 7 (판이 꽉 참)', await cycle(), 7);
rec('day 7: 보너스 지급', r7.bonus, CYCLE_BONUS);
rec('day 7: 코인 = 70 + 보너스 20', await points(), 7 * DAILY_POINTS + CYCLE_BONUS);
rec('day 7: 총 누적 7', await total(), 7);

// ── 8일차: 새 사이클이 1 부터. 7 을 찍은 자리에서 접지 않는다 ──
await nextDay();
const r8 = await checkIn();
rec('day 8: 사이클 1 (새 판)', await cycle(), 1);
rec('day 8: 보너스 없음', r8.bonus, 0);
rec('day 8: 코인 = 80 + 보너스 20', await points(), 8 * DAILY_POINTS + CYCLE_BONUS);
rec('day 8: 총 누적 8 (리셋 무관하게 계속 쌓임)', await total(), 8);

// ── 14일차: 두 번째 완주에도 보너스가 또 붙는다 ──────────────
for (let d = 9; d <= 13; d++) { await nextDay(); await checkIn(); }
await nextDay();
const r14 = await checkIn();
rec('day 14: 사이클 7 (두 번째 완주)', await cycle(), 7);
rec('day 14: 보너스 재지급', r14.bonus, CYCLE_BONUS);
rec('day 14: 총 누적 14', await total(), 14);

// ── 출석·학습은 재화를 통틀어 하루 1회 ──────────────────────
await nextDay();
await checkIn();
const { rows: lr } = await db.query(`select complete_daily_kind($1, $2, 'daily_learn') as r`, [uid, DAILY_POINTS]);
rec('같은 날 학습: first=false (재화는 통틀어 1회)', lr[0].r.first, false);
rec('같은 날 학습: kind_first=true (종류는 처음)', lr[0].r.kind_first, true);
rec('같은 날 학습: 사이클 불변(15일차 = 1)', await cycle(), 1);
rec('같은 날 학습: 총 누적 불변', await total(), 15);

// ── cosmetic-only 불변식 ────────────────────────────────────
rec('user_progress.xp UNCHANGED (cosmetic-only)', Number((await q1(`select xp from user_progress where user_id=$1`, [uid])).xp), 777);
rec('user_level_skill.level UNCHANGED (cosmetic-only)', Number((await q1(`select level from user_level_skill where user_id=$1 and skill_key='grammar'`, [uid])).level), 5);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-COMPLETE-DAILY: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-complete-daily', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
