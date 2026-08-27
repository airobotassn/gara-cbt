import fs from 'node:fs'
const SP = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-gara-cbt/96bb0558-708f-4af2-8598-e6b7bed8d16a/scratchpad'
const EXAM = '4c1e1d6e-d1dc-4a67-b0fa-883944ef4362'
const q = `select json_agg(json_build_object('n',eq.number,'qid',q.id,'ci',q.correct_index,'kind',q.kind) order by eq.number) as r
           from exam_questions eq join questions q on q.id=eq.question_id where eq.exam_id='${EXAM}'`
const r = await fetch('https://api.supabase.com/v1/projects/lditytpxuuojfznwfnep/database/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SB_PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q }),
})
const j = await r.json()
if (!r.ok) { console.log('FAIL', JSON.stringify(j).slice(0, 300)); process.exit(1) }
const rows = j[0].r
fs.writeFileSync(`${SP}/answers.json`, JSON.stringify(rows))
console.log('answers saved:', rows.length, '· sample', JSON.stringify(rows[0]))
