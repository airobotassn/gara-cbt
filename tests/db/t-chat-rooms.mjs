// T-Chat-Rooms — 마이그레이션 20260723120000_chat_board.sql → 20260804170000_chat_rooms.sql 을
// 순서대로 pglite 에 적용해 채팅 방(room) 도입분을 검증한다.
//  · room 컬럼 default 'global' (방 도입 전 행이 전세계 방으로 남는지)
//  · 커서 인덱스가 (room, id) 로 교체되고 옛 (id) 인덱스는 사라졌는지
//  · chat_post_atomic 이 9인자 단일 시그니처로 남았는지(옛 8인자 오버로드가 안 남아야 호출이 모호하지 않다)
//  · RPC 가 room 을 그대로 저장하고, 빈 값이면 'global' 로 접는지
//  · ⚠️ 레이트리밋이 방 단위가 아니라 전역인지 — 방을 옮겨도 최소간격 가드에 걸려야 한다
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const base = readFileSync('supabase/migrations/20260723120000_chat_board.sql', 'utf8');
const raw = readFileSync('supabase/migrations/20260804170000_chat_rooms.sql', 'utf8');

// pglite 에 없는 role 대상 revoke/grant 문 제거 (원본 텍스트는 아래 정규식 검증에서 따로 본다)
const strip = (sql) =>
  sql
    .replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '')
    .replace(/^revoke execute[^\n]*;\s*$/gm, '')
    .replace(/^grant execute[^\n]*;\s*$/gm, '');

const db = await PGlite.create();
await db.exec(strip(base));
// 방 도입 전에 쌓여 있던 글 — 마이그레이션 후 'global' 로 남아야 한다.
const legacy = (await db.query(
  `insert into chat_messages (user_id, body, is_anon) values ($1, 'legacy', false) returning id`,
  ['00000000-0000-0000-0000-0000000000aa'],
)).rows[0];
await db.exec(strip(raw));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

// --- (1) room 컬럼 + 기존 행 백필 ---
const col = (await db.query(
  `select data_type, is_nullable, column_default from information_schema.columns
   where table_schema='public' and table_name='chat_messages' and column_name='room'`,
)).rows[0];
rec('chat_messages.room exists (text, not null)', col ? `${col.data_type}/${col.is_nullable}` : null, 'text/NO');
rec("chat_messages.room default is 'global'", /'global'/.test(col?.column_default ?? ''), true);

const legacyRoom = (await db.query(`select room from chat_messages where id=$1`, [legacy.id])).rows[0].room;
rec('방 도입 전 행은 global 로 남는다', legacyRoom, 'global');

// --- (2) 커서 인덱스 교체 ---
const idx = (await db.query(
  `select indexname, indexdef from pg_indexes where tablename='chat_messages'`,
)).rows;
const names = idx.map((r) => r.indexname);
rec('chat_messages_room_cursor_idx 존재', names.includes('chat_messages_room_cursor_idx'), true);
rec('옛 chat_messages_cursor_idx 는 드롭됨', names.includes('chat_messages_cursor_idx'), false);
const cursorDef = idx.find((r) => r.indexname === 'chat_messages_room_cursor_idx')?.indexdef ?? '';
rec('커서 인덱스가 (room, id) 부분 인덱스', /\(room, id\)/.test(cursorDef) && /deleted_at IS NULL/i.test(cursorDef), true);

// --- (3) chat_post_atomic 시그니처 — 9인자 하나만 남아야 한다 ---
const protos = (await db.query(
  `select pg_get_function_identity_arguments(oid) args from pg_proc where proname='chat_post_atomic'`,
)).rows.map((r) => r.args);
rec('chat_post_atomic 오버로드 없이 1개', protos.length, 1);
rec('chat_post_atomic 마지막 인자가 p_room', /p_room text\s*$/.test(protos[0] ?? ''), true);

const callRpc = (user, ip, body, hash, modStatus, isAnon, name, lang, room) =>
  db.query(
    `select * from chat_post_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [user, ip, body, hash, modStatus, isAnon, name, lang, room],
  );

// --- (4) room 저장 + 빈 값은 global 로 접힘 ---
const u1 = '00000000-0000-0000-0000-000000000001';
const u2 = '00000000-0000-0000-0000-000000000002';
const r1 = await callRpc(u1, 'ip-1', 'hello KR', 'h-1', 'ok', false, 'nick', 'ko', 'KR');
const stored = (await db.query(`select room from chat_messages where id=$1`, [r1.rows[0].id])).rows[0].room;
rec('RPC 가 room 을 그대로 저장', stored, 'KR');

const r2 = await callRpc(u2, 'ip-2', 'hello nowhere', 'h-2', 'ok', false, 'nick', 'ko', '');
const stored2 = (await db.query(`select room from chat_messages where id=$1`, [r2.rows[0].id])).rows[0].room;
rec("빈 room 은 global 로 접힘", stored2, 'global');

const r3 = await callRpc('00000000-0000-0000-0000-000000000003', 'ip-3', 'null room', 'h-3', 'ok', false, 'nick', 'ko', null);
const stored3 = (await db.query(`select room from chat_messages where id=$1`, [r3.rows[0].id])).rows[0].room;
rec('null room 은 global 로 접힘', stored3, 'global');

// --- (5) RED-TEAM: 레이트리밋은 방을 넘어 전역 ---
// 방금 KR 방에 쓴 u1 이 곧바로 전세계 방에 쓰면, 방이 달라도 최소간격(3초)에 걸려야 한다.
let crossRoomErr = null;
try {
  await callRpc(u1, 'ip-1', 'now in global', 'h-1b', 'ok', false, 'nick', 'ko', 'global');
} catch (e) { crossRoomErr = e.message || ''; }
rec('방을 바꿔도 최소간격 가드는 그대로(too_fast)', crossRoomErr != null && crossRoomErr.includes('too_fast'), true);

// 중복 가드도 방과 무관해야 한다 — 같은 본문 해시를 다른 방에 다시 던지면 duplicate.
const u4 = '00000000-0000-0000-0000-000000000004';
await db.query(
  `insert into chat_messages (user_id, ip_hash, body, is_anon, content_hash, room, created_at, updated_at)
   values ($1, 'ip-4', 'past msg', false, 'dup-hash', 'KR', now() - interval '30 seconds', now() - interval '30 seconds')`,
  [u4],
);
let dupErr = null;
try {
  await callRpc(u4, 'ip-4', 'dup body', 'dup-hash', 'ok', false, 'nick', 'ko', 'global');
} catch (e) { dupErr = e.message || ''; }
rec('중복 가드도 방과 무관(duplicate)', dupErr != null && dupErr.includes('duplicate'), true);

// --- (6) 원본 마이그레이션 텍스트 정규식 검증 (security definer / search_path / revoke / grant) ---
rec('migration has security definer', /security definer/.test(raw), true);
rec('migration has set search_path = public', /set search_path = public/.test(raw), true);
rec(
  'migration revokes 9-arg signature from public, anon, authenticated',
  /revoke execute on function public\.chat_post_atomic\(uuid,text,text,text,text,boolean,text,text,text\) from public, anon, authenticated/.test(raw),
  true,
);
rec(
  'migration grants 9-arg signature to service_role',
  /grant execute on function public\.chat_post_atomic\(uuid,text,text,text,text,boolean,text,text,text\) to service_role/.test(raw),
  true,
);
rec('migration drops the old 8-arg function', /drop function if exists public\.chat_post_atomic\(uuid,text,text,text,text,boolean,text,text\)/.test(raw), true);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-CHAT-ROOMS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-chat-rooms', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
