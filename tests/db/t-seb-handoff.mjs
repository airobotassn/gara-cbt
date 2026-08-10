// T-SEB-HANDOFF — 마이그레이션 20260810120000_seb_handoff.sql 을 pglite 에 적용해
// **SEB 로그인 인계표의 1회성**을 검증한다.
//
// 이 표는 "이 사람이 이 응시권으로 응시한다"를 SEB 안으로 넘기는 유일한 수단이라, 한 장이 두 번 먹히면
// 같은 응시권으로 두 군데서 들어갈 수 있다. 그래서 여기서 보는 건 코드가 아니라 **문장 하나의 원자성**이다:
//   update ... where nonce_hash=$1 and redeemed_at is null and expires_at > now()
// 이게 두 번째 호출에서 0행을 돌려주는가.
//
// ⚠️ pglite 는 단일 커넥션이라 **진짜 동시 실행은 재현하지 못한다**(t-coin-gift.mjs 와 같은 한계).
//    여기서 보증하는 건 "이미 쓴 표·만료된 표가 다시 먹히지 않는다"까지고,
//    동시 요청 두 개가 한 문장에서 갈리는 것은 조건부 UPDATE 라는 형태 자체가 보증한다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260810120000_seb_handoff.sql', 'utf8');

// pglite 엔 auth 스키마가 없다 — FK 만 떼고 나머지 DDL 은 원본 그대로 적용한다(t-payments.mjs 와 같은 방식).
const strip = (sql) => sql.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');

const db = await PGlite.create();

// 마이그레이션이 참조하는 선행 테이블만 최소 형태로.
await db.exec(`
  create table exam_tickets (id uuid primary key default gen_random_uuid());
`);
await db.exec(strip(raw));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const U1 = '00000000-0000-0000-0000-0000000000a1';
const T1 = '00000000-0000-0000-0000-0000000000c1';
await db.query(`insert into exam_tickets (id) values ($1)`, [T1]);

const failsWith = async (fn) => {
  try { await fn(); return null; } catch (e) { return e.message || String(e); }
};

const put = (hash, { minutes = 5 } = {}) =>
  db.query(
    `insert into seb_handoff (nonce_hash, user_id, ticket_id, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval) returning id`,
    [hash, U1, T1, String(minutes)],
  );

// 실제 함수(seb-handoff redeem)가 쓰는 것과 **같은 문장**. 여기서 갈리지 않으면 서버에서도 안 갈린다.
const claim = (hash) =>
  db.query(
    `update seb_handoff set redeemed_at = now()
      where nonce_hash = $1 and redeemed_at is null and expires_at > now()
      returning user_id, ticket_id`,
    [hash],
  );

// --- (1) 테이블·잠금 ---
const cols = (await db.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='seb_handoff'`,
)).rows.map((r) => r.column_name);
rec('seb_handoff 테이블 생성됨', cols.length > 0, true);
for (const c of ['nonce_hash', 'user_id', 'ticket_id', 'expires_at', 'redeemed_at', 'created_at']) {
  rec(`seb_handoff.${c} 존재`, cols.includes(c), true);
}
const rls = (await db.query(
  `select relrowsecurity from pg_class where oid='public.seb_handoff'::regclass`,
)).rows[0];
rec('RLS 켜짐', rls.relrowsecurity, true);
const pol = (await db.query(`select count(*)::int n from pg_policies where tablename='seb_handoff'`)).rows[0];
// 정책 0개 = service role(엣지 함수) 전용. 하나라도 생기면 클라가 표를 직접 읽거나 만들 수 있게 된다.
rec('⭐ RLS 정책 0개(함수 전용)', pol.n, 0);

// --- (2) 같은 nonce 가 두 행이 될 수 없다 ---
await put('hash-dup');
rec('nonce_hash 중복 거부', (await failsWith(() => put('hash-dup'))) !== null, true);

// --- (3) 1회용 ---
await put('hash-once');
const first = await claim('hash-once');
rec('첫 교환 성공', first.rows.length, 1);
rec('첫 교환이 표의 주인·응시권을 준다', `${first.rows[0].user_id}|${first.rows[0].ticket_id}`, `${U1}|${T1}`);
const second = await claim('hash-once');
rec('⭐ 두 번째 교환은 0행(1회용)', second.rows.length, 0);

// --- (4) 만료 ---
await put('hash-old', { minutes: -1 }); // 이미 지난 표
const expired = await claim('hash-old');
rec('⭐ 만료된 표는 교환 불가', expired.rows.length, 0);
// 만료 표는 소비 표시도 안 남아야 한다(교환 자체가 일어나지 않았으므로).
const oldRow = (await db.query(`select redeemed_at from seb_handoff where nonce_hash='hash-old'`)).rows[0];
rec('만료 표에 소비 흔적 없음', oldRow.redeemed_at, null);

// --- (5) 없는 표 ---
rec('없는 표는 0행', (await claim('hash-nope')).rows.length, 0);

// --- (6) 응시권이 사라지면 표도 사라진다 ---
// 표가 죽은 응시권을 가리킨 채 남아 있으면, 교환은 되는데 응시는 못 하는 상태가 된다.
await put('hash-cascade');
await db.query(`delete from exam_tickets where id=$1`, [T1]);
const left = (await db.query(`select count(*)::int n from seb_handoff where nonce_hash='hash-cascade'`)).rows[0];
rec('응시권 삭제 시 표도 삭제(cascade)', left.n, 0);

// --- 출력 ---
let passed = 0;
for (const r of results) {
  if (r.pass) passed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name} (got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)})`);
}
console.log(`\nT-SEB-HANDOFF: ${passed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-seb-handoff', pg: 'pglite/postgres-18', total: results.length, passed, failed: results.length - passed }));
if (passed !== results.length) process.exit(1);
