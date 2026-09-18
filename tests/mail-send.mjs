// MAIL-SEND — 독려 메일 발송 모듈(_shared/mail.ts)을 bun 으로 검증. Resend 는 fetch 를 가짜로 바꿔 본다.
//
// 지키는 것:
//  ⭐1) 치환자는 번역 조각에 안 섞인다 — `{name}`·`{level}` 이 그대로 자리를 지키고 글자 조각만 번역기에 간다.
//  ⭐2) 줄바꿈이 보존된다 — 번역 뒤에도 문단 구조가 같다.
//  ⭐3) 묶음(batch)이 거절되면 그 묶음만 한 통씩 다시 보내 **실패한 주소만** 실패로 남는다(나머지는 발송됨).
//   4) 발신 설정 없음(키 없음 / 주소 없음) → null. 이름의 따옴표·꺾쇠는 빠진다.
//   5) fillVars 는 없는 키를 빈칸으로 만들지 않는다.
import { fillVars, splitTemplate, isTextPart, joinTemplate, sendMails, mailConfig } from '../supabase/functions/_shared/mail.ts';

const results = [];
const rec = (name, got, want, pass) => results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));

// ---- 1·2) 쪼개기 / 잇기 ----
const body = '안녕하세요, {name} 님.\n현재 레벨등급 {level} 유지 중입니다.\n\n{link}\n\n감사합니다.';
const parts = splitTemplate(body);
const textParts = parts.filter(isTextPart);
eq('1 글자 조각만 번역 대상(치환자·줄바꿈 제외)', textParts, ['안녕하세요, ', ' 님.', '현재 레벨등급 ', ' 유지 중입니다.', '감사합니다.']);
eq('1b 치환자 조각은 그대로 남는다', parts.filter((x) => /^\{[a-z]+\}$/.test(x)), ['{name}', '{level}', '{link}']);
const fake = { '안녕하세요, ': 'Hello, ', ' 님.': '.', '현재 레벨등급 ': 'You are currently at level ', ' 유지 중입니다.': '.', '감사합니다.': 'Thank you.' };
const joined = joinTemplate(parts, (i) => fake[parts[i]]);
eq('2 번역 뒤에도 치환자·줄바꿈 자리가 같다', joined, 'Hello, {name}.\nYou are currently at level {level}.\n\n{link}\n\nThank you.');
eq('2b 번역이 없는 조각은 원문', joinTemplate(parts, () => undefined), body);
eq('2c 값 채우기', fillVars(joined, { name: 'Ran', level: 'Lv.3', link: 'https://x/test' }), 'Hello, Ran.\nYou are currently at level Lv.3.\n\nhttps://x/test\n\nThank you.');

// ---- 5) fillVars ----
eq('5 없는 키는 그대로 둔다', fillVars('안녕 {name} · {round}', { name: 'A' }), '안녕 A · {round}');

// ---- 3) 발송 — 묶음 거절 → 한 통씩 ----
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const payload = JSON.parse(init.body);
  calls.push({ url: String(url), n: Array.isArray(payload) ? payload.length : 1 });
  if (String(url).endsWith('/emails/batch')) {
    // 묶음 안에 잘못된 주소가 있으면 통째로 거절(Resend 실제 동작)
    const bad = payload.some((m) => m.to[0].includes('bad@'));
    return new Response(JSON.stringify(bad ? { message: 'Invalid `to` field' } : { data: payload.map((_, i) => ({ id: `b${i}` })) }), { status: bad ? 422 : 200 });
  }
  const to = payload.to[0];
  return new Response(JSON.stringify(to.includes('bad@') ? { message: 'Invalid `to` field' } : { id: `one-${to}` }), { status: to.includes('bad@') ? 422 : 200 });
};
const cfg = { apiKey: 'k', from: 'CARIS <noreply@example.com>' };
const good = [{ to: 'a@x.com', subject: 's', text: 't' }, { to: 'b@x.com', subject: 's', text: 't' }];
const r1 = await sendMails(cfg, good);
eq('3a 정상 묶음은 한 번에 나간다', r1.map((r) => r.ok), [true, true]);
eq('3a-2 호출 1번(batch)', calls.length, 1);

calls.length = 0;
const mixed = [{ to: 'a@x.com', subject: 's', text: 't' }, { to: 'bad@x', subject: 's', text: 't' }, { to: 'c@x.com', subject: 's', text: 't' }];
const r2 = await sendMails(cfg, mixed);
eq('3b 묶음 거절 → 실패한 주소만 실패', r2.map((r) => r.ok), [true, false, true]);
eq('3b-2 실패 사유가 남는다', r2[1].error, 'Invalid `to` field');
eq('3b-3 호출 = 묶음 1 + 낱개 3', calls.map((c) => c.n), [3, 1, 1, 1]);
globalThis.fetch = realFetch;

// ---- 4) 발신 설정 ----
const fakeAdmin = (rows) => ({ from: () => ({ select: () => ({ in: async () => ({ data: rows }) }) }) });
const envBak = process.env.RESEND_API_KEY;
globalThis.Deno = { env: { get: (k) => (k === 'RESEND_API_KEY' ? 'key' : undefined) } };
eq('4 주소 없으면 null', await mailConfig(fakeAdmin([{ key: 'sender_name', value: 'CARIS' }])), null);
eq('4b 이름+주소', (await mailConfig(fakeAdmin([{ key: 'sender_name', value: 'CARIS "센터" <x>' }, { key: 'sender_email', value: 'noreply@caris.kr' }]))).from, 'CARIS 센터 x <noreply@caris.kr>');
eq('4c 이름 없으면 주소만', (await mailConfig(fakeAdmin([{ key: 'sender_email', value: 'noreply@caris.kr' }]))).from, 'noreply@caris.kr');
globalThis.Deno = { env: { get: () => undefined } };
eq('4d 키 없으면 null', await mailConfig(fakeAdmin([{ key: 'sender_email', value: 'noreply@caris.kr' }])), null);
if (envBak !== undefined) process.env.RESEND_API_KEY = envBak;

const fails = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  got=${r.got} want=${r.want}`}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) process.exit(1);
