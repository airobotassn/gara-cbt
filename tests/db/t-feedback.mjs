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
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const raw = readFileSync('supabase/migrations/20260825120000_feedback.sql', 'utf8');

const db = await PGlite.create();
// auth.users 는 GoTrue 소유라 마이그레이션에 없다 — FK 가 걸리는 최소 형태만 세운다.
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create role anon;
  create role authenticated;
`);
await db.exec(raw);

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

const post = (args) => db.query(
  `select feedback_post($1,$2,$3,$4,$5,$6) as id`,
  [args.user ?? null, args.ip ?? null, args.org ?? '협회', args.name ?? '홍길동', args.path ?? '마이페이지', args.body ?? '내용'],
);
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
  const canAnon = (await db.query(
    `select has_function_privilege('anon', 'public.feedback_post(uuid,text,text,text,text,text)', 'execute') as ok`)).rows[0];
  const canAuth = (await db.query(
    `select has_function_privilege('authenticated', 'public.feedback_post(uuid,text,text,text,text,text)', 'execute') as ok`)).rows[0];
  rec('anon 실행권한 없음', canAnon.ok, false);
  rec('authenticated 실행권한 없음', canAuth.ok, false);
}

// --- (7) 재실행 안전 (마이그레이션을 두 번 얹어도 죽지 않는다) ---
{
  let ok = true;
  try { await db.exec(raw); } catch { ok = false; }
  rec('마이그레이션 재실행 안전', ok, true);
  rec('재실행해도 데이터 보존', (await count()) > 0, true);
}

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${JSON.stringify(x.got)} want=${JSON.stringify(x.want)})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-FEEDBACK: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-feedback', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
