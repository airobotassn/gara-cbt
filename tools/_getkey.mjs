import fs from 'node:fs'
const r = await fetch('https://api.supabase.com/v1/projects/lditytpxuuojfznwfnep/api-keys?reveal=true', {
  headers: { Authorization: 'Bearer ' + process.env.SB_PAT },
})
const j = await r.json()
const sr = j.find((k) => k.name === 'service_role')
fs.writeFileSync('C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad/srkey.txt', sr.api_key)
console.log('saved service_role key, len =', sr.api_key.length)
