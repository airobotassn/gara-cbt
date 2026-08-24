// T-Coin-Gift-Concurrency — coin_gift 를 **진짜 멀티 커넥션 Postgres** 에서 동시에 두들긴다.
//
// 왜 별도 파일인가: 나머지 DB 테스트가 쓰는 pglite 는 **단일 커넥션**이라 트랜잭션 두 개를 동시에 열 수
//   없다. 즉 이 기능에서 제일 위험한 것들(데드락·경합·이중 이체)을 구조적으로 재현할 수 없다.
//   코인 선물은 **즉시 이체라 되돌릴 수 없어서**, "동시에 오면 어떻게 되나"를 추측으로 두면 안 된다.
//
// 실행:
//   docker run -d --name cari-pgtest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=caritest \
//     -p 55432:5432 postgres:17-alpine
//   bun tests/db/t-coin-gift-concurrency.mjs
//   (다른 DB 를 쓰려면 CARI_TEST_PG 환경변수. ⚠️ 운영 DB 를 절대 가리키지 말 것 — 스키마를 지운다.)
//
// Postgres 클라이언트는 Bun 내장(Bun.sql)이라 의존성을 추가하지 않는다.
// 커넥션마다 별도 SQL 인스턴스(max:1)를 만든다 — 풀에 맡기면 두 요청이 같은 커넥션을 타서
// 동시 실행이 아니라 순차 실행이 되고, 테스트가 조용히 무의미해진다.
import { SQL } from 'bun';
import { readFileSync } from 'node:fs';

const URL = process.env.CARI_TEST_PG ?? 'postgres://postgres:test@127.0.0.1:55432/caritest';
const raw = readFileSync('supabase/migrations/20260807120000_coin_gift.sql', 'utf8');
// 지목 수단이 친구코드 → 닉네임으로 바뀐 뒤의 함수를 검증한다(둘을 순서대로 적용).
const rawNick = readFileSync('supabase/migrations/20260824140000_coin_gift_by_nickname.sql', 'utf8');

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const admin = new SQL({ url: URL, max: 1 });
const conn = (n) => Array.from({ length: n }, () => new SQL({ url: URL, max: 1 }));

const isDeadlock = (e) => /deadlock detected/i.test(e?.message ?? '');
const reason = (e) => (e?.message ?? '').match(/insufficient_points|too_fast|self_transfer|recipient_not_found|invalid_amount/)?.[0] ?? null;

// ---------- 스키마 ----------
await admin`drop schema if exists public cascade`;
await admin`create schema public`;
await admin`drop schema if exists auth cascade`;
await admin`create schema auth`;
await admin`create table auth.users (id uuid primary key)`;
for (const r of ['anon', 'authenticated', 'service_role']) {
  await admin.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname='${r}') then create role ${r}; end if; end $$;`);
}
await admin.unsafe(`
  create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text, referral_code text, deactivated_at timestamptz,
    -- 닉네임 지목의 전제. 확정 안 된 계정은 조회·이체 양쪽에서 안 잡힌다.
    nickname_set_at timestamptz, avatar_url text, country_code text, region_code text
  );
  create table user_progress (
    user_id uuid primary key references auth.users(id) on delete cascade,
    season_total bigint not null default 0
  );
  create table user_currency (
    user_id uuid primary key references auth.users(id) on delete cascade,
    points bigint not null default 0, dust bigint not null default 0, updated_at timestamptz default now()
  );
`);
await admin.unsafe(raw);
await admin.unsafe(rawNick);

// 음성 대조군 — **일부러 틀린 잠금 순서**(보내는 사람 먼저 → 받는 사람). 실제 함수와 로직은 같고 순서만 다르다.
// 이게 없으면 "데드락 0건"이 '순서가 옳아서'인지 '테스트가 애초에 경쟁을 못 만들어서'인지 구분할 수 없다.
// 두 잠금 사이 pg_sleep 은 창을 넓혀 결과를 결정적으로 만든다(실제 함수엔 없다).
await admin.unsafe(`
  create or replace function gift_naive(p_from uuid, p_to uuid, p_amt int) returns void
  language plpgsql as $$
  begin
    perform 1 from user_currency where user_id = p_from for update;
    perform pg_sleep(0.15);
    perform 1 from user_currency where user_id = p_to for update;
    update user_currency set points = points - p_amt where user_id = p_from;
    update user_currency set points = points + p_amt where user_id = p_to;
  end $$;

  -- 같은 창 넓히기를 **실제 함수와 같은 정렬 잠금**에 적용한 것. 순서만 바꾼 대조군이다.
  create or replace function gift_ordered(p_from uuid, p_to uuid, p_amt int) returns void
  language plpgsql as $$
  declare v_lo uuid; v_hi uuid;
  begin
    v_lo := least(p_from, p_to); v_hi := greatest(p_from, p_to);
    perform 1 from user_currency where user_id = v_lo for update;
    perform pg_sleep(0.15);
    perform 1 from user_currency where user_id = v_hi for update;
    update user_currency set points = points - p_amt where user_id = p_from;
    update user_currency set points = points + p_amt where user_id = p_to;
  end $$;
`);

// ---------- 사용자 ----------
const uid = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
// 닉네임으로 지목한다(2026-08-24 부터 친구코드 경로가 없다). display_name 과 같은 값이어야 한다.
const nick = (n) => `유저${n}`;
// 사용자 수는 부하 단계의 쿨다운 충돌률이 정한다 — 적으면 같은 (보낸이×받는이) 쌍이 계속 겹쳐
// too_fast 만 잔뜩 나오고 정작 이체가 안 일어나 테스트가 조용히 무의미해진다.
const N_USERS = 24;
const START = 100000;
for (let i = 0; i < N_USERS; i++) {
  await admin`insert into auth.users(id) values (${uid(i)}::uuid)`;
  await admin`insert into profiles(id, display_name, nickname_set_at) values (${uid(i)}::uuid, ${nick(i)}, now())`;
  await admin`insert into user_currency(user_id, points) values (${uid(i)}::uuid, ${START})`;
}
const totalStart = N_USERS * START;

// ============================================================
// (1) 음성 대조군 — 틀린 순서는 실제로 데드락이 난다
// ============================================================
{
  const [c1, c2] = conn(2);
  let deadlocks = 0;
  for (let i = 0; i < 6; i++) {
    const out = await Promise.allSettled([
      c1`select gift_naive(${uid(0)}::uuid, ${uid(1)}::uuid, 1)`,
      c2`select gift_naive(${uid(1)}::uuid, ${uid(0)}::uuid, 1)`,
    ]);
    deadlocks += out.filter((r) => r.status === 'rejected' && isDeadlock(r.reason)).length;
  }
  await Promise.all([c1.end(), c2.end()]);
  // 여기가 0 이면 아래 결과는 전부 의미가 없다 — 테스트가 경쟁을 못 만든 것이다.
  rec('[대조군] 잠금 순서가 틀리면 데드락이 난다(테스트 유효성)', deadlocks > 0, true);
}

// ============================================================
// (2) 정렬 잠금 — 같은 조건에서 데드락 0
// ============================================================
{
  const [c1, c2] = conn(2);
  let deadlocks = 0;
  for (let i = 0; i < 6; i++) {
    const out = await Promise.allSettled([
      c1`select gift_ordered(${uid(0)}::uuid, ${uid(1)}::uuid, 1)`,
      c2`select gift_ordered(${uid(1)}::uuid, ${uid(0)}::uuid, 1)`,
    ]);
    deadlocks += out.filter((r) => r.status === 'rejected' && isDeadlock(r.reason)).length;
  }
  await Promise.all([c1.end(), c2.end()]);
  rec('[정렬] least/greatest 로 잠그면 같은 조건에서 데드락 0', deadlocks, 0);
}

// ============================================================
// (3) 같은 nonce 동시 8발 — 이체는 정확히 1회여야 한다
// ============================================================
{
  const cs = conn(8);
  const before = Number((await admin`select points from user_currency where user_id=${uid(2)}::uuid`)[0].points);
  const out = await Promise.allSettled(
    cs.map((c) => c`select coin_gift(${uid(2)}::uuid, ${nick(3)}::text, 500::int, ${'same-nonce'}::text) r`),
  );
  await Promise.all(cs.map((c) => c.end()));
  const ok = out.filter((r) => r.status === 'fulfilled');
  const dups = ok.filter((r) => r.value[0].r.duplicate === true).length;
  const rows = Number((await admin`select count(*)::int c from coin_transfers where client_nonce='same-nonce'`)[0].c);
  const after = Number((await admin`select points from user_currency where user_id=${uid(2)}::uuid`)[0].points);

  rec('[멱등] 같은 nonce 8발 — 원장 1행', rows, 1);
  rec('[멱등] 같은 nonce 8발 — 잔액은 1회만 차감', before - after, 500);
  rec('[멱등] 같은 nonce 8발 — 전부 성공 응답(실패 노출 없음)', ok.length, 8);
  rec('[멱등] 같은 nonce 8발 — 7건은 duplicate=true', dups, 7);
  rec('[멱등] 데드락 없음', out.filter((r) => r.status === 'rejected' && isDeadlock(r.reason)).length, 0);
}

// ============================================================
// (4) 잔액 경합 — 잔액 500, 500짜리 전송 6개 동시
// ============================================================
{
  await admin`update user_currency set points = 500 where user_id=${uid(4)}::uuid`;
  const cs = conn(6);
  const out = await Promise.allSettled(
    cs.map((c, i) => c`select coin_gift(${uid(4)}::uuid, ${nick(6 + i)}::text, 500::int, ${'race-' + i}::text) r`),
  );
  await Promise.all(cs.map((c) => c.end()));
  const ok = out.filter((r) => r.status === 'fulfilled').length;
  const insuff = out.filter((r) => r.status === 'rejected' && reason(r.reason) === 'insufficient_points').length;
  const bal = Number((await admin`select points from user_currency where user_id=${uid(4)}::uuid`)[0].points);

  rec('[경합] 잔액 500 · 500짜리 6발 — 성공 정확히 1건', ok, 1);
  rec('[경합] 나머지 5건은 insufficient_points', insuff, 5);
  rec('[경합] 잔액이 음수로 내려가지 않는다', bal, 0);
}

// ============================================================
// (5) 쿨다운 경합 — 같은 수신자에게 동시 2발
//     ⚠️ 쿨다운 검사가 **잠금 앞**에 있으면 둘 다 "직전 없음"을 보고 통과한다(2026-08-07 실제 재현).
//        잠금 뒤로 옮기면 둘째가 첫째를 기다렸다가 커밋된 원장을 본다.
// ============================================================
{
  const [c1, c2] = conn(2);
  const out = await Promise.allSettled([
    c1`select coin_gift(${uid(8)}::uuid, ${nick(9)}::text, 10::int, ${'cd-1'}::text) r`,
    c2`select coin_gift(${uid(8)}::uuid, ${nick(9)}::text, 10::int, ${'cd-2'}::text) r`,
  ]);
  await Promise.all([c1.end(), c2.end()]);
  const ok = out.filter((r) => r.status === 'fulfilled').length;
  const tooFast = out.filter((r) => r.status === 'rejected' && reason(r.reason) === 'too_fast').length;
  rec('[쿨다운] 동시 2발 중 1건만 성공', ok, 1);
  rec('[쿨다운] 나머지는 too_fast 로 차단', tooFast, 1);
}

// ============================================================
// (6) 실제 함수 무작위 부하 — 데드락 0 · 총량 보존 · 음수 없음 · 원장 정합
// ============================================================
{
  // ⚠️ 앞 단계들이 원장을 안 거치고 잔액을 직접 만졌다(대조군 함수 gift_naive/gift_ordered, 경합용 수동 UPDATE).
  //    그 상태로 총량·원장 정합을 재면 **제품이 아니라 테스트 자신의 조작을 잡아낸다**(처음에 실제로 그랬다).
  //    부하 단계는 깨끗한 기준선에서 시작한다.
  await admin`delete from coin_transfers`;
  await admin`update user_currency set points = ${START}`;

  const CONNS = 8;
  const ROUNDS = 40;
  const cs = conn(CONNS);
  let deadlocks = 0;
  let sent = 0;
  const reasons = {};
  // 결정적 의사난수 — 실패 재현을 위해 Math.random 을 쓰지 않는다.
  //   ⚠️ 흔한 LCG(seed * 1103515245 + 12345)를 쓰면 안 된다. JS 는 double 이라 그 곱이 2^53 을 넘겨
  //     정밀도가 깨지고 주기가 사실상 몇 개로 쪼그라든다 — 같은 (보낸이×받는이) 쌍만 반복해 뽑혀서
  //     320발 중 309발이 too_fast 로 튕겼다(2026-08-07, 실제로 겪음). xorshift32 는 |0 으로
  //     int32 안에 머물러 이 문제가 없다.
  let seed = 12345;
  const rnd = (n) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0;
    return Math.abs(seed) % n;
  };

  for (let r = 0; r < ROUNDS; r++) {
    const jobs = cs.map((c, i) => {
      const from = rnd(N_USERS);
      let to = rnd(N_USERS);
      if (to === from) to = (to + 1) % N_USERS;
      return c`select coin_gift(${uid(from)}::uuid, ${nick(to)}::text, ${1 + rnd(50)}::int, ${`load-${r}-${i}`}::text) r`;
    });
    const out = await Promise.allSettled(jobs);
    deadlocks += out.filter((x) => x.status === 'rejected' && isDeadlock(x.reason)).length;
    sent += out.filter((x) => x.status === 'fulfilled').length;
    for (const x of out) {
      if (x.status === 'rejected') {
        const k = isDeadlock(x.reason) ? 'DEADLOCK' : (reason(x.reason) ?? 'other');
        reasons[k] = (reasons[k] ?? 0) + 1;
      }
    }
  }
  await Promise.all(cs.map((c) => c.end()));
  console.log(`  · 부하 결과: 성공 ${sent} / 거절 ${JSON.stringify(reasons)}`);

  const totalNow = Number((await admin`select sum(points)::bigint s from user_currency`)[0].s);
  const negatives = Number((await admin`select count(*)::int c from user_currency where points < 0`)[0].c);
  // 원장 정합 — 사람마다 (초기 + 받은 − 보낸) 이 현재 잔액과 정확히 맞아야 한다.
  const mismatch = Number((await admin.unsafe(`
    select count(*)::int c from (
      select u.user_id, u.points,
             ${START} + coalesce((select sum(amount) from coin_transfers t where t.recipient_id = u.user_id), 0)
                      - coalesce((select sum(amount) from coin_transfers t where t.sender_id    = u.user_id), 0) expected
        from user_currency u
    ) x where x.points <> x.expected
  `))[0].c);

  rec(`[부하] ${CONNS}커넥션 × ${ROUNDS}라운드 — 데드락 0`, deadlocks, 0);
  // 이 줄이 있어야 아래 불변식 통과가 의미를 갖는다 — 이체가 0건이어도 총량은 당연히 보존된다.
  rec('[부하] 실제로 이체가 일어났다(테스트 유효성)', sent > 150, true);
  rec('[부하] 코인 총량 보존', totalNow, totalStart);
  rec('[부하] 음수 잔액 0', negatives, 0);
  rec('[부하] 원장 = 잔액 (초기 + 받은 − 보낸)', mismatch, 0);
}

await admin.end();

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-COIN-GIFT-CONCURRENCY: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-coin-gift-concurrency', pg: 'postgres/real', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
