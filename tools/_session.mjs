// 촬영용 세션 발급 — service_role 로 magic link 를 만들어 그 자리에서 세션으로 교환한다.
// ⚠️ 키·세션은 스크래치패드에만 둔다(레포에 남기지 않는다).
import fs from 'node:fs'
const SP = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad'
const env = fs.readFileSync('.env.local', 'utf8')
const URL = env.match(/VITE_SUPABASE_URL=(.+)/)[1].trim()
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const SR = fs.readFileSync(`${SP}/srkey.txt`, 'utf8').trim()
const EMAIL = 'tkgkd159@gmail.com'

const g = await fetch(`${URL}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
})
const gj = await g.json()
if (!g.ok) { console.log('LINK FAIL', g.status, JSON.stringify(gj).slice(0, 300)); process.exit(1) }

const v = await fetch(`${URL}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: gj.hashed_token }),
})
const s = await v.json()
if (!v.ok || !s.access_token) { console.log('VERIFY FAIL', v.status, JSON.stringify(s).slice(0, 400)); process.exit(1) }
s.expires_at = Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600)
fs.writeFileSync(`${SP}/session.json`, JSON.stringify(s, null, 2))
console.log('SESSION OK ·', s.user?.email, '· uid', s.user?.id, '· expires_in', s.expires_in)
