// 막아라 — 게임 HTML 의 DAYS 를 읽어 서버 리터럴(_shared/block-days.ts)을 다시 쓴다. 문구는 안 담고 조각 종류만.
import { readFileSync, writeFileSync } from 'node:fs'
const html = readFileSync('public/games/block-cari.html', 'utf8')
const m = html.match(/const DAYS=(\[[\s\S]*?\n\]);/)
const DAYS = new Function('return ' + m[1])()
const days = DAYS.map((D) => ({
  mask: D.newMask, block: D.newBlock,
  docs: D.docs.map((d) => {
    const kinds = [...d.text.matchAll(/\{([a-z]+)\|/g)].map((x) => x[1])
    return d.block ? { block: d.block, kinds } : { kinds }
  }),
}))
const lit = JSON.stringify(days, null, 0).replace(/\},\{/g, '},\n  {').replace(/"([a-z]+)":/g, '$1:').replace(/"/g, "'")
const ts = `// 막아라(block-cari) 서류 — 서버 재채점용. 2026-09-15.
//
// ⛔ 게임 \`public/games/block-cari.html\` 의 DAYS 와 **sync pair** 다 — 문구는 안 담고 **조각 종류 순서**만 담는다
//    (\`{name|박서연}\` → 'name'). tests/minigame-replay.mjs 가 두 파일을 대조한다. 서류를 넣거나 조각을 바꾸면 양쪽 다 —
//    안 그러면 그 서류의 기록이 400 으로 튕기거나 다른 점수가 난다. 다시 쓰는 스크립트 = tmp/_block-apply.mjs(HTML 이 원본).
//
// 규칙(게임의 judge() 그대로):
//   날마다 mask/block 규정이 누적된다. 서류의 조각은 규정 코드('name'…) · 'k'(핵심 — 가리면 실패) · 'd'(무해).
//   전송: 활성 block 서류면 실패 · 활성 mask 조각을 안 가렸으면 실패 · k 를 가렸으면 실패 · 아니면 통과(+DOC_POINT,
//         d 나 아직 규정에 없는 조각을 하나도 안 가렸으면 +PERFECT_BONUS).
//   반려: 활성 block 서류면 통과(+DOC_POINT) · 아니면 실패.
//   실패 MAX_STRIKE 번이면 끝(해고). 아직 규정에 없는 종류는 위반이 아니다(7일차 4번 코드 서류 = 전송이 정답).

export interface BlockDoc { block?: string; kinds: string[] }
export interface BlockDay { mask: string[]; block: string[]; docs: BlockDoc[] }

export const BLOCK_MAX_STRIKE = 3
export const BLOCK_DOC_POINT = 100
export const BLOCK_PERFECT_BONUS = 50

export const BLOCK_DAYS: BlockDay[] = ${lit}

/** 한 장 판정 — masked = 가린 조각의 자리, sent = 전송(true)/반려(false). 게임의 judge() 와 같은 갈래. */
export function judgeBlockDoc(
  activeMask: Set<string>, activeBlock: Set<string>, doc: BlockDoc, masked: Set<number>, sent: boolean,
): { ok: boolean; gain: number } {
  const isBlock = !!doc.block && activeBlock.has(doc.block)
  if (!sent) return isBlock ? { ok: true, gain: BLOCK_DOC_POINT } : { ok: false, gain: 0 }
  if (isBlock) return { ok: false, gain: 0 }
  let leaked = false, over = false, extra = false
  doc.kinds.forEach((k, i) => {
    const mk = masked.has(i)
    if (activeMask.has(k) && !mk) leaked = true
    else if (k === 'k' && mk) over = true
    else if (k !== 'k' && !activeMask.has(k) && mk) extra = true
  })
  if (leaked || over) return { ok: false, gain: 0 }
  return { ok: true, gain: BLOCK_DOC_POINT + (extra ? 0 : BLOCK_PERFECT_BONUS) }
}
`
writeFileSync('supabase/functions/_shared/block-days.ts', ts)
console.log('days', days.length, 'docs', days.reduce((n, D) => n + D.docs.length, 0))
