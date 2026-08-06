// T-Exam-Tickets — 마이그레이션 20260807090000_exam_tickets.sql 을 pglite 에 적용해
// **응시권 방어선이 DB 에서 실제로 서는지** 검증한다.
//
// 이 설계는 전부 DB 제약에 걸려 있다(코드는 23505 를 사람 말로 옮기기만 한다). 그래서 여기서 깨지면
// 코드가 아무리 맞아도 무료 응시·이중 응시·무한 세션이 그대로 뚫린다.
//   · 한 사람이 같은 (회차×급수)에 살아있는 응시권 2장 불가 — 수기 발급·무료 지급까지 포함해서
//   · 한 결제로 응시권 2장 불가 (승인·웹훅·대사가 동시에 grant 를 부를 수 있다)
//   · **한 응시권으로 응시 2개 불가 — 상태를 가리지 않는다** (제출 안 하고 나갔다 재진입해 세션을 새로 뽑는 구멍)
//   · 오타 티어로 응시권 발급 불가 (exams.tier 에는 CHECK 이 없다)
//   · 팔린 응시권이 있는 회차 삭제 불가
//   · 응시창 KST 백필 — 11~20 규칙에 맞는 회차만 넓히고, 벗어난 기존 회차는 시험일 당일만
//   · 접수창(apply_*)의 옛 UTC 값 -9시간 보정
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260807090000_exam_tickets.sql', 'utf8');
const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');

const db = await PGlite.create();
await db.exec(`set timezone = 'UTC';`);

// 마이그레이션이 alter/참조하는 선행 테이블만 실제 스키마와 같은 모양으로 세운다.
await db.exec(`
  create table exam_rounds (
    id uuid primary key default gen_random_uuid(),
    kind text not null default 'regular',
    title_i18n jsonb not null default '{}'::jsonb,
    exam_date date,
    apply_start_at timestamptz,
    apply_end_at timestamptz,
    published boolean not null default true,
    sort integer not null default 100
  );
  create table exams (
    id uuid primary key default gen_random_uuid(),
    slug text unique not null,
    round_id uuid references exam_rounds(id),
    tier text,
    active boolean not null default true,
    unique (round_id, tier)
  );
  create table exam_attempts (
    id uuid primary key default gen_random_uuid(),
    exam_id uuid references exams(id),
    round_id uuid references exam_rounds(id),
    user_id uuid not null,
    status text not null default 'in_progress',
    started_at timestamptz default now()
  );
  create table payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    order_id text not null unique,
    status text not null default 'pending'
  );
`);

// 백필 검증용 회차 — 규칙 안(15일)·규칙 밖(29일)·옛 UTC 접수창.
const R_IN = '00000000-0000-0000-0000-00000000r001'.replace(/r/g, 'a');
const R_OUT = '00000000-0000-0000-0000-00000000r002'.replace(/r/g, 'a');
await db.query(
  `insert into exam_rounds (id, exam_date, apply_start_at, apply_end_at) values
     ($1, date '2026-08-15', timestamptz '2026-08-01 00:00:00+00', timestamptz '2026-08-10 23:59:59+00'),
     ($2, date '2026-10-29', timestamptz '2026-09-30 15:00:00+00', timestamptz '2026-10-20 14:59:59+00')`,
  [R_IN, R_OUT],
);
await db.query(`insert into exams (slug, round_id, tier) values ('r-1-pro', $1, 'pro')`, [R_IN]);

await db.exec(strip(raw));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });
const failsWith = async (fn) => { try { await fn(); return null } catch (e) { return e.message || String(e) } };

const U1 = '00000000-0000-0000-0000-0000000000c1';
const U2 = '00000000-0000-0000-0000-0000000000c2';

let n = 0;
const mkTicket = (userId, opts = {}) => {
  const { round = R_IN, tier = 'pro', status = 'issued', paymentId = null, source = 'pg' } = opts;
  return db.query(
    `insert into exam_tickets (user_id, round_id, tier, status, source, payment_id)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [userId, round, tier, status, source, paymentId],
  ).then((r) => { n++; return r.rows[0].id });
};

// --- (1) 응시창 KST 백필 ---
const win = (await db.query(
  `select id,
          (exam_start_at at time zone 'Asia/Seoul')::text s,
          (exam_end_at   at time zone 'Asia/Seoul')::text e
     from exam_rounds order by exam_date`,
)).rows;
const inR = win.find((r) => r.id === R_IN);
const outR = win.find((r) => r.id === R_OUT);
rec('규칙 안(8/15) → 시험창 8/11 00:00 KST', inR.s, '2026-08-11 00:00:00');
rec('규칙 안(8/15) → 시험창 8/20 23:59:59 KST', inR.e, '2026-08-20 23:59:59');
// ⚠️ 11~20 을 그대로 밀어넣으면 시험일(10/29)이 창 밖으로 빠져 그 회차는 아무도 응시할 수 없다.
rec('규칙 밖(10/29) → 시험일 당일만', outR.s, '2026-10-29 00:00:00');
rec('규칙 밖(10/29) → 당일 끝까지', outR.e, '2026-10-29 23:59:59');

// --- (2) 접수창 옛 UTC 값 -9h 보정 ---
const ap = (await db.query(
  `select id, (apply_end_at at time zone 'Asia/Seoul')::text e from exam_rounds`,
)).rows;
// R_IN 은 옛 포맷(23:59:59Z) → 보정돼 KST 8/10 23:59:59 이어야 한다.
rec('옛 UTC 접수마감 → KST 로 보정', ap.find((r) => r.id === R_IN).e, '2026-08-10 23:59:59');
// R_OUT 은 이미 KST(14:59:59Z = 23:59:59 KST) → 건드리면 안 된다.
rec('이미 KST 인 접수마감은 그대로', ap.find((r) => r.id === R_OUT).e, '2026-10-20 23:59:59');

// --- (3) 급수 레지스트리 ---
rec('exam_tiers 6행 시드', (await db.query(`select count(*)::int c from exam_tiers`)).rows[0].c, 6);
rec('오타 티어는 FK 로 거부', (await failsWith(() => mkTicket(U1, { tier: 'prro' }))) !== null, true);

// --- (4) ⭐ 살아있는 응시권 1장 (수기·무료 지급까지 포함해서 막는다) ---
await mkTicket(U1);
rec('같은 (사람×회차×급수) 두 번째 issued 거부',
  (await failsWith(() => mkTicket(U1, { source: 'admin' }))) !== null, true);
rec('다른 사람은 허용', await failsWith(() => mkTicket(U2)), null);
rec('같은 사람 다른 급수는 허용(회차당 여러 급수 접수)', await failsWith(() => mkTicket(U1, { tier: 'elite' })), null);

// void 되면 재발급이 열린다
await db.query(`update exam_tickets set status='void' where user_id=$1 and tier='pro'`, [U1]);
rec('void 후 재발급 허용', await failsWith(() => mkTicket(U1)), null);

// --- (5) 한 결제 = 응시권 1장 ---
const pay = (await db.query(
  `insert into payments (user_id, order_id, status) values ($1,'exam-order-1','paid') returning id`, [U2],
)).rows[0].id;
await mkTicket(U2, { tier: 'elite', paymentId: pay });
rec('같은 결제로 두 번째 발급 거부',
  (await failsWith(() => mkTicket(U2, { tier: 'beginner', paymentId: pay }))) !== null, true);
// payment_id 가 null 인 행은 여럿 허용돼야 한다(수기·무료 발급)
rec('payment_id null 은 여러 장 허용',
  (await db.query(`select count(*)::int c from exam_tickets where payment_id is null`)).rows[0].c > 1, true);

// --- (6) ⭐ 한 응시권 = 응시 1개 (상태 무관) ---
const exam = (await db.query(`select id from exams limit 1`)).rows[0].id;
const tk = (await db.query(`select id from exam_tickets where user_id=$1 and tier='pro' and status='issued' limit 1`, [U1])).rows[0].id;
await db.query(
  `insert into exam_attempts (exam_id, round_id, user_id, ticket_id, status) values ($1,$2,$3,$4,'in_progress')`,
  [exam, R_IN, U1, tk],
);
rec('같은 응시권으로 두 번째 응시 거부(in_progress)',
  (await failsWith(() => db.query(
    `insert into exam_attempts (exam_id, round_id, user_id, ticket_id, status) values ($1,$2,$3,$4,'in_progress')`,
    [exam, R_IN, U1, tk]))) !== null, true);
// ⚠️ 여기가 핵심 — 옛 인덱스는 status in ('in_progress','submitted') 라 expired 로 눕히면 새로 만들 수 있었다.
//    시험창이 10일이라 4시간마다 반복하면 제한시간·1인1회가 통째로 무의미해진다.
await db.query(`update exam_attempts set status='expired' where ticket_id=$1`, [tk]);
rec('expired 로 눕혀도 새 응시 생성 거부(무한 세션 차단)',
  (await failsWith(() => db.query(
    `insert into exam_attempts (exam_id, round_id, user_id, ticket_id, status) values ($1,$2,$3,$4,'in_progress')`,
    [exam, R_IN, U1, tk]))) !== null, true);
// ticket_id 가 null 인 옛 응시들은 제약 대상이 아니어야 한다(하위호환)
rec('ticket_id null 응시는 여러 개 허용(기존 데이터)',
  await failsWith(() => db.query(
    `insert into exam_attempts (exam_id, round_id, user_id, status) values ($1,$2,$3,'submitted'),($1,$2,$3,'submitted')`,
    [exam, R_IN, U2])), null);

// --- (7) 팔린 응시권이 있는 회차는 못 지운다 ---
rec('응시권 있는 회차 삭제 거부(FK NO ACTION)',
  (await failsWith(() => db.query(`delete from exam_rounds where id=$1`, [R_IN]))) !== null, true);

// --- (8) 잠금 테이블 ---
rec('exam_tickets RLS 활성화',
  (await db.query(`select relrowsecurity from pg_class where relname='exam_tickets'`)).rows[0].relrowsecurity, true);
rec('exam_tickets 정책 0개(service role 전용)',
  (await db.query(`select count(*)::int c from pg_policies where tablename='exam_tickets'`)).rows[0].c, 0);

// --- (9) 멱등 — 재실행해도 안 깨지고 백필이 값을 되돌리지 않는다 ---
await db.query(`update exam_rounds set exam_start_at = timestamptz '2026-08-12 00:00:00+09' where id=$1`, [R_IN]);
const reErr = await failsWith(() => db.exec(strip(raw)));
rec('마이그레이션 재실행 안전', reErr, null);
rec('재실행이 관리자가 조정한 응시창을 안 되돌린다',
  (await db.query(`select (exam_start_at at time zone 'Asia/Seoul')::text s from exam_rounds where id=$1`, [R_IN])).rows[0].s,
  '2026-08-12 00:00:00');

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-EXAM-TICKETS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-exam-tickets', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
