// T-Referral-Coin — 친구 초대 보상(코인 50, 양쪽)을 pglite(WASM Postgres 18)에서 검증.
//   대상 = 20260824130000_referral_coin.sql 의 redeem_referral RPC.
//
// 이 스위트가 지키는 것 — 전부 "틀렸을 때 조용히 손해가 나는" 자리다:
//   1) 양쪽 다 받는다. 한쪽만 주면 이 기능이 반만 동작하는데 아무도 오류를 안 본다.
//   2) 귀속과 지급이 **한 트랜잭션**이다 — 실패하면 referred_by 도 안 박힌다.
//      (박히고 지급이 실패하면 1회용이라 그 사람은 영영 코인을 못 받는다)
//   3) 계정당 1회. 두 번째 등록은 거절되고 **코인도 두 번 안 나간다**.
//   4) 초대자 쪽은 상한이 없다 — 여러 명이 코드를 쓰면 그만큼 쌓인다(2026-08-24 지시).
//   5) 없는 코드 · 내 코드는 각각 다른 사유로 거절된다(모달이 이유를 그대로 보여준다).
//   6) 옛 보상(activity_ledger 'referral')은 **더는 쌓이지 않는다**.
//   7) 실행권한은 service_role 만.
//
// ⚠️ auth 스키마가 pglite 에 없으므로 `references auth.users(id) [on delete cascade]` 만 제거(하네스 strip).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ---- Supabase 롤(revoke 대상) ----
await raw(`create role anon; create role authenticated; create role service_role;`);

// ---- user_currency 등 phase2 테이블 ----
const strip = (s) => s.replace(/\s+references auth\.users\(id\)(\s+on delete cascade)?/g, '');
await raw(strip(readFileSync('supabase/migrations/20260714000400_phase2_character.sql', 'utf8')));

// ---- profiles 최소 모형 — redeem_referral 이 만지는 칸만 ----
await raw(`
  create table profiles (
    id uuid primary key,
    display_name text,
    referral_code text unique,
    referred_by uuid
  );
`);

// ---- 검증 대상 ----
await raw(readFileSync('supabase/migrations/20260824130000_referral_coin.sql', 'utf8'));

const A = '00000000-0000-0000-0000-0000000000a1'; // 초대자
const B = '00000000-0000-0000-0000-0000000000b2'; // 코드를 쓰는 사람 (uuid 가 A 보다 큼)
const C = '00000000-0000-0000-0000-0000000000c3'; // 두 번째로 코드를 쓰는 사람
const Z = '00000000-0000-0000-0000-00000000000f'; // uuid 가 A 보다 **작은** 사람 (잠금 순서 반대편)
await q(`insert into profiles (id, display_name, referral_code) values
           ($1,'초대자','CARIAAAA'), ($2,'친구B',null), ($3,'친구C',null), ($4,'친구Z',null)`, [A, B, C, Z]);

const coin = async (uid) =>
  (await q(`select coalesce((select points from user_currency where user_id=$1), 0)::int n`, [uid])).rows[0].n;

// ============================================================
// 1) 정상 등록 — 양쪽 50
// ============================================================
const r1 = (await q(`select redeem_referral($1,'CARIAAAA') as r`, [B])).rows[0].r;
ok('1a ok=true 로 돌아온다', r1.ok === true, r1);
eq('1b 금액을 알려준다', r1.coin, 50);
eq('1c 초대자를 알려준다(성공 문구용)', r1.inviterName, '초대자');
eq('1d ⭐ 코드를 쓴 사람이 50 을 받는다', await coin(B), 50);
eq('1e ⭐ 코드를 공유한 사람도 50 을 받는다', await coin(A), 50);
eq('1f 잔액도 같이 준다', r1.balance, 50);
const linked = (await q(`select referred_by from profiles where id=$1`, [B])).rows[0].referred_by;
eq('1g 귀속이 박힌다', linked, A);

// ============================================================
// 2) 계정당 1회 — 두 번째는 거절, 코인도 두 번 안 나간다
// ============================================================
const r2 = (await q(`select redeem_referral($1,'CARIAAAA') as r`, [B])).rows[0].r;
eq('2a 두 번째 등록은 already', [r2.ok, r2.error], [false, 'already']);
eq('2b ⭐ 코드를 쓴 사람 잔액이 안 늘어난다', await coin(B), 50);
eq('2c ⭐ 초대자 잔액도 안 늘어난다', await coin(A), 50);

// ============================================================
// 3) 초대자는 상한이 없다 — 다른 사람이 쓰면 또 받는다
// ============================================================
const r3 = (await q(`select redeem_referral($1,'CARIAAAA') as r`, [C])).rows[0].r;
ok('3a 두 번째 사람도 등록된다', r3.ok === true, r3);
eq('3b ⭐ 초대자가 또 받는다(상한 없음)', await coin(A), 100);
eq('3c 두 번째 사람도 50', await coin(C), 50);

// uuid 가 초대자보다 **작은** 쪽도 똑같이 동작해야 한다 —
// 지급이 least/greatest 로 순서를 바꿔 들어가므로, 방향이 바뀌어도 금액이 안 갈리는지 본다.
const r4 = (await q(`select redeem_referral($1,'CARIAAAA') as r`, [Z])).rows[0].r;
ok('3d uuid 순서가 반대여도 등록된다', r4.ok === true, r4);
eq('3e ⭐ 잠금 순서가 뒤집혀도 양쪽 금액은 같다', [await coin(Z), await coin(A)], [50, 150]);

// ============================================================
// 4) 거절 사유가 갈린다 — 모달이 이유를 그대로 보여준다
// ============================================================
const D = '00000000-0000-0000-0000-0000000000d4';
await q(`insert into profiles (id, display_name, referral_code) values ($1,'친구D','CARIDDDD')`, [D]);
const rNo = (await q(`select redeem_referral($1,'CARIZZZZ') as r`, [D])).rows[0].r;
eq('4a 없는 코드 → not_found', [rNo.ok, rNo.error], [false, 'not_found']);
const rSelf = (await q(`select redeem_referral($1,'CARIDDDD') as r`, [D])).rows[0].r;
eq('4b 내 코드 → self', [rSelf.ok, rSelf.error], [false, 'self']);
const rEmpty = (await q(`select redeem_referral($1,'') as r`, [D])).rows[0].r;
eq('4c 빈 코드 → not_found', [rEmpty.ok, rEmpty.error], [false, 'not_found']);
// ⛔ 거절은 아무것도 남기면 안 된다 — 귀속도 코인도.
eq('4d ⭐ 거절이면 코인이 안 나간다', await coin(D), 0);
const dLink = (await q(`select referred_by from profiles where id=$1`, [D])).rows[0].referred_by;
eq('4e ⭐ 거절이면 귀속도 안 박힌다', dLink, null);

// ============================================================
// 5) 귀속과 지급은 한 트랜잭션 — 지급이 터지면 귀속도 없다
// ============================================================
// user_currency 쓰기를 일부러 막아 지급을 실패시킨다(체크 제약).
const E = '00000000-0000-0000-0000-0000000000e5';
await q(`insert into profiles (id, display_name) values ($1,'친구E')`, [E]);
await raw(`alter table user_currency add constraint tmp_block check (points < 0) not valid;`);
let threw = null;
try { await q(`select redeem_referral($1,'CARIAAAA') as r`, [E]); } catch (e) { threw = e.message || String(e); }
ok('5a 지급이 실패하면 예외로 터진다(조용히 성공하지 않는다)', threw !== null, threw);
const eLink = (await q(`select referred_by from profiles where id=$1`, [E])).rows[0].referred_by;
eq('5b ⭐ 귀속도 같이 되돌아간다 — 안 그러면 영영 다시 못 받는다', eLink, null);
await raw(`alter table user_currency drop constraint tmp_block;`);
// 막은 것을 풀면 그대로 다시 받을 수 있어야 한다(5b 가 말이 되는지 끝까지 본다).
const r5 = (await q(`select redeem_referral($1,'CARIAAAA') as r`, [E])).rows[0].r;
ok('5c ⭐ 되돌아갔으니 다시 등록된다', r5.ok === true, r5);
eq('5d 다시 받은 금액도 50', await coin(E), 50);

// ============================================================
// 6) 옛 점수 보상은 이 경로에 없다
// ============================================================
const src = readFileSync('supabase/migrations/20260824130000_referral_coin.sql', 'utf8');
// 주석에는 '옛 보상이 activity_ledger 였다'가 적혀 있다 — 실행문만 보고 판단한다.
const srcSql = src.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
ok('6a RPC 가 activity_ledger 를 건드리지 않는다', !srcSql.includes('activity_ledger'), srcSql.includes('activity_ledger'));
const fnSrc = readFileSync('supabase/functions/redeem-referral/index.ts', 'utf8');
ok('6b edge fn 도 activity_ledger 를 안 쓴다', !fnSrc.includes('activity_ledger'), fnSrc.includes('activity_ledger'));
ok('6c edge fn 은 RPC 하나만 부른다(쪼개면 5b 의 보장이 깨진다)',
  fnSrc.includes("rpc('redeem_referral'"), fnSrc.includes("rpc('redeem_referral'"));
// 화면 사본과 DB 금액이 갈리면 안내표가 거짓말을 한다.
const hub = readFileSync('src/pages/Hub.tsx', 'utf8');
const shown = /const REFERRAL_COIN = (\d+)/.exec(hub)?.[1];
const stored = /c_coin constant int := (\d+)/.exec(src)?.[1];
eq('6d ⭐ 화면 사본 = DB 금액', shown, stored);

// ============================================================
// 7) 실행권한 — service_role 만
// ============================================================
const acl = (await q(`select has_function_privilege('authenticated','redeem_referral(uuid,text)','execute') a,
                             has_function_privilege('anon','redeem_referral(uuid,text)','execute') b,
                             has_function_privilege('service_role','redeem_referral(uuid,text)','execute') c`)).rows[0];
eq('7a ⛔ authenticated·anon 은 직접 못 부른다(남의 귀속을 대신 박는 길)', [acl.a, acl.b], [false, false]);
eq('7b service_role 은 부를 수 있다', acl.c, true);

// ---- 결과 출력 ----
for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`);
const failed = results.filter((x) => !x.pass).length;
console.log(`\nT-REFERRAL-COIN: ${results.length - failed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-referral-coin', pg: 'pglite/postgres-18', total: results.length, passed: results.length - failed, failed }));
process.exit(failed === 0 ? 0 : 1);
