// CONSENT-VERSION — 약관 버전 문자열이 화면과 서버에서 같은지 본다.
//
// 왜 테스트가 필요한가: 이 값은 **두 파일에 따로 적혀 있고**, 어긋나도 아무것도 안 터진다.
//   · 화면만 올림 → 저장된 값이 영영 안 맞아 **전원이 매번 다시 동의**한다.
//   · 서버만 올림 → 화면이 옛 값과 비교해 **아무한테도 안 물어본다**(개정 동의를 못 받는다).
// 둘 다 화면에는 오류가 안 뜨는 종류라 사람 눈으로는 못 잡는다.
import { readFileSync } from 'node:fs'

const FRONT = 'src/lib/consent.ts'
const EDGE = 'supabase/functions/agree-terms/index.ts'

const results = []
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass })
const eq = (name, got, want) => rec(name, got, want, got === want)
const ok = (name, cond, got) => rec(name, got, true, !!cond)

const pick = (path) => {
  const src = readFileSync(path, 'utf8')
  const m = /TERMS_VERSION\s*=\s*'([^']+)'/.exec(src)
  return m ? m[1] : null
}

const front = pick(FRONT)
const edge = pick(EDGE)

ok('1a 화면에 TERMS_VERSION 이 있다', front != null, front)
ok('1b 서버에 TERMS_VERSION 이 있다', edge != null, edge)
eq('1c ⭐두 값이 같다', front, edge)

// 버전을 올리면 전원이 다시 동의하게 되므로, 값이 날짜 모양인지만 확인한다(실수로 빈 문자열·true 방지).
ok('1d 버전이 날짜 모양이다(YYYY-MM-DD)', !!front && /^\d{4}-\d{2}-\d{2}$/.test(front), front)

// 화면이 '한 번도 동의 안 함'과 '옛 판에 동의함'을 **둘 다** 잡는지(버전 컬럼을 둔 이유).
const frontSrc = readFileSync(FRONT, 'utf8')
ok('2a 미동의(null)를 잡는다', /if\s*\(!agreedAt\)\s*return true/.test(frontSrc), true)
ok('2b ⭐옛 버전도 잡는다', /version\s*!==\s*TERMS_VERSION/.test(frontSrc), true)

// 동의 저장은 서버만 한다 — 클라가 profiles 를 직접 쓰면 체크 없이 통과시킬 수 있다.
const gateSrc = readFileSync('src/pages/TermsAgree.tsx', 'utf8')
ok('3a ⭐화면이 profiles 를 직접 쓰지 않는다', !/from\('profiles'\)[\s\S]{0,80}update\(/.test(gateSrc), true)
ok('3b 화면은 agree-terms 함수를 부른다', /callFunction\('agree-terms'/.test(gateSrc), true)

// 게이트는 갇히지 않게 최소 예외를 열어둬야 한다(약관·방침을 못 읽으면 동의할 수가 없다).
const appSrc = readFileSync('src/App.tsx', 'utf8')
const exempt = /const TERMS_EXEMPT = \[([^\]]*)\]/.exec(appSrc)?.[1] ?? ''
for (const p of ['/onboarding/terms', '/login', '/auth/callback', '/terms', '/privacy', '/exam/run']) {
  ok(`4 예외에 ${p} 가 있다`, exempt.includes(`'${p}'`), exempt)
}
// ⛔ 나가는 문이 없으면 동의 안 한 사람이 로그인한 채 갇힌다.
ok('5a ⭐동의 화면에 로그아웃이 있다', /logout\(\)/.test(gateSrc), true)

for (const x of results) console.log(`${x.pass ? 'PASS' : 'FAIL'} | ${x.name} (got=${x.got} want=${x.want})`)
const failed = results.filter((x) => !x.pass).length
console.log(`\nCONSENT-VERSION: ${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
