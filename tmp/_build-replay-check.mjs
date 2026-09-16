import { readFileSync } from 'node:fs'
import { replayBuild } from '../supabase/functions/_shared/minigame-replay.ts'
const log = JSON.parse(readFileSync('tmp/_build-play-log.json', 'utf8'))
const r = replayBuild(log, 600)
console.log(JSON.stringify(r), 'tiles', log.reduce((a, e) => a + e.tiles.length, 0))
