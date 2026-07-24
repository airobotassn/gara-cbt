// T-Chat-Board — 마이그레이션 20260723110000_chat_board.sql 을 pglite 에 적용해
// 유사채팅 게시판(chat_messages/chat_reports/chat_incidents)의 스키마, 인덱스, RLS(정책 없음),
// chat_post_atomic RPC 의 rate-limit/dup/ip-floor 가드를 검증한다.
//  · auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거.
//  · pglite 에는 anon/authenticated/service_role 롤이 없으므로 revoke/grant 문을 제거하고 로드한다
//    (해당 revoke/grant + security definer + search_path 는 원본 마이그레이션 텍스트에 대해 정규식으로 별도 검증).
//  · 진짜 동시성 직렬화(advisory lock)는 단일 프로세스 pglite 로는 증명 불가 — 락 존재/가드 로직만
//    검증하고, 실전 동시 요청 직렬화는 배포 환경에서만 검증 가능(deploy-gated).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260723120000_chat_board.sql', 'utf8');

// auth.users FK 제거 (이 마이그레이션엔 없지만 안전을 위해 유지)
let ddl = raw.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
// pglite 에 없는 role 대상 revoke/grant 문 제거
ddl = ddl.replace(/^revoke execute[^\n]*;\s*$/gm, '');
ddl = ddl.replace(/^grant execute[^\n]*;\s*$/gm, '');

const db = await PGlite.create();
await db.exec(ddl);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const u1 = '00000000-0000-0000-0000-000000000001';
const u2 = '00000000-0000-0000-0000-000000000002';

// --- (1) 테이블 존재 ---
const tableNames = (await db.query(
  `select table_name from information_schema.tables where table_schema='public' and table_name in ('chat_messages','chat_reports','chat_incidents')`,
)).rows.map((r) => r.table_name).sort();
rec('chat_messages/chat_reports/chat_incidents exist', tableNames.join(','), 'chat_incidents,chat_messages,chat_reports');

// --- (2) chat_messages 인덱스 4종 ---
const idxNames = (await db.query(
  `select indexname from pg_indexes where tablename='chat_messages' and indexname in ('chat_messages_cursor_idx','chat_messages_dup_idx','chat_messages_iprate_idx','chat_messages_rate_idx')`,
)).rows.map((r) => r.indexname).sort();
const wantIdx = ['chat_messages_cursor_idx', 'chat_messages_dup_idx', 'chat_messages_iprate_idx', 'chat_messages_rate_idx'];
rec('chat_messages has 4 expected indexes', idxNames.join(','), wantIdx.join(','));

// --- (3) chat_reports_once_idx unique(message_id, reporter_id) ---
// 먼저 메시지 하나 직접 삽입해 참조용 message_id 확보
const seedMsg = (await db.query(
  `insert into chat_messages (user_id, body, is_anon) values ($1, 'seed', false) returning id`,
  [u1],
)).rows[0];
await db.query(
  `insert into chat_reports (message_id, reporter_id, reason) values ($1, $2, 'spam')`,
  [seedMsg.id, u2],
);
let reportDup = null;
try {
  await db.query(
    `insert into chat_reports (message_id, reporter_id, reason) values ($1, $2, 'spam again')`,
    [seedMsg.id, u2],
  );
} catch (e) { reportDup = e.code || 'error'; }
rec('chat_reports_once_idx rejects dup (message_id,reporter_id)', reportDup, '23505');

// --- (4) RPC 존재 + 단일 호출 시 정확히 1행 삽입, id/created_at/updated_at 반환 ---
const rpcExists = (await db.query(
  `select count(*)::int n from pg_proc where proname='chat_post_atomic'`,
)).rows[0].n;
rec('chat_post_atomic function exists', rpcExists, 1);

const beforeCount = (await db.query(`select count(*)::int n from chat_messages`)).rows[0].n;
const callRpc = (user, ip, body, hash, modStatus, isAnon, name, lang) =>
  db.query(
    `select * from chat_post_atomic($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user, ip, body, hash, modStatus, isAnon, name, lang],
  );

const u3 = '00000000-0000-0000-0000-000000000003';
const r1 = await callRpc(u3, 'iphash-1', 'hello', 'hash-1', 'ok', false, 'nick', 'ko');
const afterCount = (await db.query(`select count(*)::int n from chat_messages`)).rows[0].n;
rec('chat_post_atomic inserts exactly 1 row', afterCount - beforeCount, 1);
const row1 = r1.rows[0];
rec('chat_post_atomic returns id/created_at/updated_at', Boolean(row1 && row1.id != null && row1.created_at && row1.updated_at), true);

// --- (5) 즉시 재호출(동일 유저) → 'too_fast' ---
let tooFastMsg = null;
try {
  await callRpc(u3, 'iphash-1', 'again', 'hash-2', 'ok', false, 'nick', 'ko');
} catch (e) { tooFastMsg = e.message || ''; }
rec('immediate second call raises too_fast', tooFastMsg != null && tooFastMsg.includes('too_fast'), true);

// --- (6) 중복 content_hash 가드 ---
// min-interval 을 우회하기 위해 과거 created_at 으로 직접 행을 심어 duplicate 분기를 결정적으로 검증한다.
const u4 = '00000000-0000-0000-0000-000000000004';
await db.query(
  `insert into chat_messages (user_id, ip_hash, body, is_anon, content_hash, created_at, updated_at)
   values ($1, 'iphash-4', 'past msg', false, 'dup-hash', now() - interval '30 seconds', now() - interval '30 seconds')`,
  [u4],
);
let dupMsg = null;
try {
  await callRpc(u4, 'iphash-4', 'dup body', 'dup-hash', 'ok', false, 'nick', 'ko');
} catch (e) { dupMsg = e.message || ''; }
rec('duplicate content_hash within 60s raises duplicate', dupMsg != null && dupMsg.includes('duplicate'), true);


// --- (9) RED-TEAM: window-cap 경계값 ---
// v_window_cap-1(=9) 행을 min-interval(3s) 밖 & 60s 창 안으로 직접 시드 → 실호출(10번째)은 성공해야
// 하고, 그 다음(11번째) 호출은 rate_limited 여야 한다. 10번째 실호출 직후에는 방금 삽입된 행의
// created_at 을 SQL UPDATE 로 min-interval 밖(그러나 60s 창 안)으로 백데이트해, 실제 대기 없이도
// too_fast 가 아니라 rate_limited 분기만 결정적으로 트리거되도록 한다(타이밍 가정: 백데이트 폭 10s > 3s).
const u5 = '00000000-0000-0000-0000-000000000005';
for (let i = 0; i < 9; i++) {
  const secondsAgo = 55 - i * 5; // 55,50,...,15 (모두 >3s 간격, 60s 창 이내)
  await db.query(
    `insert into chat_messages (user_id, ip_hash, body, is_anon, content_hash, created_at, updated_at)
     values ($1, 'iphash-5', $2, false, $3, now() - make_interval(secs => $4::int), now() - make_interval(secs => $4::int))`,
    [u5, `seed-${i}`, `seed-hash-${i}`, secondsAgo],
  );
}
const windowBefore = (await db.query(
  `select count(*)::int n from chat_messages where user_id=$1 and created_at > now() - interval '60 seconds'`,
  [u5],
)).rows[0].n;
rec('window-cap seed: exactly cap-1 (9) rows present before call', windowBefore, 9);

let tenthErr = null;
try {
  await callRpc(u5, 'iphash-5', 'the 10th post', 'tenth-hash', 'ok', false, 'nick', 'ko');
} catch (e) { tenthErr = e.message || 'error'; }
rec('window-cap: 10th call (cap-1 seeded + 1) succeeds', tenthErr, null);

await db.query(
  `update chat_messages set created_at = now() - interval '10 seconds', updated_at = now() - interval '10 seconds'
   where user_id=$1 and content_hash='tenth-hash'`,
  [u5],
);

let eleventhErr = null;
try {
  await callRpc(u5, 'iphash-5', 'the 11th post', 'eleventh-hash', 'ok', false, 'nick', 'ko');
} catch (e) { eleventhErr = e.message || ''; }
rec('window-cap: 11th call raises rate_limited', eleventhErr != null && eleventhErr.includes('rate_limited'), true);

// --- (10) RED-TEAM: ip_floor 경계값 (로테이팅 익명 IP 시뮬레이션 — 서로 다른 user_id, 동일 ip_hash) ---
const ipFloorHash = 'iphash-ipfloor';
for (let i = 0; i < 31; i++) {
  const uid = `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
  await db.query(
    `insert into chat_messages (user_id, ip_hash, body, is_anon, content_hash, created_at, updated_at)
     values ($1, $2, $3, false, $4, now() - make_interval(secs => $5::int), now() - make_interval(secs => $5::int))`,
    [uid, ipFloorHash, `ipfloor-seed-${i}`, `ipfloor-hash-${i}`, i % 30],
  );
}
const ipCountBefore = (await db.query(
  `select count(*)::int n from chat_messages where ip_hash=$1 and created_at > now() - interval '60 seconds'`,
  [ipFloorHash],
)).rows[0].n;
rec('ip_floor seed: >30 (31) rows present for shared ip_hash across distinct user_ids', ipCountBefore, 31);

const ipFloorFreshUser = '00000000-0000-0000-0000-000000000007';
let ipFloorErr = null;
try {
  await callRpc(ipFloorFreshUser, ipFloorHash, 'fresh user shares rotated ip', 'fresh-ip-hash', 'ok', false, 'nick', 'ko');
} catch (e) { ipFloorErr = e.message || ''; }
rec('ip_floor: fresh user sharing saturated ip_hash raises ip_floor', ipFloorErr != null && ipFloorErr.includes('ip_floor'), true);

// --- (11) RED-TEAM: 익명(anon) 분기 — min_interval=5s, window_cap=5 ---
// (rate/window/dup 가드 블록은 p_user 가 not null 일 때만 실행되므로, "로그인 사용자가 anon 으로 글쓴" 케이스를 검증한다.)
const u6 = '00000000-0000-0000-0000-000000000006';
for (let i = 0; i < 3; i++) {
  const secondsAgo = 50 - i * 10; // 50,40,30 (모두 >5s 간격, 60s 창 이내)
  await db.query(
    `insert into chat_messages (user_id, ip_hash, body, is_anon, content_hash, created_at, updated_at)
     values ($1, 'iphash-6', $2, true, $3, now() - make_interval(secs => $4::int), now() - make_interval(secs => $4::int))`,
    [u6, `anon-seed-${i}`, `anon-hash-${i}`, secondsAgo],
  );
}
let fourthAnonErr = null;
try {
  await callRpc(u6, 'iphash-6', 'the 4th anon post', 'anon-fourth-hash', 'ok', true, null, 'ko');
} catch (e) { fourthAnonErr = e.message || 'error'; }
rec('anon: 4th anon post within window (cap=5) succeeds', fourthAnonErr, null);

await db.query(
  `update chat_messages set created_at = now() - interval '15 seconds', updated_at = now() - interval '15 seconds'
   where user_id=$1 and content_hash='anon-fourth-hash'`,
  [u6],
);
await db.query(
  `insert into chat_messages (user_id, ip_hash, body, is_anon, content_hash, created_at, updated_at)
   values ($1, 'iphash-6', 'anon-seed-5th', true, 'anon-fifth-hash', now() - interval '8 seconds', now() - interval '8 seconds')`,
  [u6],
);
let sixthAnonErr = null;
try {
  await callRpc(u6, 'iphash-6', 'the 6th anon post', 'anon-sixth-hash', 'ok', true, null, 'ko');
} catch (e) { sixthAnonErr = e.message || ''; }
rec('anon: 6th anon post (cap=5) raises rate_limited', sixthAnonErr != null && sixthAnonErr.includes('rate_limited'), true);

// --- (12) RED-TEAM: p_ip_hash = null 경로는 ip_floor 를 트리거하지 않음(바닥선 면제) ---
const u8 = '00000000-0000-0000-0000-000000000008';
let nullIpErr = null;
try {
  await callRpc(u8, null, 'no ip hash provided', 'ok', 'ok', false, 'nick', 'ko');
} catch (e) { nullIpErr = e.message || ''; }
rec('null p_ip_hash path does not raise ip_floor', nullIpErr === null || !nullIpErr.includes('ip_floor'), true);

// --- (7) chat_* 테이블에 클라 정책 없음 ---
for (const t of ['chat_messages', 'chat_reports', 'chat_incidents']) {
  const n = (await db.query(`select count(*)::int n from pg_policies where tablename=$1`, [t])).rows[0].n;
  rec(`${t} has 0 client policies`, n, 0);
}

// --- (8) 원본 마이그레이션 텍스트 정규식 검증 (security definer / search_path / revoke / grant) ---
rec('migration has security definer', /security definer/.test(raw), true);
rec('migration has set search_path = public', /set search_path = public/.test(raw), true);
rec(
  'migration has revoke execute ... from public, anon, authenticated',
  /revoke execute on function public\.chat_post_atomic\([^)]*\) from public, anon, authenticated/.test(raw),
  true,
);
rec(
  'migration has grant execute ... to service_role',
  /grant execute on function public\.chat_post_atomic\([^)]*\) to service_role/.test(raw),
  true,
);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-CHAT-BOARD: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-chat-board', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
