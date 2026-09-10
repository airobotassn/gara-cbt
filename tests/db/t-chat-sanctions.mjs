// T-CHAT-SANCTIONS — 채팅 제재 사다리(chat_sanctions · apply/status/revoke)를 pglite 로 검증.
//   pglite 는 auth 스키마·역할(anon/authenticated)이 없다 → auth.users FK 와 revoke 문을 strip.
//
// 지키는 것:
//  ⭐1) 사다리가 **1 · 3 · 7 · 30 · 90 · 영구** 순서 그대로다. 값이 바뀌면 여기서 걸린다.
//  ⭐2) 6차부터 영구 — `days` 가 null 이고 `until` 이 9999년(검사를 `until > now()` 한 줄로 통일하는 근거).
//  ⭐3) 90일 무위반이면 한 칸 내려간다. 사다리만 있고 감면이 없으면 1년 전 위반 두 번 때문에
//       오늘 바로 30일을 먹는다 — 그걸 막는 장치라 실제로 도는지 봐야 한다.
//  ⭐4) 제재를 걸면 `profiles.suspended_until` 이 같이 갱신된다. 이 칸이 실제 차단의 근거이므로
//       기록만 남고 이게 안 바뀌면 **정지를 걸어도 아무것도 안 막힌다**(옛 구조의 그 구멍).
//  ⭐5) 사다리 숫자가 응답에 실려 온다(`nextDays`). 화면이 "다음 위반 시 N일" 을 보여줘야 하는데
//       프론트에 표를 복사해두면 sync pair 가 생긴다 — 서버가 계산해 주는 게 계약이다.
//  ⭐6) 취소(revoke)는 **차수까지 되돌린다**. 오판 정정이 유일한 용도라 기록이 남으면 안 된다.
//   7) 사유 화이트리스트 · 상태 조회(만료/영구/미정지).
//   8) 정적 가드 — 본문(메시지 원문) 컬럼이 없다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = 'supabase/migrations/20260910120000_chat_sanctions.sql';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- 함수가 참조하는 최소 테이블 ----
await raw(`
  create table profiles (
    id uuid primary key,
    display_name text,
    suspended_until timestamptz,
    suspended_reason text
  );
  create table chat_messages (
    id bigserial primary key,
    user_id uuid,
    body text
  );
`);

// ---- 마이그레이션 적용(auth FK·revoke strip) ----
let ddl = readFileSync(MIG, 'utf8');
ddl = ddl.replace(/\s+references auth\.users\(id\)(\s+on delete (cascade|set null))?/g, '');
ddl = ddl.replace(/^\s*(revoke|grant)\b[\s\S]*?;\s*$/gim, '');
await raw(ddl);

const U1 = '00000000-0000-0000-0000-000000000001'; // 사다리를 끝까지 타는 사람
const U2 = '00000000-0000-0000-0000-000000000002'; // 90일 감면 검증
const U3 = '00000000-0000-0000-0000-000000000003'; // 취소 검증
await q(`insert into profiles (id, display_name) values ($1,'A'), ($2,'B'), ($3,'C')`, [U1, U2, U3]);
const msg = (await q(`insert into chat_messages (user_id, body) values ($1,'x') returning id`, [U1])).rows[0].id;

const apply = async (uid, mid = null, reason = 'abuse') =>
  (await q(`select public.chat_sanction_apply($1,$2,$3,null,null) as r`, [uid, mid, reason])).rows[0].r;

// ============================================================
// 1) ⭐사다리 1·3·7·30·90·영구
// ============================================================
const ladder = [];
for (let i = 0; i < 6; i++) ladder.push((await apply(U1, i === 0 ? msg : null)).days);
eq('1a ⭐사다리 = 1·3·7·30·90·영구(null)', ladder, [1, 3, 7, 30, 90, null]);
eq('1b 차수도 1..6 으로 오른다',
  (await q(`select nth from chat_sanctions where user_id=$1 order by created_at`, [U1])).rows.map((r) => r.nth),
  [1, 2, 3, 4, 5, 6]);

// ============================================================
// 2) ⭐6차 = 영구. until 이 9999년이라 `until > now()` 한 줄로 막힌다.
// ============================================================
const st1 = (await q(`select public.chat_sanction_status($1) as r`, [U1])).rows[0].r;
ok('2a ⭐영구 플래그', st1.permanent === true, st1.permanent);
ok('2b ⭐until 이 9999년', new Date(st1.until).getUTCFullYear() === 9999, st1.until);
ok('2c 영구는 다음 단계가 없다(nextDays null)', st1.nextDays == null, st1.nextDays);
eq('2d 7차도 영구다(사다리 끝은 흡수)', (await apply(U1)).days, null);

// ============================================================
// 3) ⭐profiles 갱신 — 실제 차단의 근거
// ============================================================
const p1 = (await q(`select suspended_until, suspended_reason from profiles where id=$1`, [U1])).rows[0];
ok('3a ⭐suspended_until 이 미래다', new Date(p1.suspended_until).getTime() > Date.now(), p1.suspended_until);
eq('3b 사유가 코드로 박힌다', p1.suspended_reason, 'abuse');

// ============================================================
// 4) ⭐90일 감면 — 마지막 제재로부터 90일마다 한 칸
// ============================================================
await apply(U2); await apply(U2); await apply(U2);           // 3차까지 쌓고
eq('4a 감면 전 유효차수 3', (await q(`select public.chat_sanction_nth($1) n`, [U2])).rows[0].n, 3);
// 마지막 제재를 100일 전으로 밀면 한 칸 내려간다.
await q(`update chat_sanctions set created_at = now() - interval '100 days' where user_id=$1`, [U2]);
eq('4b ⭐90일 지나면 한 칸 내려간다', (await q(`select public.chat_sanction_nth($1) n`, [U2])).rows[0].n, 2);
eq('4c ⭐그래서 다음 제재는 4차가 아니라 3차(7일)', (await apply(U2)).days, 7);
// 200일이면 두 칸(3건 − 2 = 1)
await q(`update chat_sanctions set created_at = now() - interval '200 days' where user_id=$1`, [U2]);
eq('4d ⭐감면은 90일마다 누적된다', (await q(`select public.chat_sanction_nth($1) n`, [U2])).rows[0].n, 2);
// 제재가 하나도 없으면 0 — 첫 제재가 1차가 되는 근거
eq('4e 제재 이력이 없으면 0', (await q(`select public.chat_sanction_nth($1) n`, [U3])).rows[0].n, 0);

// ============================================================
// 5) ⭐응답이 다음 단계를 실어 준다(프론트에 사다리를 복사하지 않기 위한 계약)
// ============================================================
const first = await apply(U3);
eq('5a 1차는 1일', first.days, 1);
eq('5b ⭐다음 단계(3일)를 같이 준다', first.nextDays, 3);
const st3 = (await q(`select public.chat_sanction_status($1) as r`, [U3])).rows[0].r;
eq('5c 상태 조회도 같은 값을 준다', [st3.nth, st3.nextDays], [1, 3]);
eq('5d 사유도 같이 온다', st3.reason, 'abuse');

// ============================================================
// 6) ⭐취소는 차수까지 되돌린다
// ============================================================
await apply(U3);                                              // 2차
eq('6a 취소 전 2건', Number((await q(`select count(*) c from chat_sanctions where user_id=$1`, [U3])).rows[0].c), 2);
await q(`select public.chat_sanction_revoke($1)`, [U3]);
eq('6b ⭐기록이 줄어든다', Number((await q(`select count(*) c from chat_sanctions where user_id=$1`, [U3])).rows[0].c), 1);
eq('6c ⭐정지가 풀린다', (await q(`select suspended_until from profiles where id=$1`, [U3])).rows[0].suspended_until, null);
eq('6d ⭐차수도 되돌아간다(다음 제재가 2차 = 3일)', (await apply(U3)).days, 3);

// ============================================================
// 7) 사유 화이트리스트 · 상태 조회
// ============================================================
let bad = '';
try { await apply(U3, null, '아무거나'); } catch (e) { bad = String(e.message || e); }
ok('7a 목록 밖 사유는 거절', bad.includes('bad_reason'), bad);
eq('7b 정지가 아니면 suspended:false',
  (await q(`select public.chat_sanction_status($1) as r`, ['00000000-0000-0000-0000-0000000000ff'])).rows[0].r,
  { suspended: false });
// 만료된 정지는 정지가 아니다 — 기간이 지나면 별도 해제 없이 자동으로 풀려야 한다.
await q(`update profiles set suspended_until = now() - interval '1 day' where id=$1`, [U3]);
eq('7c 기간이 지나면 자동으로 풀린다',
  (await q(`select public.chat_sanction_status($1) as r`, [U3])).rows[0].r, { suspended: false });

// ============================================================
// 8) 정적 가드 — 본문을 담지 않는다
// ============================================================
// ⚠️ 완전삭제(chatPurge)의 존재 이유가 "그 본문이 어딘가 남아 있는 것 자체가 문제" 다.
//    여기에 스냅샷 칸이 생기면 지운 게 지운 게 아니게 되고 개인정보 파기 요청에도 걸린다.
const cols = (await q(`select column_name from information_schema.columns where table_name='chat_sanctions'`))
  .rows.map((r) => r.column_name);
ok('8a ⭐본문 스냅샷 컬럼 없음', !cols.some((c) => /body|text|excerpt|content|snapshot/.test(c)), cols);
ok('8b 사유·차수·시각은 있다', ['reason', 'nth', 'created_at'].every((c) => cols.includes(c)), cols);
// 글이 물리 삭제돼도 제재 사실은 남아야 한다(옛 구조의 구멍이 이거였다).
await q(`delete from chat_messages where id=$1`, [msg]);
eq('8c ⭐글을 지워도 제재 기록은 남는다',
  Number((await q(`select count(*) c from chat_sanctions where user_id=$1`, [U1])).rows[0].c), 7);
eq('8d 지워진 글 참조는 null 이 된다',
  Number((await q(`select count(*) c from chat_sanctions where user_id=$1 and message_id is null`, [U1])).rows[0].c), 7);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-CHAT-SANCTIONS: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-chat-sanctions', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
