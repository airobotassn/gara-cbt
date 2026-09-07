// T-Chat-No-Anon — 익명 채팅 폐지(20260907140000 → 20260907150000)를 검증한다.
//
// 이 변경에서 조용히 깨지면 제일 비싼 것들만 본다.
//  · ⭐ 2단계 중간 상태에서 **두 시그니처가 공존**하는가 — 여기가 무중단의 전부다.
//    step1 적용 직후에도 옛 9인자가 살아 있어야 아직 도는 옛 chat-post 의 쓰기가 안 죽는다.
//    (인자 개수가 달라 모호하지 않다. 기본값으로 인자만 줄이면 `function is not unique` 로 통째로 죽는다.)
//  · ⭐ step2 뒤에는 **정확히 1개(8인자)** 만 남는가 — 옛 것이 남으면 다음 사람이 어느 쪽이 진짜인지 못 고른다.
//  · ⭐ 함수를 먼저 지우고 칸을 지우는가 — 순서가 반대면 의존성으로 드롭이 막힌다.
//  · 새 함수가 실제로 삽입되고 room 을 접는지(옛 계약 유지)
//  · 레이트리밋이 상수(3초 / 60초 10건)로 굳었는지 — 익명 5초/5건 쪽이 사라졌다
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const base = readFileSync('supabase/migrations/20260723120000_chat_board.sql', 'utf8');
const rooms = readFileSync('supabase/migrations/20260804170000_chat_rooms.sql', 'utf8');
const step1 = readFileSync('supabase/migrations/20260907140000_chat_drop_anon_step1.sql', 'utf8');
const step2 = readFileSync('supabase/migrations/20260907150000_chat_drop_anon_step2.sql', 'utf8');

// pglite 에 없는 role 대상 revoke/grant 문 제거 (원본 텍스트는 아래 정규식 검증에서 따로 본다)
const strip = (sql) =>
  sql
    .replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '')
    .replace(/^revoke\s+execute[^\n]*;\s*$/gm, '')
    .replace(/^grant\s+execute[^\n]*;\s*$/gm, '');

const db = await PGlite.create();
await db.exec(strip(base));
await db.exec(strip(rooms));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const protos = async () =>
  (await db.query(
    `select pg_get_function_identity_arguments(oid) args from pg_proc where proname='chat_post_atomic' order by 1`,
  )).rows.map((r) => r.args);

// --- (1) 출발점: 옛 9인자 하나 ---
rec('출발점: chat_post_atomic 9인자 하나', (await protos()).length, 1);
rec('출발점: is_anon 칸이 있다', (await db.query(
  `select count(*)::int n from information_schema.columns where table_name='chat_messages' and column_name='is_anon'`,
)).rows[0].n, 1);

// --- (2) ⭐ step1 뒤: 두 시그니처 공존 (무중단의 핵심) ---
await db.exec(strip(step1));
const mid = await protos();
rec('⭐step1: 두 시그니처가 공존한다(옛 배포본이 계속 쓴다)', mid.length, 2);
rec('⭐step1: 옛 9인자가 아직 살아 있다', mid.some((a) => /p_is_anon/.test(a)), true);
rec('⭐step1: 새 8인자에 p_is_anon 이 없다', mid.some((a) => !/p_is_anon/.test(a) && /p_room text\s*$/.test(a)), true);
rec('step1 은 아무것도 안 지운다(is_anon 칸 유지)', (await db.query(
  `select count(*)::int n from information_schema.columns where table_name='chat_messages' and column_name='is_anon'`,
)).rows[0].n, 1);

// 중간 상태에서도 **양쪽 다** 불린다 — 이게 성립해야 배포 순서가 자유롭다.
const uOld = '00000000-0000-0000-0000-0000000000c1';
const uNew = '00000000-0000-0000-0000-0000000000c2';
const okOld = await db
  .query(`select * from chat_post_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [uOld, 'ip-o', 'old path', 'h-o', 'ok', false, 'nick', 'ko', 'KR'])
  .then((r) => r.rows.length === 1)
  .catch(() => false);
rec('⭐step1: 옛 9인자 호출이 여전히 성공한다', okOld, true);
const okNew = await db
  .query(`select * from chat_post_atomic($1,$2,$3,$4,$5,$6,$7,$8)`, [uNew, 'ip-n', 'new path', 'h-n', 'ok', 'nick', 'ko', 'KR'])
  .then((r) => r.rows.length === 1)
  .catch(() => false);
rec('⭐step1: 새 8인자 호출이 성공한다', okNew, true);

// --- (3) ⭐ step2 뒤: 8인자 하나 + 칸 제거 ---
await db.exec(strip(step2));
const fin = await protos();
rec('⭐step2: chat_post_atomic 이 정확히 1개', fin.length, 1);
rec('⭐step2: 남은 것이 8인자(p_is_anon 없음)', /p_is_anon/.test(fin[0] ?? ''), false);
rec('step2: 마지막 인자는 여전히 p_room', /p_room text\s*$/.test(fin[0] ?? ''), true);
rec('⭐step2: is_anon 칸이 사라졌다', (await db.query(
  `select count(*)::int n from information_schema.columns where table_name='chat_messages' and column_name='is_anon'`,
)).rows[0].n, 0);
rec('step2: 옛 행은 그대로 남는다(칸만 빠진다)', (await db.query(
  `select count(*)::int n from chat_messages where body in ('old path','new path')`,
)).rows[0].n, 2);

// --- (4) 새 함수의 계약: 삽입 · room 접기 ---
const uA = '00000000-0000-0000-0000-0000000000d1';
const call = (user, ip, body, hash, name, lang, room) =>
  db.query(`select * from chat_post_atomic($1,$2,$3,$4,$5,$6,$7,$8)`, [user, ip, body, hash, 'ok', name, lang, room]);

const r1 = await call(uA, 'ip-a', 'hello KR', 'h-a', 'nick', 'ko', 'KR');
rec('새 함수: 1행 삽입 + id/created_at/updated_at 반환',
  Boolean(r1.rows[0] && r1.rows[0].id != null && r1.rows[0].created_at && r1.rows[0].updated_at), true);
rec('새 함수: room 을 그대로 저장', (await db.query(
  `select room from chat_messages where id = $1`, [r1.rows[0].id],
)).rows[0].room, 'KR');

const uB = '00000000-0000-0000-0000-0000000000d2';
const r2 = await call(uB, 'ip-b', 'hello global', 'h-b', 'nick', 'ko', '');
rec("새 함수: 빈 room 은 'global' 로 접힌다", (await db.query(
  `select room from chat_messages where id = $1`, [r2.rows[0].id],
)).rows[0].room, 'global');

// --- (5) 레이트리밋이 상수로 굳었는지 ---
// 최소간격 3초 — 바로 다시 쓰면 too_fast.
const tooFast = await call(uB, 'ip-b', 'again', 'h-b2', 'nick', 'ko', 'global').then(() => false).catch((e) => /too_fast/.test(String(e.message)));
rec('최소간격 가드(3초)가 산다', tooFast, true);

// 60초 창 상한 10 — 옛 익명 값(5)이 아니라 10 이어야 한다.
const uC = '00000000-0000-0000-0000-0000000000d3';
for (let i = 0; i < 9; i++) {
  await db.query(
    `insert into chat_messages (user_id, ip_hash, body, content_hash, created_at, updated_at)
     values ($1, $2, $3, $4, now() - interval '10 seconds', now() - interval '10 seconds')`,
    [uC, 'ip-c', `seed ${i}`, `hc-${i}`],
  );
}
const tenth = await call(uC, 'ip-c', 'tenth', 'hc-10', 'nick', 'ko', 'global').then(() => true).catch(() => false);
rec('창 상한: 10번째는 통과한다(옛 익명 상한 5가 아니다)', tenth, true);
const eleventh = await db
  .query(`select * from chat_post_atomic($1,$2,$3,$4,$5,$6,$7,$8)`, [uC, 'ip-c', '11th', 'hc-11', 'ok', 'nick', 'ko', 'global'])
  .then(() => false)
  .catch((e) => /rate_limited|too_fast/.test(String(e.message)));
rec('창 상한: 11번째는 막힌다', eleventh, true);

// --- (6) 원본 마이그레이션 텍스트 검증 (pglite 로는 못 보는 것) ---
rec('step1: service_role 에만 execute 를 준다',
  /grant\s+execute on function public\.chat_post_atomic\(uuid,text,text,text,text,text,text,text\) to service_role/.test(step1), true);
rec('step1: public/anon/authenticated 에서 revoke',
  /revoke execute on function public\.chat_post_atomic\(uuid,text,text,text,text,text,text,text\) from public, anon, authenticated/.test(step1), true);
rec('step1: security definer + search_path 유지',
  /security definer set search_path = public/.test(step1), true);
rec('⭐step2: 함수 드롭이 칸 드롭보다 먼저다',
  step2.indexOf('drop function') < step2.indexOf('drop column'), true);

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name} (got=${r.got} want=${r.want})`);
const passed = results.filter((r) => r.pass).length;
console.log(`\nT-CHAT-NO-ANON: ${passed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-chat-no-anon', pg: 'pglite/postgres-18', total: results.length, passed, failed: results.length - passed }));
if (passed !== results.length) process.exit(1);
