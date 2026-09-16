import { readFileSync } from 'node:fs'
import { replayBlock } from '../supabase/functions/_shared/minigame-replay.ts'
const { score, log } = JSON.parse(readFileSync('tmp/_block-log.json', 'utf8'))
const r = replayBlock(log, 600)
console.log('game', score, 'server', JSON.stringify(r), r.ok && r.score === score ? 'MATCH' : 'MISMATCH')
