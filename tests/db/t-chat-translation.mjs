// T-Chat-Translation — 채팅 번역 스키마·RPC 검증(20260813120000_chat_translation.sql).
//
// 이 기능에서 조용히 깨지면 제일 비싼 것들을 본다.
//  · 창고가 (글, 언어) 유일키인가 — 아니면 같은 번역을 두 번 사고 두 번 저장한다
//  · 원문이 지워지면 번역본도 따라 사라지는가(cascade)
//  · RPC 가 **수요가 살아있는 방만** 준다 — 5일 지난 조합을 계속 채우면 아무도 안 보는 방에 일을 시킨다
//  · RPC 가 **이미 번역된 것을 안 준다**(anti-join) — 안 그러면 무한히 같은 글을 번역한다
//  · RPC 가 **원문 언어 == 대상 언어**를 걸러낸다 — 번역할 이유가 없는 글
//  · RPC 가 가림·삭제·짧은 글을 걸러낸다
//  · 최신 글부터 준다 — 밀려도 사람들이 지금 보는 화면이 먼저 채워진다
//  · 두 테이블에 클라이언트 정책이 없다(= service role 전용). 클라가 번역본을 쓰면 원문 모더레이션이 뚫린다
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const base = readFileSync('supabase/migrations/20260723120000_chat_board.sql', 'utf8');
const rooms = readFileSync('supabase/migrations/20260804170000_chat_rooms.sql', 'utf8');
const raw = readFileSync('supabase/migrations/20260813120000_chat_translation.sql', 'utf8');

// pglite 에 없는 role 대상 revoke/grant 문 제거 (원본 텍스트는 아래 정규식 검증에서 따로 본다)
const strip = (sql) =>
  sql
    .replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '')
    .replace(/^revoke execute[^\n]*;\s*$/gm, '')
    .replace(/^grant\s+execute[^\n]*;\s*$/gm, '');

const db = await PGlite.create();
await db.exec(strip(base));
await db.exec(strip(rooms));
await db.exec(strip(raw));

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const U = '00000000-0000-0000-0000-0000000000a1';
const put = async (room, body, opts = {}) => {
  const { mod = 'ok', src = null, deleted = false } = opts;
  const r = await db.query(
    `insert into chat_messages (user_id, room, body, is_anon, mod_status, src_lang, deleted_at)
     values ($1,$2,$3,false,$4,$5,$6) returning id`,
    [U, room, body, mod, src, deleted ? new Date().toISOString() : null],
  );
  return r.rows[0].id;
};
const demand = (room, lang, daysAgo = 0) =>
  db.query(
    `insert into chat_translation_demand(room, lang, last_requested_at)
     values ($1,$2, now() - ($3 || ' days')::interval)
     on conflict (room, lang) do update set last_requested_at = excluded.last_requested_at`,
    [room, lang, String(daysAgo)],
  );
const pending = async (limit = 500) =>
  (await db.query(`select * from chat_translation_pending($1)`, [limit])).rows;

// --- (1) 스키마 ---
const pk = (await db.query(
  `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
   where i.indrelid='chat_translations'::regclass and i.indisprimary order by a.attnum`,
)).rows.map((r) => r.attname);
rec('chat_translations PK = (message_id, lang)', pk.join(','), 'message_id,lang');

const dpk = (await db.query(
  `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
   where i.indrelid='chat_translation_demand'::regclass and i.indisprimary order by a.attnum`,
)).rows.map((r) => r.attname);
rec('chat_translation_demand PK = (room, lang)', dpk.join(','), 'room,lang');

const srcCol = (await db.query(
  `select data_type from information_schema.columns
   where table_schema='public' and table_name='chat_messages' and column_name='src_lang'`,
)).rows[0];
rec('chat_messages.src_lang 존재', srcCol?.data_type, 'text');

// --- (2) 같은 (글, 언어) 두 번 저장 불가 ---
const m1 = await put('CN', '你好朋友们');
await db.query(`insert into chat_translations(message_id, lang, body, engine) values ($1,'ko','안녕','google')`, [m1]);
let dupErr = null;
try {
  await db.query(`insert into chat_translations(message_id, lang, body, engine) values ($1,'ko','안녕2','edge')`, [m1]);
} catch (e) { dupErr = e.message || ''; }
rec('같은 (글, 언어) 중복 저장 거절', dupErr != null, true);
// 워커와 서버가 동시에 쓰는 정상 경로 — 충돌은 조용히 무시되어야 한다.
await db.query(
  `insert into chat_translations(message_id, lang, body, engine) values ($1,'ko','안녕3','edge')
   on conflict (message_id, lang) do nothing`, [m1],
);
const kept = (await db.query(`select body from chat_translations where message_id=$1 and lang='ko'`, [m1])).rows[0];
rec('on conflict do nothing 은 먼저 쓴 값을 지킨다', kept.body, '안녕');

// engine 은 두 값만 — 오타로 들어오면 어느 엔진이 만들었는지 영영 못 센다.
let engErr = null;
try {
  await db.query(`insert into chat_translations(message_id, lang, body, engine) values ($1,'ja','こんにちは','gpt')`, [m1]);
} catch (e) { engErr = e.message || ''; }
rec('engine 은 edge|google 만 허용', engErr != null, true);

// --- (3) 원문이 지워지면 번역본도 사라진다 ---
const m2 = await put('CN', '这是要删除的消息');
await db.query(`insert into chat_translations(message_id, lang, body, engine) values ($1,'ko','지울 것','edge')`, [m2]);
await db.query(`delete from chat_messages where id=$1`, [m2]);
const orphan = (await db.query(`select count(*)::int c from chat_translations where message_id=$1`, [m2])).rows[0].c;
rec('원문 삭제 시 번역본도 cascade 삭제', orphan, 0);

// --- (4) RPC: 수요가 살아있는 방만 ---
await demand('CN', 'ko', 0);
await demand('JP', 'ko', 9); // 9일 전 — 5일 창을 벗어났다
const mCn = await put('CN', '这是还没翻译的消息');
const mJp = await put('JP', 'これは日本語のメッセージです');
let rows = await pending();
rec('수요 살아있는 방(CN)은 나온다', rows.some((r) => r.message_id === mCn), true);
rec('수요 만료된 방(JP, 9일)은 안 나온다', rows.some((r) => r.message_id === mJp), false);

// --- (5) RPC: 이미 번역된 것은 안 준다 ---
rec('이미 ko 번역이 있는 글은 안 나온다', rows.some((r) => r.message_id === m1 && r.dst_lang === 'ko'), false);

// --- (6) RPC: 걸러내는 것들 ---
const mOk = await put('CN', '아직 번역 안 된 정상 메시지');
const mHidden = await put('CN', '가려진 메시지입니다', { mod: 'hidden' });
const mDeleted = await put('CN', '삭제된 메시지입니다', { deleted: true });
const mShort = await put('CN', 'ㅋㅋ');
const mSameLang = await put('CN', '이미 한국어로 쓴 글이다', { src: 'ko' });
const mOtherLang = await put('CN', '这是中文的消息内容', { src: 'zh-Hans' });

rows = await pending();
const ids = rows.map((r) => r.message_id);
rec('번역 안 된 정상 글은 나온다', ids.includes(mOk), true);
rec('가림(hidden) 글은 안 나온다', ids.includes(mHidden), false);
rec('삭제된 글은 안 나온다', ids.includes(mDeleted), false);
rec('2자 이하 글은 안 나온다', ids.includes(mShort), false);
rec('원문 언어 == 대상 언어면 안 나온다', ids.includes(mSameLang), false);
rec('원문 언어가 다르면 나온다', ids.includes(mOtherLang), true);
rec('나온 행에 원문 언어가 실려 있다', rows.find((r) => r.message_id === mOtherLang)?.src_lang, 'zh-Hans');
rec('나온 행에 대상 언어가 실려 있다', rows.find((r) => r.message_id === mOtherLang)?.dst_lang, 'ko');

// --- (7) 한 방에 언어가 둘이면 글마다 두 줄 ---
await demand('CN', 'ja', 0);
rows = await pending();
const forOk = rows.filter((r) => r.message_id === mOk).map((r) => r.dst_lang).sort();
rec('수요 언어 2개면 같은 글이 2줄로 나온다', forOk.join(','), 'ja,ko');

// --- (8) 최신 글부터 ---
rec('최신 글부터 준다(id 내림차순)', rows.map((r) => Number(r.message_id)).every((v, i, a) => i === 0 || a[i - 1] >= v), true);

// --- (9) limit ---
rec('limit 이 걸린다', (await pending(2)).length, 2);
rec('limit 0 이어도 최소 1건은 준다(0 이면 워커가 영원히 논다)', (await pending(0)).length >= 1, true);

// --- (10) 클라이언트 정책 없음 = service role 전용 ---
for (const tbl of ['chat_translations', 'chat_translation_demand']) {
  const rls = (await db.query(`select relrowsecurity from pg_class where relname=$1`, [tbl])).rows[0];
  rec(`${tbl} RLS 켜짐`, rls?.relrowsecurity, true);
  const pol = (await db.query(`select count(*)::int c from pg_policies where tablename=$1`, [tbl])).rows[0].c;
  rec(`${tbl} 클라이언트 정책 0개`, pol, 0);
}

// --- (11) 원본 마이그레이션 텍스트 검증 ---
rec('migration has security definer', /security definer/.test(raw), true);
rec('migration has set search_path = public', /set search_path = public/.test(raw), true);
rec(
  'migration revokes pending RPC from public, anon, authenticated',
  /revoke execute on function public\.chat_translation_pending\(int\) from public, anon, authenticated/.test(raw),
  true,
);
rec(
  'migration grants pending RPC to service_role',
  /grant\s+execute on function public\.chat_translation_pending\(int\) to service_role/.test(raw),
  true,
);

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-CHAT-TRANSLATION: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-chat-translation', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
