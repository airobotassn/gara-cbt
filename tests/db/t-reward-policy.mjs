// T-Reward-Policy — 적립 정책이 **실제 적립을 정하는지** 정적으로 검증한다(2026-09-07).
//
// 이 기능에서 조용히 깨지면 제일 비싼 것들만 본다. 전부 "틀려도 화면에 표시가 안 나는" 자리다.
//  · ⭐ 적립값 사본이 다시 생기지 않았는가 — 두 벌이 되는 순간 언제든 갈린다(두 달간 절반 적립 사고의 원인).
//  · ⭐ 폴백 숫자가 규격표(scoring.ts)와 같은가 — 다르면 DB 를 못 읽는 순간 조용히 다른 값이 나간다.
//  · ⭐ 못 읽을 때 0 이 아니라 폴백인가 — 0 이면 사용자가 이유도 모르고 점수를 잃는다.
//  · ⭐ active=false 는 0 인가 — 관리자가 끈 것은 꺼져야 한다.
//  · ⭐ 범위 상한이 저장·적립 양쪽에 있는가 — 오타 하나로 아레나 레벨 밴드가 통째로 틀어진다.
//  · complete-daily 가 cosmetic-only 불변식을 유지하는가(scoring.ts 를 안 쓴다) — 그건 별도 게이트가 보지만
//    여기서도 reward-policy 모듈이 scoring.ts 를 안 물어오는지 본다(물어오면 그 게이트가 우회된다).
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const POLICY = read('supabase/functions/_shared/reward-policy.ts');
const SCORING = read('supabase/functions/_shared/scoring.ts');
const DAILY = read('supabase/functions/complete-daily/index.ts');
const MINIGAME = read('supabase/functions/submit-minigame/index.ts');
const HUB = read('supabase/functions/get-hub/index.ts');
const REFORM = read('supabase/functions/admin/reform.ts');
const MIG = read('supabase/migrations/20260907200000_reward_policy_live.sql');

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got, want, pass: pass ?? (got === want) });

// 주석 제거(문서에 적힌 숫자가 오탐이 되지 않게).
const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((l) => {
      const m = l.match(/(^|[^:])\/\/.*/);
      return m ? l.slice(0, m.index + m[1].length) : l;
    })
    .join('\n');

// ── (1) ⭐ 폴백 == 규격표 ────────────────────────────────────
// scoring.ts 의 ACTIVITY_DELTA / ACTIVITY_PER_DAY 를 뜯어 폴백과 대조한다.
const objOf = (src, name) => {
  const m = new RegExp(`${name}[^=]*=\\s*\\{([^}]*)\\}`).exec(strip(src));
  if (!m) return null;
  const out = {};
  for (const [, k, v] of m[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) out[k] = Number(v);
  return out;
};
const specDelta = objOf(SCORING, 'ACTIVITY_DELTA');
const specPerDay = objOf(SCORING, 'ACTIVITY_PER_DAY');
rec('규격표를 읽었다(scoring.ts)', Boolean(specDelta && specPerDay), true);

const fbBlock = /REWARD_FALLBACK[^=]*=\s*\{([\s\S]*?)\n\}/.exec(strip(POLICY));
rec('폴백표를 읽었다(reward-policy.ts)', fbBlock != null, true);
const fb = {};
if (fbBlock) {
  for (const [, k, d, p] of fbBlock[1].matchAll(/(\w+)\s*:\s*\{\s*delta:\s*(\d+),\s*perDay:\s*(\d+)\s*\}/g)) {
    fb[k] = { delta: Number(d), perDay: Number(p) };
  }
}
for (const k of ['attendance', 'daily_learn', 'minigame']) {
  rec(`⭐폴백 delta 가 규격과 같다: ${k}`, fb[k]?.delta, specDelta?.[k]);
  rec(`⭐폴백 perDay 가 규격과 같다: ${k}`, fb[k]?.perDay, specPerDay?.[k]);
}

// ── (2) ⭐ 적립값 사본이 다시 생기지 않았는가 ────────────────
// 두 달간 절반만 적립된 사고의 원인이 이 파일 안의 사본(ACTIVITY_DELTA_SYNCED)이었다.
// ⚠️ 주석 제거본으로 본다 — 그 사본이 왜 위험했는지는 주석으로 남겨 뒀다(이름만 보고 오탐하면 안 된다).
rec('⭐complete-daily 에 적립값 사본이 없다', /ACTIVITY_DELTA_SYNCED|ACTIVITY_DELTA_SPEC/.test(strip(DAILY)), false);
rec('⭐complete-daily 가 정책 모듈을 쓴다', /loadRewardPolicy/.test(strip(DAILY)), true);
rec('⭐complete-daily 가 코인값도 정책에서 읽는다', /loadCoinDaily/.test(strip(DAILY)), true);
rec('complete-daily 에 DAILY_POINTS 상수가 없다', /const DAILY_POINTS\s*=/.test(strip(DAILY)), false);
rec('⭐submit-minigame 이 정책 모듈을 쓴다', /loadRewardPolicy/.test(strip(MINIGAME)), true);
rec('submit-minigame 이 옛 상수 헬퍼를 안 쓴다', /activityDelta\(|activityPerDay\(/.test(strip(MINIGAME)), false);
rec('⭐get-hub 이 화면 값도 같은 표에서 읽는다', /loadRewardPolicy/.test(strip(HUB)), true);
rec('get-hub 에 econ 하드코딩이 없다', /const ECON\s*=/.test(strip(HUB)), false);

// ── (3) ⭐ 못 읽으면 폴백, 껐으면 0 ──────────────────────────
const P = strip(POLICY);
rec('⭐조회 실패면 폴백을 돌려준다', /if\s*\(error\s*\|\|\s*!data\)\s*return out/.test(P), true);
rec('⭐active=false 면 delta 0', /r\.active\s*\?[\s\S]{0,120}?:\s*\{\s*delta:\s*0/.test(P), true);
rec('코인도 조회 실패면 폴백', /if\s*\(error\s*\|\|\s*!data\)\s*return COIN_DAILY_FALLBACK/.test(P), true);
rec('scoring.ts 를 물어오지 않는다(cosmetic-only 우회 방지)', /_shared\/scoring/.test(P), false);

// ── (4) ⭐ 범위가 저장·적립 양쪽에 있다 ──────────────────────
rec('⭐적립 쪽에 상한이 있다(clampDelta)', /REWARD_MAX_DELTA/.test(P) && /clampDelta/.test(P), true);
rec('⭐적립 쪽에 횟수 상한이 있다(clampPerDay)', /REWARD_MAX_PER_DAY/.test(P) && /clampPerDay/.test(P), true);
rec('⭐저장 쪽에도 상한이 있다(admin)', /REWARD_MAX_DELTA/.test(strip(REFORM)) && /REWARD_MAX_PER_DAY/.test(strip(REFORM)), true);
rec('저장 쪽이 정수만 받는다', /Number\.isInteger/.test(strip(REFORM)), true);

// ── (5) 마이그레이션: 못 지키는 줄을 지운다 ──────────────────
rec('친구 초대 줄을 지운다', /delete from reward_policy where wallet = 'score' and kind = 'referral'/.test(MIG), true);
rec('게임별 줄을 지운다', /kind like 'minigame:%'/.test(MIG), true);
rec('⭐남은 4줄을 검산한다', /raise exception '적립을 정하는 4줄/.test(MIG), true);
rec('⛔이미 적립된 옛 원장은 안 건드린다', /activity_ledger/.test(MIG.replace(/^--.*$/gm, '')), false);

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name} (got=${r.got} want=${r.want})`);
const passed = results.filter((r) => r.pass).length;
console.log(`\nT-REWARD-POLICY: ${passed}/${results.length} passed`);
console.log(JSON.stringify({ suite: 't-reward-policy', total: results.length, passed, failed: results.length - passed }));
if (passed !== results.length) process.exit(1);
