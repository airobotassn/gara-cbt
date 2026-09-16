import { readFileSync } from 'node:fs'
import { replayFeel } from '../supabase/functions/_shared/minigame-replay.ts'
const { score, log } = JSON.parse(readFileSync('tmp/_feel-log.json', 'utf8'))
const r = replayFeel(log, 900)
console.log('game', score, 'server', JSON.stringify(r), r.ok && r.score === score ? 'MATCH' : 'MISMATCH')
