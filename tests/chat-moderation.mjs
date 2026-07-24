// bun tests/chat-moderation.mjs
// Unit tests for supabase/functions/_shared/chat.ts real logic (moderateOpenAI
// circuit breaker + status mapping, resolveIpHash) run under bun by shimming
// the Deno global and mocking fetch — no deploy, no network.
//
// Deno-shim limitation: chat.ts reads Deno.env.get(...) at module load time
// (CHAT_REQUIRE_LOGIN / CHAT_MOD_FAILCLOSED) and its import of ./seb.ts is
// pure (crypto.subtle + functions that read Deno.env.get lazily inside call
// bodies, never at module load), so both modules load cleanly under bun once
// globalThis.Deno is shimmed before the dynamic import. No transitive
// Deno-only remote import was found in seb.ts, so nothing had to be skipped.
//
// Ordering assumption: moderateOpenAI keeps its circuit-breaker counters
// (consecutiveFailures / breakerOpenUntil) as module-level state that this
// single process/module-registry shares across every case below. Cases are
// therefore ordered so breaker-affecting cases run LAST and in a specific
// sequence:
//   1) no-key case (breaker closed, 0 failures)
//   2) flagged case (ok, 0 failures)
//   3) ok case (ok, 0 failures)
//   4) simulated timeout/reject -> failure #1
//   5) four more HTTP 500s -> failures #2..#5 (5th trips the breaker open)
//   6) a 6th call while the breaker is open -> must short-circuit to
//      'unavailable' WITHOUT invoking fetch at all
// Re-importing chat.ts fresh per case (to reset module state) is not
// reliable under bun's module cache for a relative TS path within one
// process, so this ordering is used instead of an import-cache-bust.

let passed = 0
let failed = 0
const failures = []

function check(name, cond) {
  if (cond) {
    passed++
    console.log(`PASS: ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`FAIL: ${name}`)
  }
}

// ---- Deno shim (must be set BEFORE importing chat.ts) ----
process.env.OPENAI_API_KEY = 'test-key'
globalThis.Deno = {
  env: { get: (k) => process.env[k] },
}

const chat = await import('../supabase/functions/_shared/chat.ts')

check('chat module exports moderateOpenAI', typeof chat.moderateOpenAI === 'function')
check('chat module exports resolveIpHash', typeof chat.resolveIpHash === 'function')

// ================= containsLink (링크/스팸 필터, 설계 3종세트) =================
check('chat module exports containsLink', typeof chat.containsLink === 'function')
check('containsLink: http:// blocked', chat.containsLink('봐봐 http://spam.io/x') === true)
check('containsLink: https:// blocked', chat.containsLink('https://evil.com') === true)
check('containsLink: www. blocked', chat.containsLink('www.gambling.com 가입하세요') === true)
check('containsLink: bare TLD domain blocked', chat.containsLink('여기 example.com 참고') === true)
check('containsLink: .kr path blocked', chat.containsLink('caris.kr/join 오세요') === true)
check('containsLink: plain text passes', chat.containsLink('오늘 시험 다들 어땠어요?') === false)
check('containsLink: decimal not a link', chat.containsLink('원주율은 3.14 정도') === false)
check('containsLink: node.js (js not a TLD) passes', chat.containsLink('node.js 공부 중이에요') === false)

// ================= resolveIpHash =================

{
  const reqWithIp = new Request('http://x', {
    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
  })
  const h1 = await chat.resolveIpHash(reqWithIp)
  const h2 = await chat.resolveIpHash(reqWithIp)
  check(
    'resolveIpHash: with x-forwarded-for returns 64-char hex sha256',
    typeof h1 === 'string' && h1.length === 64 && /^[0-9a-f]{64}$/.test(h1),
  )
  check('resolveIpHash: deterministic for same IP+day', h1 === h2)
}

{
  const reqNoIp = new Request('http://x', { headers: {} })
  const u1 = await chat.resolveIpHash(reqNoIp)
  const u2 = await chat.resolveIpHash(reqNoIp)
  check(
    'resolveIpHash: with no IP headers returns 36-char uuid-ish sentinel',
    typeof u1 === 'string' &&
      u1.length === 36 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u1),
  )
  check('resolveIpHash: sentinel is NOT a sha256 hex string', !/^[0-9a-f]{64}$/.test(u1))
  check('resolveIpHash: no-IP sentinel is fresh per call (not deterministic)', u1 !== u2)
}

// ================= moderateOpenAI =================

// -- case (e): no API key configured -> 'unavailable' without calling fetch --
{
  delete process.env.OPENAI_API_KEY
  let fetchCalled = false
  globalThis.fetch = async () => {
    fetchCalled = true
    throw new Error('fetch must not be called when OPENAI_API_KEY is unset')
  }
  const r = await chat.moderateOpenAI('hello')
  check('moderateOpenAI: no API key -> status unavailable', r.status === 'unavailable')
  check('moderateOpenAI: no API key -> fetch not called', fetchCalled === false)
  process.env.OPENAI_API_KEY = 'test-key'
}

// -- case (a): flagged:true -> 'flagged' --
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ flagged: true }] }),
  })
  const r = await chat.moderateOpenAI('bad text')
  check('moderateOpenAI: flagged:true -> status flagged', r.status === 'flagged')
}

// -- case (b): flagged:false -> 'ok' --
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ results: [{ flagged: false }] }),
  })
  const r = await chat.moderateOpenAI('nice text')
  check('moderateOpenAI: flagged:false -> status ok', r.status === 'ok')
}

// -- non-5xx failure (e.g. 400) must NOT count toward the breaker (reset instead) --
// Runs here (breaker still closed, 0 consecutive failures) so the assertion
// exercises the intended status-mapping branch rather than the breaker itself.
{
  globalThis.fetch = async () => ({ ok: false, status: 400 })
  const r = await chat.moderateOpenAI('text')
  check('moderateOpenAI: HTTP 400 (non-5xx) -> status unavailable', r.status === 'unavailable')
}

// -- case (d): fetch rejects (simulated timeout/abort) -> 'unavailable' (failure #1) --
{
  globalThis.fetch = async () => {
    throw new DOMException('The operation was aborted.', 'AbortError')
  }
  const r = await chat.moderateOpenAI('text')
  check('moderateOpenAI: fetch rejects (timeout/abort) -> status unavailable', r.status === 'unavailable')
}

// -- case (c): HTTP 500 repeated 4 more times -> failures #2..#5, each 'unavailable' --
// (failure #1 was the reject case above; the 5th consecutive failure here trips the breaker)
{
  globalThis.fetch = async () => ({ ok: false, status: 500 })
  for (let i = 0; i < 4; i++) {
    const r = await chat.moderateOpenAI('text')
    check(`moderateOpenAI: HTTP 500 failure #${i + 2}/5 -> status unavailable`, r.status === 'unavailable')
  }
}

// -- 6th call: breaker must now be open -> short-circuit to 'unavailable' WITHOUT calling fetch --
{
  let fetchCalled = false
  globalThis.fetch = async () => {
    fetchCalled = true
    throw new Error('fetch must not be called while circuit breaker is open')
  }
  const r = await chat.moderateOpenAI('text')
  check('moderateOpenAI: breaker open -> status unavailable', r.status === 'unavailable')
  check('moderateOpenAI: breaker open -> fetch not called', fetchCalled === false)
}


console.log(JSON.stringify({ passed, failed, failures }, null, 2))
process.exit(failed ? 1 : 0)
