// T-Feedback — 마이그레이션 20260825120000_feedback.sql 을 pglite 에 적용해 **의견함의 방어선**을 본다.
//
// 이 기능은 **비로그인 누구나** 쓰는 유일한 쓰기 경로다. 그래서 여기서 보는 건 화면이 아니라
// "사람이(또는 봇이) 아무렇게나 눌러도 DB 가 막아주나" 다.
//  · 빈 칸·과길이가 들어가지 않는다 (CHECK — 서버 LIMITS 와 한 벌)
//  · ⭐ 같은 내용 재전송이 두 줄로 쌓이지 않는다 (새로고침·더블클릭·재시도)
//  · ⭐ 도배 바닥선이 실제로 막는다 (10분 20건)
//  · ⭐ 회원이 탈퇴해도 의견은 남는다 (on delete set null — cascade 로 두면 지적이 통째로 증발)
//  · RLS 는 켜져 있고 **정책이 하나도 없다** = service role(엣지 함수) 전용
//  · feedback_post 실행권한이 anon·authenticated 에 없다 (있으면 가드를 건너뛴 직접 호출이 가능)
//
// 첨부(20260826120000)도 같이 본다 — 여기가 **비로그인 업로드**라 방어선이 더 중요하다.
//  · ⭐ 남이 올린 경로·없는 경로를 적어 보내도 첨부로 안 붙는다 (발급 원장에서만 만든다)
//  · ⭐ 이름·크기를 클라가 못 정한다 (원장 값이 그대로 들어간다)
//  · ⭐ 첨부까지 같아야 같은 글이다 (파일만 붙여 다시 보낸 것을 멱등으로 삼키면 파일이 증발한다)
//  · ⭐ 더블클릭해도 첨부가 사라지지 않는다 (두 번째 호출이 빈 배열을 저장하면 안 된다)
//  · 발급 바닥선(10분 15건 · 하루 400MB)이 실제로 막는다
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260825120000_feedback.sql', 'utf8');
const raw2 = readFileSync('supabase/migrations/20260826120000_feedback_files.sql', 'utf8');

const db = await PGlite.create();
// auth.users 는 GoTrue 소유라 마이그레이션에 없다 — FK 가 걸리는 최소 형태만 세운다.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create role anon;
  create role authenticated;
`);
await db.exec(raw);
await db.exec(raw2);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const post = (args) => db.query(
  `select feedback_post($1,$2,$3,$4,$5,$6,$7) as id`,
  [args.user ?? null, args.ip ?? null, args.org ?? '협회', args.name ?? '홍길동', args.path ?? '마이페이지', args.body ?? '내용',
   args.files ?? []],
);
/** 서명 URL 발급 자리잡기 — 엣지 함수가 URL 을 굽기 전에 부르는 그 함수다. */
const claim = (ip, path, name, size) => db.query(
  `select feedback_upload_claim($1,$2,$3,$4) as id`, [ip, path, name, size],
);
const filesOf = async (id) => (await db.query(`select files from feedbacks where id=$1`, [id])).rows[0].files;
const count = async () => (await db.query(`select count(*)::int as n from feedbacks`)).rows[0].n;

// --- (1) 정상 접수 ---
{
  const r = await post({ ip: 'ip-a', body: '첫 의견' });
  rec('접수되면 id 를 돌려준다', typeof r.rows[0].id, 'string');
  rec('한 줄 쌓임', await count(), 1);

  const row = (await db.query(`select * from feedbacks limit 1`)).rows[0];
  rec('user_id 는 비워둘 수 있다(비로그인)', row.user_id, null);
  rec('created_at 자동', row.created_at instanceof Date, true);
}

// --- (2) 입력 방어 (CHECK) — 서버 LIMITS 와 같은 값이어야 한다 ---
{
  const bad = async (col, value) => {
    const args = { ip: 'ip-check', org: '협회', name: '홍길동', path: '경로', body: '내용' };
    args[col] = value;
    try { await post(args); return 'accepted'; } catch { return 'rejected'; }
  };
  rec('빈 소속 거절', await bad('org', '   '), 'rejected');
  rec('빈 이름 거절', await bad('name', ''), 'rejected');
  rec('빈 경로 거절', await bad('path', ' '), 'rejected');
  rec('빈 내용 거절', await bad('body', '\n'), 'rejected');
  rec('소속 60자 초과 거절', await bad('org', 'x'.repeat(61)), 'rejected');
  rec('이름 40자 초과 거절', await bad('name', 'x'.repeat(41)), 'rejected');
  rec('경로 200자 초과 거절', await bad('path', 'x'.repeat(201)), 'rejected');
  rec('내용 4000자 초과 거절', await bad('body', 'x'.repeat(4001)), 'rejected');
  rec('경계값(4000자)은 통과', await bad('body', 'x'.repeat(4000)), 'accepted');
  // 앞뒤 공백은 함수가 턴다 — 안 털면 '  홍길동' 과 '홍길동' 이 다른 사람으로 보인다.
  await post({ ip: 'ip-trim', name: '  띄어쓰기  ', body: '트림 확인' });
  const trimmed = (await db.query(`select name from feedbacks where body='트림 확인'`)).rows[0];
  rec('앞뒤 공백은 저장 전에 턴다', trimmed.name, '띄어쓰기');
}

// --- (3) ⭐ 같은 내용 재전송 = 멱등 ---
{
  const before = await count();
  const a = await post({ ip: 'ip-dup', body: '똑같은 의견' });
  const b = await post({ ip: 'ip-dup', body: '똑같은 의견' });
  rec('⭐ 재전송해도 줄이 안 늘어난다', await count(), before + 1);
  rec('⭐ 재전송은 원래 id 를 돌려준다', b.rows[0].id, a.rows[0].id);

  // 다른 사람(다른 IP)이 우연히 같은 문장을 써도 그건 별개 의견이다.
  await post({ ip: 'ip-other', body: '똑같은 의견' });
  rec('IP 가 다르면 같은 문장도 별개', await count(), before + 2);
}

// --- (4) ⭐ 도배 바닥선 (10분 20건) ---
{
  await db.query(`delete from feedbacks where ip_hash = 'ip-flood'`);
  let accepted = 0;
  let blocked = 0;
  for (let i = 0; i < 25; i++) {
    // 내용을 매번 다르게 해야 (3)의 멱등에 흡수되지 않는다 — 여기서 보려는 건 개수 가드다.
    try { await post({ ip: 'ip-flood', body: `도배 ${i}` }); accepted++; } catch { blocked++; }
  }
  rec('⭐ 20건까지만 받는다', accepted, 20);
  rec('⭐ 그 뒤는 막힌다', blocked, 5);

  // 창이 지나면 다시 열린다 — 영구 차단이 아니다(같은 학교·회사 IP 를 영영 막으면 안 된다).
  await db.query(`update feedbacks set created_at = now() - interval '11 minutes' where ip_hash='ip-flood'`);
  let reopened = 'blocked';
  try { await post({ ip: 'ip-flood', body: '창이 지난 뒤' }); reopened = 'accepted'; } catch { /* 막힘 */ }
  rec('10분이 지나면 다시 받는다', reopened, 'accepted');

  // IP 를 못 알아낸 요청(ip_hash null)은 가드를 못 걸지만, 그렇다고 거절하면 정상 사용자가 막힌다.
  let noIp = 'blocked';
  try { await post({ ip: null, body: 'IP 를 모르는 요청' }); noIp = 'accepted'; } catch { /* 막힘 */ }
  rec('IP 를 몰라도 접수는 된다', noIp, 'accepted');
}

// --- (5) ⭐ 탈퇴해도 의견은 남는다 ---
{
  const u = (await db.query(`insert into auth.users default values returning id`)).rows[0].id;
  await post({ user: u, ip: 'ip-user', body: '로그인해서 쓴 의견' });
  const saved = (await db.query(`select user_id from feedbacks where body='로그인해서 쓴 의견'`)).rows[0];
  rec('로그인 상태면 계정이 붙는다', saved.user_id, u);

  await db.query(`delete from auth.users where id = $1`, [u]);
  const after = (await db.query(`select user_id from feedbacks where body='로그인해서 쓴 의견'`)).rows;
  rec('⭐ 탈퇴해도 의견은 안 지워진다', after.length, 1);
  rec('⭐ 계정만 떨어져 나간다(set null)', after[0].user_id, null);
}

// --- (6) 잠금 ---
{
  const rls = (await db.query(`select relrowsecurity from pg_class where relname='feedbacks'`)).rows[0];
  rec('RLS 켜짐', rls?.relrowsecurity, true);
  const pol = (await db.query(`select count(*)::int as n from pg_policies where tablename='feedbacks'`)).rows[0];
  rec('정책 0개 = service role 전용', pol.n, 0);

  // 실행권한이 남아 있으면 사용자 토큰으로 RPC 를 직접 불러 가드를 통과시킬 수 있다.
  const sig = 'public.feedback_post(uuid,text,text,text,text,text,text[])';
  const canAnon = (await db.query(`select has_function_privilege('anon', $1, 'execute') as ok`, [sig])).rows[0];
  const canAuth = (await db.query(`select has_function_privilege('authenticated', $1, 'execute') as ok`, [sig])).rows[0];
  rec('anon 실행권한 없음', canAnon.ok, false);
  rec('authenticated 실행권한 없음', canAuth.ok, false);

  // 옛 6인자 함수가 남아 있으면 7인자 호출이 모호해질 수 있다 — 새 마이그레이션이 지웠는지 본다.
  const overloads = (await db.query(
    `select count(*)::int as n from pg_proc where proname='feedback_post'`)).rows[0];
  rec('feedback_post 는 한 벌뿐(옛 6인자 제거)', overloads.n, 1);

  const upSig = 'public.feedback_upload_claim(text,text,text,bigint)';
  const upAnon = (await db.query(`select has_function_privilege('anon', $1, 'execute') as ok`, [upSig])).rows[0];
  rec('발급 함수도 anon 실행권한 없음', upAnon.ok, false);

  const upRls = (await db.query(`select relrowsecurity from pg_class where relname='feedback_uploads'`)).rows[0];
  rec('발급 원장도 RLS 켜짐', upRls?.relrowsecurity, true);
  const upPol = (await db.query(`select count(*)::int as n from pg_policies where tablename='feedback_uploads'`)).rows[0];
  rec('발급 원장 정책 0개', upPol.n, 0);
}

// --- (8) ⭐ 첨부 ---
{
  // (8a) 정상 — 발급받은 경로가 그대로 붙는다.
  await claim('ip-file', 'u1/보고서.pptx', '보고서.pptx', 2_000_000);
  const a = (await post({ ip: 'ip-file', body: '첨부 있는 의견', files: ['u1/보고서.pptx'] })).rows[0].id;
  const fa = await filesOf(a);
  rec('첨부가 배열로 붙는다', fa.length, 1);
  rec('⭐ 이름은 원장 값이다', fa[0].name, '보고서.pptx');
  rec('⭐ 크기도 원장 값이다', Number(fa[0].size), 2_000_000);
  const bound = (await db.query(`select feedback_id from feedback_uploads where path='u1/보고서.pptx'`)).rows[0];
  rec('올린 파일이 의견에 묶인다(고아 아님)', bound.feedback_id, a);

  // (8b) ⭐ 남의 경로·없는 경로는 조용히 빠진다 — 클라가 보낸 문자열을 그대로 믿지 않는다.
  await claim('ip-other2', 'u2/남의파일.pdf', '남의파일.pdf', 1000);
  const b = (await post({ ip: 'ip-file', body: '남의 것을 적어본 의견', files: ['u2/남의파일.pdf', 'u9/없는파일.pdf'] })).rows[0].id;
  rec('⭐ 남의 경로·없는 경로는 첨부가 안 된다', (await filesOf(b)).length, 0);

  // (8c) ⭐ 더블클릭 — 첨부가 사라지지 않고 같은 id 를 돌려준다.
  await claim('ip-dup2', 'u3/캡처.png', '캡처.png', 500);
  const c1 = (await post({ ip: 'ip-dup2', body: '두 번 눌린 의견', files: ['u3/캡처.png'] })).rows[0].id;
  const c2 = (await post({ ip: 'ip-dup2', body: '두 번 눌린 의견', files: ['u3/캡처.png'] })).rows[0].id;
  rec('⭐ 더블클릭은 같은 id', c2, c1);
  rec('⭐ 더블클릭해도 첨부가 남는다', (await filesOf(c1)).length, 1);

  // (8d) ⭐ 같은 내용에 파일만 붙여 다시 보내면 **새 글**이다(멱등에 삼켜지면 파일이 증발한다).
  const d1 = (await post({ ip: 'ip-add', body: '나중에 파일 붙임' })).rows[0].id;
  await claim('ip-add', 'u4/추가.png', '추가.png', 700);
  const d2 = (await post({ ip: 'ip-add', body: '나중에 파일 붙임', files: ['u4/추가.png'] })).rows[0].id;
  rec('⭐ 파일이 다르면 다른 글이다', d2 === d1, false);
  rec('⭐ 새 글에 파일이 붙는다', (await filesOf(d2)).length, 1);

  // (8e) 4개 이상은 거절 — 화면·서버가 3개로 자르지만 마지막 관문도 막아야 한다.
  for (const n of [1, 2, 3, 4]) await claim('ip-many', `u5/f${n}.png`, `f${n}.png`, 100);
  let over = 'accepted';
  try {
    await post({ ip: 'ip-many', body: '네 개', files: ['u5/f1.png', 'u5/f2.png', 'u5/f3.png', 'u5/f4.png'] });
  } catch { over = 'rejected'; }
  rec('첨부 4개는 거절', over, 'rejected');

  // (8f) 붙인 순서를 지킨다 — created_at 으로 정렬하면 사용자가 3번째로 붙인 게 1번이 된다.
  const o = (await post({ ip: 'ip-many', body: '순서 확인', files: ['u5/f3.png', 'u5/f1.png'] })).rows[0].id;
  rec('붙인 순서대로 저장된다', (await filesOf(o)).map((f) => f.name).join(','), 'f3.png,f1.png');

  // (8g) 첨부 없는 접수는 빈 배열이다(null 이 아니다 — 화면이 length 를 그냥 읽는다).
  const e = (await post({ ip: 'ip-file', body: '첨부 없는 의견' })).rows[0].id;
  rec('첨부 없으면 빈 배열', JSON.stringify(await filesOf(e)), '[]');

  // (8h) 의견을 지우면 발급 원장도 같이 지워진다(cascade).
  await db.query(`delete from feedbacks where id=$1`, [a]);
  const left = (await db.query(`select count(*)::int as n from feedback_uploads where path='u1/보고서.pptx'`)).rows[0];
  rec('의견을 지우면 원장 행도 사라진다', left.n, 0);
}

// --- (9) 발급 바닥선 ---
{
  // 20MB 초과는 CHECK 이 막는다 — 서버 MAX_FILE_BYTES·버킷 file_size_limit 과 한 벌.
  let big = 'accepted';
  try { await claim('ip-lim', 'u6/big.zip', 'big.zip', 20 * 1024 * 1024 + 1); } catch { big = 'rejected'; }
  rec('파일당 20MB 초과 거절', big, 'rejected');

  let zero = 'accepted';
  try { await claim('ip-lim', 'u6/zero.png', 'zero.png', 0); } catch { zero = 'rejected'; }
  rec('0바이트 거절', zero, 'rejected');

  let noIp = 'accepted';
  try { await claim(null, 'u6/noip.png', 'noip.png', 100); } catch { noIp = 'rejected'; }
  rec('IP 를 모르면 발급 안 함', noIp, 'rejected');

  // 건수 바닥선(10분 15건).
  let ok = 0, blocked = 0;
  for (let i = 0; i < 18; i++) {
    try { await claim('ip-rate', `u7/f${i}.png`, `f${i}.png`, 1000); ok++; } catch { blocked++; }
  }
  rec('발급은 10분에 15건까지', ok, 15);
  rec('그 뒤는 막힌다', blocked, 3);

  // 용량 바닥선(하루 400MB) — 건수만 세면 20MB 짜리 15개가 그대로 통과한다.
  // ⚠️ 건수 창(10분)을 한 번 넘겨야 20개를 채울 수 있다. 용량 창은 하루라 그래도 계속 쌓인다.
  const MB20 = 20 * 1024 * 1024;
  for (let i = 0; i < 15; i++) await claim('ip-vol', `u8/v${i}.zip`, `v${i}.zip`, MB20);
  await db.query(`update feedback_uploads set created_at = now() - interval '11 minutes' where ip_hash='ip-vol'`);
  for (let i = 15; i < 20; i++) await claim('ip-vol', `u8/v${i}.zip`, `v${i}.zip`, MB20);
  rec('20건 × 20MB = 400MB 까지는 받는다',
    (await db.query(`select count(*)::int as n from feedback_uploads where ip_hash='ip-vol'`)).rows[0].n, 20);
  let overVol = 'accepted';
  try { await claim('ip-vol', 'u8/over.zip', 'over.zip', 1024); } catch { overVol = 'rejected'; }
  rec('하루 400MB 를 넘기면 막힌다', overVol, 'rejected');
}

// --- (10) 재실행 안전 (마이그레이션을 두 번 얹어도 죽지 않는다) ---
{
  // ⚠️ **순서대로** 다시 얹는다. 옛 파일만 다시 돌리면 6인자 feedback_post 가 되살아나 남는다 —
  //    실제 배포는 순서대로 한 번씩 적용하므로 그 상태가 나오지 않는다.
  let ok = true;
  try { await db.exec(raw); await db.exec(raw2); } catch { ok = false; }
  rec('마이그레이션 재실행 안전', ok, true);
  rec('재실행해도 데이터 보존', (await count()) > 0, true);
  const overloads = (await db.query(`select count(*)::int as n from pg_proc where proname='feedback_post'`)).rows[0];
  rec('재실행해도 함수는 한 벌', overloads.n, 1);
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-FEEDBACK: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-feedback', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
