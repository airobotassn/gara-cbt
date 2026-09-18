// T-MAIL-RECIPIENTS — 독려 메일 사람별 발송 이력(mail_recipients · 20260918120000)을 pglite 로 검증.
//   pglite 는 auth 스키마가 없다 → auth.users FK 를 strip. mail_log 는 옛 마이그레이션(20260811150000)에서
//   그 표 정의만 잘라 온다(나머지는 reward_policy·exam_tiers 등 다른 표를 건드려 여기 무관).
//
// 지키는 것:
//  ⭐1) 기본 status 는 'logged'(기록만) — 발송 서비스가 없는 동안 '보냈다' 로 적히면 안 된다.
//  ⭐2) status 는 logged·sent·failed 셋뿐 — 다른 값은 표가 거절한다.
//  ⭐3) 묶음(mail_log)이 지워지면 사람별 줄도 같이 사라진다(cascade) — 고아 줄이 안 남는다.
//   4) "이 사람에게 보낸 것을 최근 것부터" 조회가 되는 인덱스가 있다.
//   5) mail_log 에 본문(body) 칸이 생겼고 기본값이 빈 문자열이다(옛 행이 깨지지 않는다).
//   6) RLS 가 켜져 있다(정책 0개 = service role 전용).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- mail_log 만 옛 마이그레이션에서 잘라 온다 ----
await raw(`create table public.exam_rounds (id uuid primary key);`);
const old = readFileSync('supabase/migrations/20260811150000_admin_reform_2.sql', 'utf8');
const m = old.match(/create table if not exists public\.mail_log[\s\S]*?;\s*create index[^;]*;/);
if (!m) throw new Error('mail_log 정의를 옛 마이그레이션에서 못 찾음');
await raw(m[0].replace(/\s+references auth\.users\(id\)(\s+on delete set null)?/g, ''));

for (const m of ['supabase/migrations/20260918120000_mail_recipients.sql', 'supabase/migrations/20260918160000_mail_send_lang.sql']) {
  let ddl = readFileSync(m, 'utf8');
  ddl = ddl.replace(/\s+references auth\.users\(id\)(\s+on delete (set null|cascade))?/g, '');
  await raw(ddl);
}

const u1 = '00000000-0000-0000-0000-0000000000a1';
const u2 = '00000000-0000-0000-0000-0000000000a2';

// ---- 1) 기본값 = logged ----
const { rows: [log1] } = await q(`insert into mail_log (kind, recipients, subject, body) values ('nudge_env_check', 2, '제목', '본문') returning id`);
await q(`insert into mail_recipients (mail_id, user_id, email) values ($1, $2, 'a@x.com'), ($1, $3, 'b@x.com')`, [log1.id, u1, u2]);
eq('1 기본 status = logged', (await q(`select status from mail_recipients where user_id=$1`, [u1])).rows[0].status, 'logged');
eq('1b sent_at 은 비어 있다', (await q(`select sent_at from mail_recipients where user_id=$1`, [u1])).rows[0].sent_at, null);

// ---- 2) status CHECK ----
let rejected = false;
try { await q(`insert into mail_recipients (mail_id, user_id, email, status) values ($1, $2, 'c@x.com', 'queued')`, [log1.id, u1]); }
catch { rejected = true; }
ok('2 status 에 다른 값은 거절', rejected);
await q(`update mail_recipients set status='sent', sent_at=now() where user_id=$1`, [u1]);
eq('2b sent 로 바꿀 수 있다', (await q(`select status from mail_recipients where user_id=$1`, [u1])).rows[0].status, 'sent');

// ---- 3) cascade ----
const { rows: [log2] } = await q(`insert into mail_log (kind, recipients, subject) values ('nudge_env_check', 1, '두번째') returning id`);
await q(`insert into mail_recipients (mail_id, user_id, email) values ($1, $2, 'a@x.com')`, [log2.id, u1]);
eq('3a 두 묶음 · 세 줄', Number((await q(`select count(*) c from mail_recipients`)).rows[0].c), 3);
await q(`delete from mail_log where id=$1`, [log2.id]);
eq('3b 묶음을 지우면 그 사람별 줄도 사라진다', Number((await q(`select count(*) c from mail_recipients`)).rows[0].c), 2);

// ---- 4) 인덱스 ----
const idx = (await q(`select indexname from pg_indexes where tablename='mail_recipients'`)).rows.map((r) => r.indexname);
ok('4 user_id 인덱스', idx.includes('mail_recipients_user_idx'), idx);

// ---- 5) mail_log.body ----
const { rows: [log3] } = await q(`insert into mail_log (kind, recipients, subject) values ('x', 0, 's') returning body`);
eq('5 body 기본값은 빈 문자열', log3.body, '');

// ---- 7) 언어 칸(20260918160000) ----
await q(`update mail_recipients set lang='ja' where user_id=$1`, [u1]);
eq('7 받은 언어가 남는다', (await q(`select lang from mail_recipients where user_id=$1`, [u1])).rows[0].lang, 'ja');
let badLang = false;
try { await q(`update mail_recipients set lang='fr' where user_id=$1`, [u1]); } catch { badLang = true; }
ok('7b 사전에 없는 언어는 거절', badLang);

// ---- 6) RLS ----
eq('6 RLS 켜짐', (await q(`select relrowsecurity from pg_class where relname='mail_recipients'`)).rows[0].relrowsecurity, true);
eq('6b 정책 0개', Number((await q(`select count(*) c from pg_policies where tablename='mail_recipients'`)).rows[0].c), 0);

// ---- 결과 ----
const fails = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  got=${r.got} want=${r.want}`}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) process.exit(1);
