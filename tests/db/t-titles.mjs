// T-Titles — 칭호(자격증 배지) 파생·선택을 pglite(WASM Postgres 18)에서 검증.
//   certificates 테이블 없음 = exam_attempts 합격에서만 파생. 구매·뽑기로는 못 얻는다.
//
//  마이그레이션을 **프로덕션과 같은 순서로** 얹고 실제 함수를 호출한다:
//    20260714000800(최초) → 20260807130000(급수 제거) → 20260904200000(사용자 선택)
//    → 20260904210000(exam_tiers 정리: sort 드롭 · 발급비 컬럼 개명)
//
//  검증:
//   1) 안 골랐으면 [0] = **가장 최근에 합격한 급수**(옛 규칙인 exam_tiers.sort 최상위가 아니다)
//   2) hub_equip_title 로 고르면 [0] 이 그것으로 바뀌고, 입고 있던 스킨(equipped 의 다른 키)은 안 지워진다
//   3) 안 딴 급수는 못 고른다(not_earned) — 화면 잠금이 아니라 여기가 방어선
//   4) 불합격·제출 전은 칭호가 안 된다
//   5) 합격 판정은 **응시 시점 합격선**(pass_ratio_snapshot). 스냅샷이 비면 0.6
//   6) ⭐ 경계 100문항 × 0.55 = 55점 합격 — JS 쪽 passMark 와 **같은 답**이어야 한다
//      (Math.ceil(100*0.55) 은 56 이 나온다. 그 오차를 그대로 두면 SQL 은 합격, 화면은 불합격이 된다)
//   7) 고른 급수의 합격 기록이 사라지면 조용히 최근 합격으로 되돌아온다
//   8) exam_tiers 에 sort·cert_available_after_days 가 없고 cert_fee_usd_cents 가 있다
//   9) 쓰기 경로 없음 + 클라(anon/authenticated) 실행권 없음
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { passMark } from '../../src/lib/testConfig.ts';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- Supabase 롤 모형(revoke/grant 대상) ----
await raw(`create role anon; create role authenticated; create role service_role;`);

// ---- 함수가 참조하는 최소 테이블(auth.users FK 미부여) ----
//   exam_tiers 는 **프로덕션과 같은 모양**으로 만든다 — 20260904210000 이 이 컬럼들을 지우고 바꾼다.
await raw(`
  create table exams (
    id uuid primary key default gen_random_uuid(),
    title text not null,
    tier text
  );
  create table exam_tiers (
    tier text primary key,
    track text not null,
    sort int not null default 0,
    pass_ratio numeric(4,3),
    cert_available_after_days int,
    cert_fee_override int
  );
  create table exam_attempts (
    id uuid primary key default gen_random_uuid(),
    exam_id uuid references exams(id),
    user_id uuid not null,
    status text not null default 'in_progress',
    total_questions int,
    total_correct int,
    pass_ratio_snapshot numeric(4,3),
    submitted_at timestamptz
  );
  create table user_characters (
    user_id uuid primary key,
    base_key text not null default 'default',
    equipped jsonb not null default '{}'::jsonb,
    updated_at timestamptz default now()
  );
  insert into exam_tiers (tier, track, sort) values
    ('beginner','t1',10), ('pro','t1',20), ('elite','t1',30),
    ('master','t2',40), ('grandmaster','t2',50), ('zenith','t2',60);
`);

// ---- 마이그레이션 (프로덕션과 같은 순서) ----
for (const f of [
  'supabase/migrations/20260714000800_titles.sql',
  'supabase/migrations/20260807130000_titles_drop_grade.sql',
  'supabase/migrations/20260904200000_title_choice.sql',
  'supabase/migrations/20260904210000_exam_tiers_cleanup.sql',
]) await raw(readFileSync(f, 'utf8'));

// ---- 시드 ----
const uid  = '00000000-0000-0000-0000-000000000001'; // beginner(먼저) + elite(나중) 합격
const uid2 = '00000000-0000-0000-0000-000000000002'; // 불합격 0.55 만
const uid3 = '00000000-0000-0000-0000-000000000003'; // 제출 전 in_progress 0.99
const uid4 = '00000000-0000-0000-0000-000000000004'; // 스냅샷 합격선 검증용
const uid5 = '00000000-0000-0000-0000-000000000005'; // ⭐ 경계(100 × 0.55)

const examBeg   = (await q(`insert into exams (title, tier) values ('CARIS Beginner', 'beginner') returning id`)).rows[0].id;
const examElite = (await q(`insert into exams (title, tier) values ('CARIS Elite', 'elite') returning id`)).rows[0].id;
const examPro   = (await q(`insert into exams (title, tier) values ('CARIS Pro', 'pro') returning id`)).rows[0].id;

const put = (examId, userId, status, tq, tc, snap, at) =>
  q(`insert into exam_attempts (exam_id, user_id, status, total_questions, total_correct, pass_ratio_snapshot, submitted_at)
     values ($1,$2,$3,$4,$5,$6,$7)`, [examId, userId, status, tq, tc, snap, at]);

// uid: beginner 는 3월에, elite 는 8월에 합격 → 최근 합격 = elite
await put(examBeg,   uid, 'submitted', 100, 85, null, '2026-03-01T00:00:00Z');
await put(examElite, uid, 'submitted', 100, 70, null, '2026-08-01T00:00:00Z');
// uid2: 0.55(<0.6) → 불합격
await put(examPro,  uid2, 'submitted', 100, 55, null, '2026-08-01T00:00:00Z');
// uid3: 제출 전
await put(examPro,  uid3, 'in_progress', 100, 99, null, null);
// uid4: 응시 시점 합격선 0.8 이 박힌 응시에서 0.70 → 불합격(지금 급수 설정과 무관해야 한다)
await put(examPro,  uid4, 'submitted', 100, 70, 0.8, '2026-08-01T00:00:00Z');
// uid5: ⭐ 합격선 0.55 · 100문항 · 55점 = 딱 경계
await put(examPro,  uid5, 'submitted', 100, 55, 0.55, '2026-08-01T00:00:00Z');

// ============================================================
// 1) 안 골랐으면 [0] = 가장 최근 합격
// ============================================================
const t1 = (await q(`select public.user_titles($1) as r`, [uid])).rows[0].r;
eq('1a 합격한 급수 2개', (t1 || []).map((x) => x.tier), ['elite', 'beginner']);
eq('1b [0] = 최근 합격(elite)', t1[0].tier, 'elite');
eq('1c exam_title 도 같이 온다', t1[0].exam_title, 'CARIS Elite');

// ============================================================
// 2) 고르면 [0] 이 바뀐다 — 입고 있던 스킨은 그대로
// ============================================================
await q(`insert into user_characters (user_id, equipped) values ($1, '{"skin":"skin_palace"}'::jsonb)`, [uid]);
await q(`select public.hub_equip_title($1,'beginner')`, [uid]);
const t2 = (await q(`select public.user_titles($1) as r`, [uid])).rows[0].r;
eq('2a 고른 급수가 [0]', t2[0].tier, 'beginner');
eq('2b 나머지는 그대로 남는다', (t2 || []).map((x) => x.tier), ['beginner', 'elite']);
const eqp = (await q(`select equipped from user_characters where user_id = $1`, [uid])).rows[0].equipped;
eq('2c 스킨이 안 지워졌다', eqp, { skin: 'skin_palace', title: 'beginner' });
// 다시 elite 로 되돌리기
await q(`select public.hub_equip_title($1,'elite')`, [uid]);
eq('2d 다시 바꿀 수 있다', (await q(`select public.user_titles($1) as r`, [uid])).rows[0].r[0].tier, 'elite');

// ============================================================
// 3) 안 딴 급수는 못 고른다
// ============================================================
let denied = '';
try { await q(`select public.hub_equip_title($1,'zenith')`, [uid]); } catch (e) { denied = String(e.message || e); }
ok('3a 안 딴 급수 = not_earned', denied.includes('not_earned'), denied);
let empty = '';
try { await q(`select public.hub_equip_title($1,'')`, [uid]); } catch (e) { empty = String(e.message || e); }
ok('3b 빈 값 = invalid_title', empty.includes('invalid_title'), empty);
// 거절돼도 달고 있던 칭호는 안 바뀐다
eq('3c 거절 후에도 칭호 유지', (await q(`select public.user_titles($1) as r`, [uid])).rows[0].r[0].tier, 'elite');

// ============================================================
// 4) 불합격·제출 전은 칭호가 아니다
// ============================================================
eq('4a 불합격만 있는 사람 = []', (await q(`select public.user_titles($1) as r`, [uid2])).rows[0].r, []);
eq('4b 제출 전 0.99 = []', (await q(`select public.user_titles($1) as r`, [uid3])).rows[0].r, []);

// ============================================================
// 5) 판정은 응시 시점 합격선
// ============================================================
eq('5a 스냅샷 0.8 · 70점 = 불합격', (await q(`select public.user_titles($1) as r`, [uid4])).rows[0].r, []);
// 지금 급수 설정을 낮춰도 과거 판정은 안 흔들린다
await q(`update exam_tiers set pass_ratio = 0.5 where tier = 'pro'`);
eq('5b 급수 합격선을 내려도 과거 판정 불변', (await q(`select public.user_titles($1) as r`, [uid4])).rows[0].r, []);

// ============================================================
// 6) ⭐ 경계 — SQL 과 JS(passMark)가 같은 답을 내야 한다
// ============================================================
const t6 = (await q(`select public.user_titles($1) as r`, [uid5])).rows[0].r;
eq('6a SQL: 100문항 · 합격선 0.55 · 55점 = 합격', (t6 || []).map((x) => x.tier), ['pro']);
eq('6b JS passMark(100, 0.55) = 55 (naive Math.ceil 은 56)', passMark(100, 0.55), 55);
eq('6c JS passMark(10, 0.6) = 6', passMark(10, 0.6), 6);
// 엣지 함수 쪽 사본이 같은 식인지 — 한쪽만 고치면 화면과 서버가 다른 판정을 낸다
const edgeSrc = readFileSync('supabase/functions/_shared/exam-tickets.ts', 'utf8');
const frontSrc = readFileSync('src/lib/testConfig.ts', 'utf8');
const ROUND = 'Math.ceil(Math.round(totalQuestions * ratio * 1e6) / 1e6)';
ok('6d 엣지 passMark 가 같은 식', edgeSrc.includes(ROUND), edgeSrc.includes(ROUND));
ok('6e 프론트 passMark 가 같은 식', frontSrc.includes(ROUND), frontSrc.includes(ROUND));

// ============================================================
// 7) 고른 급수가 사라지면 최근 합격으로 되돌아온다
// ============================================================
await q(`delete from exam_attempts where user_id = $1 and exam_id = $2`, [uid, examElite]);
const t7 = (await q(`select public.user_titles($1) as r`, [uid])).rows[0].r;
eq('7a 고른 급수가 없어지면 남은 것으로', (t7 || []).map((x) => x.tier), ['beginner']);
eq('7b equipped 는 그대로 남는다(다시 따면 되살아난다)',
   (await q(`select equipped ->> 'title' as t from user_characters where user_id = $1`, [uid])).rows[0].t, 'elite');

// ============================================================
// 8) exam_tiers 정리 결과
// ============================================================
const cols = (await q(`select column_name from information_schema.columns
                       where table_schema='public' and table_name='exam_tiers' order by 1`)).rows.map((r) => r.column_name);
eq('8a sort 드롭', cols.includes('sort'), false);
eq('8b cert_available_after_days 드롭', cols.includes('cert_available_after_days'), false);
eq('8c cert_fee_usd_cents 로 개명', cols.includes('cert_fee_usd_cents') && !cols.includes('cert_fee_override'), true);
eq('8d pass_ratio 는 남는다', cols.includes('pass_ratio'), true);

// ============================================================
// 9) 쓰기 경로 없음 + 클라 실행권 없음
// ============================================================
const meta = (await q(`select proname, prosecdef, provolatile
                       from pg_proc where proname in ('user_titles','has_title','user_earned_tiers','hub_equip_title')
                       order by proname`)).rows;
const m = (n) => meta.find((x) => x.proname === n);
ok('9a user_titles SECURITY DEFINER', m('user_titles')?.prosecdef === true, m('user_titles')?.prosecdef);
ok('9b user_titles STABLE(부작용 없음)', m('user_titles')?.provolatile === 's', m('user_titles')?.provolatile);
ok('9c user_earned_tiers STABLE', m('user_earned_tiers')?.provolatile === 's', m('user_earned_tiers')?.provolatile);
ok('9d has_title STABLE', m('has_title')?.provolatile === 's', m('has_title')?.provolatile);
ok('9e hub_equip_title 은 VOLATILE(쓰는 함수)', m('hub_equip_title')?.provolatile === 'v', m('hub_equip_title')?.provolatile);

const noStore = (await q(`select count(*)::int n from information_schema.tables
                          where table_schema='public'
                            and table_name in ('certificates','titles','user_titles','user_titles_store')`)).rows[0].n;
eq('9f 칭호 저장 테이블 없음(파생만)', noStore, 0);

for (const fn of ['public.user_titles(uuid)', 'public.user_earned_tiers(uuid)', 'public.hub_equip_title(uuid,text)']) {
  const r = (await q(`select has_function_privilege('authenticated',$1,'execute') as a,
                             has_function_privilege('anon',$1,'execute')          as n,
                             has_function_privilege('service_role',$1,'execute')  as s`, [fn])).rows[0];
  eq(`9g ${fn} — 클라 차단 / 서버만`, [r.a, r.n, r.s], [false, false, true]);
}

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-TITLES: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-titles', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
