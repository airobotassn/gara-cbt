import fs from 'node:fs'
const SP = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad'
const env = fs.readFileSync('.env.local', 'utf8')
const URL = env.match(/VITE_SUPABASE_URL=(.+)/)[1].trim()
const ANON = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)[1].trim()
const s = JSON.parse(fs.readFileSync(`${SP}/session.json`, 'utf8'))
const r = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ refresh_token: s.refresh_token }),
})
const j = await r.json()
if (!r.ok || !j.access_token) { console.log('REFRESH FAIL', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1) }
const next = { ...j, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600) }
fs.writeFileSync(`${SP}/session.json`, JSON.stringify(next, null, 2))
console.log('REFRESH OK · user =', j.user?.email, '· expires in', j.expires_in, 's')
