// 계정 디버그 — 이메일(부분일치)로 유저를 찾아 응시 기록/누적/등급을 덤프한다.
// 보호 테이블(RLS=service role 전용) 조회라 SERVICE_KEY 가 필요하다.
//
// 실행(PowerShell):
//   $env:SERVICE_KEY="<service_role 키>"; node scripts/debug-account.mjs ahnhyeonjun
//
// URL 은 .env.local 의 VITE_SUPABASE_URL 에서 자동으로 읽는다.
import { readFileSync } from 'node:fs'

const q = (process.argv[2] || '').toLowerCase()
if (!q) { console.error('사용법: node scripts/debug-account.mjs <이메일 일부>'); process.exit(1) }

const KEY = process.env.SERVICE_KEY
if (!KEY) { console.error('SERVICE_KEY env 필요 (Supabase 대시보드 → Settings → API → service_role)'); process.exit(1) }

// .env.local 에서 URL 읽기
let URL = process.env.SUPA_URL
if (!URL) {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    URL = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim()
  } catch { /* ignore */ }
}
if (!URL) { console.error('SUPA_URL 또는 .env.local 의 VITE_SUPABASE_URL 필요'); process.exit(1) }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function rest(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

// 1) 이메일로 유저 찾기 (GoTrue admin, 페이지네이션)
async function findUsers(sub) {
  const hits = []
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H })
    if (!res.ok) throw new Error(`admin/users → ${res.status} ${await res.text()}`)
    const { users } = await res.json()
    if (!users?.length) break
    for (const u of users) if ((u.email || '').toLowerCase().includes(sub)) hits.push(u)
    if (users.length < 200) break
  }
  return hits
}

const users = await findUsers(q)
if (!users.length) { console.log(`'${q}' 매칭 유저 없음`); process.exit(0) }

for (const u of users) {
  console.log('\n' + '='.repeat(60))
  console.log(`👤 ${u.email}  (id=${u.id})  anon=${u.is_anonymous}  가입=${u.created_at?.slice(0,10)}`)

  // 등급
  const prog = await rest(`user_progress?user_id=eq.${u.id}&select=*`)
  if (prog[0]) console.log(`등급(level)=${prog[0].level}  points=${prog[0].points}  strikes=${prog[0].demotion_strikes}`)
  else console.log('user_progress 없음(응시 전)')

  // 응시 기록
  const attempts = await rest(
    `test_attempts?user_id=eq.${u.id}&select=id,level,status,total_correct,submitted_at,axis_perf,applied&order=submitted_at.asc`,
  )
  console.log(`\n응시 ${attempts.length}건:`)
  for (const a of attempts) {
    const ks = a.axis_perf ? Object.keys(a.axis_perf).length : 0
    console.log(
      `  Lv.${a.level} | ${a.status} | 정답 ${a.total_correct} | axis_perf축수=${ks} | applied=${a.applied} | ${a.submitted_at ?? '미제출'} | ${a.id}`,
    )
  }

  // 레벨별 동레벨 2회+ 여부(= 음영 조건)
  const byLevel = {}
  for (const a of attempts) if (a.status === 'submitted' && a.axis_perf) byLevel[a.level] = (byLevel[a.level] || 0) + 1
  const multi = Object.entries(byLevel).filter(([, c]) => c >= 2).map(([lv]) => `Lv.${lv}`)
  console.log(`\n음영(직전 동레벨) 가능 레벨: ${multi.length ? multi.join(', ') : '없음(모든 레벨 1회뿐 → 음영 미표시 정상)'}`)
}
