// T-LEVELTEST-NUDGE — 레벨테스트 독려 대상 RPC(leveltest_nudge_candidates · 20260918130000)를 pglite 로 검증.
//   pglite 는 auth 스키마·역할이 없다 → 표는 최소 형태로 만들고 revoke/grant 를 strip.
//
// 지키는 것:
//  ⭐1) "마지막 응시" 기준이다 — 옛 응시가 오래됐어도 최근에 다시 봤으면 후보가 아니다.
//  ⭐2) 게스트(익명)·탈퇴 신청자는 빠진다 — 메일을 받을 계정이 아니다.
//  ⭐3) 제출 안 한 응시(in_progress·voided)는 '마지막 응시' 로 안 센다.
//   4) 한 번도 응시 안 한 회원은 후보가 아니다.
//   5) 레벨은 user_progress.rank, 없으면 1.
//   6) 템플릿 기본값이 site_settings 에 들어가고 치환자 셋({name}·{level}·{link})이 본문에 있다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));

await raw(`
  create table site_settings (key text primary key, value text not null default '');
  create table profiles (id uuid primary key, display_name text, is_anonymous boolean default false, deactivated_at timestamptz);
  create table user_progress (user_id uuid primary key, rank int not null default 1);
  create table test_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text not null, submitted_at timestamptz);
`);
// 두 장을 순서대로 — 뒤엣것(20260921120000)이 반환 칸(응시 횟수)을 늘려 함수를 다시 만든다.
for (const m of ['supabase/migrations/20260918130000_leveltest_nudge.sql', 'supabase/migrations/20260921120000_leveltest_people.sql']) {
  let ddl = readFileSync(m, 'utf8');
  ddl = ddl.replace(/^\s*(revoke|grant)\b[\s\S]*?;\s*$/gim, '');
  await raw(ddl);
}

const U = (n) => `00000000-0000-0000-0000-0000000000${n}`;
const uOld = U('a1'), uRecent = U('a2'), uGuest = U('a3'), uOut = U('a4'), uNever = U('a5'), uNoProg = U('a6'), uHalf = U('a7');
await q(`insert into profiles (id, display_name, is_anonymous, deactivated_at) values
  ($1,'오래됨',false,null), ($2,'최근',false,null), ($3,'게스트',true,null), ($4,'탈퇴',false,now()),
  ($5,'무응시',false,null), ($6,'진척없음',false,null), ($7,'미제출',false,null)`,
  [uOld, uRecent, uGuest, uOut, uNever, uNoProg, uHalf]);
await q(`insert into user_progress (user_id, rank) values ($1,3), ($2,2), ($3,1), ($4,5), ($5,1), ($6,2)`, [uOld, uRecent, uGuest, uOut, uNever, uHalf]);
await q(`insert into test_attempts (user_id, status, submitted_at) values
  ($1,'submitted', now() - interval '30 days'),
  ($2,'submitted', now() - interval '30 days'), ($2,'submitted', now() - interval '2 days'),
  ($3,'submitted', now() - interval '30 days'),
  ($4,'submitted', now() - interval '30 days'),
  ($5,'submitted', now() - interval '10 days'),
  ($6,'submitted', now() - interval '30 days'), ($6,'in_progress', null), ($6,'voided', now() - interval '1 day')`,
  [uOld, uRecent, uGuest, uOut, uNoProg, uHalf]);

const ids = async (days) => (await q(`select user_id, rank, days_since, attempts from leveltest_nudge_candidates($1) order by user_id`, [days])).rows;

const r7 = await ids(7);
eq('1 최근에 다시 본 사람은 빠진다', r7.some((r) => r.user_id === uRecent), false);
eq('1b 30일 전 응시자는 후보', r7.some((r) => r.user_id === uOld), true);
eq('2 게스트 제외', r7.some((r) => r.user_id === uGuest), false);
eq('2b 탈퇴 신청자 제외', r7.some((r) => r.user_id === uOut), false);
eq('3 미제출·무효 응시는 마지막 응시로 안 센다(30일 전 제출이 기준)', r7.some((r) => r.user_id === uHalf), true);
eq('4 무응시자는 후보가 아니다', r7.some((r) => r.user_id === uNever), false);
eq('5 user_progress 없으면 레벨 1', r7.find((r) => r.user_id === uNoProg)?.rank, 1);
eq('5b 레벨은 user_progress.rank', r7.find((r) => r.user_id === uOld)?.rank, 3);
eq('5c 경과일 계산', r7.find((r) => r.user_id === uOld)?.days_since, 30);
eq('5d 응시 횟수 = 제출한 것만(미제출·무효 제외)', r7.find((r) => r.user_id === uHalf)?.attempts, 1);
eq('5e 응시 횟수 — 두 번 본 사람', (await ids(0)).find((r) => r.user_id === uRecent)?.attempts, 2);
eq('7 N=20 이면 10일 전 응시자는 빠진다', (await ids(20)).some((r) => r.user_id === uNoProg), false);
eq('7b N=0 이면 제출자 전부(최근 포함)', (await ids(0)).some((r) => r.user_id === uRecent), true);

const tpl = (await q(`select key, value from site_settings where key like 'mail_leveltest_%' order by key`)).rows;
eq('6 템플릿 두 줄', tpl.map((t) => t.key), ['mail_leveltest_body', 'mail_leveltest_subject']);
const body = tpl.find((t) => t.key === 'mail_leveltest_body').value;
eq('6b 치환자 셋이 본문에 있다', ['{name}', '{level}', '{link}'].every((v) => body.includes(v)), true);

const fails = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  got=${r.got} want=${r.want}`}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) process.exit(1);
