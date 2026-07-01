// 관리자 번역 오케스트레이션: 배포된 translate-questions 함수를 호출하되
// 점진적 쪼개기(10→5→1) + 큐 + 분당 스로틀로 안정적으로 처리. 순서는 인덱스로 보존.
//  (ai-level-test 에서 이관 — translate-questions 가 x-passcode 를 요구하므로 opts.passcode 로 전달)
import { callFunction } from './supabase'

export interface TransItem {
  prompt: string
  options: string[]
  explanation: string
}
export type TransResult =
  | { tr: Record<string, TransItem>; issues: Record<string, string[]> }
  | { error: string }

const SPLIT_STEPS = [10, 5, 1] // 1차 10 → 실패분 5 → 그래도 실패분 1
const POOL = 3
const RPM = 12

function makeLimiter(perMin: number) {
  let tokens = 2
  let last = Date.now()
  return async (n: number) => {
    for (;;) {
      const now = Date.now()
      tokens = Math.min(perMin, tokens + ((now - last) * perMin) / 60000)
      last = now
      if (tokens >= n) {
        tokens -= n
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

const isOk = (r: TransResult | undefined): r is { tr: Record<string, TransItem>; issues: Record<string, string[]> } =>
  !!r && 'tr' in r

export async function runTranslation(
  items: TransItem[],
  langs: string[],
  onProgress?: (done: number, total: number, note: string) => void,
  opts?: {
    // 이미 끝난 결과(이어서하기): isOk 인 항목은 재호출하지 않고 그대로 둠
    seed?: (TransResult | undefined)[]
    // 배치 하나가 끝날 때마다 현재까지의 결과 스냅샷 전달(자동저장용)
    onBatch?: (results: TransResult[]) => void
    // translate-questions 보호용 암호(x-passcode 헤더). 비어 있으면 보내지 않음.
    passcode?: string
  },
): Promise<TransResult[]> {
  const results: (TransResult | undefined)[] =
    opts?.seed && opts.seed.length === items.length ? [...opts.seed] : new Array(items.length)
  const take = makeLimiter(RPM)
  const pcHeaders = opts?.passcode ? { 'x-passcode': opts.passcode } : undefined
  let dailyStopped = false
  const doneCount = () => results.filter(isOk).length
  const snapshot = () => results.map((r) => r ?? ({ error: '미처리' } as TransResult))

  async function handle(idxs: number[]) {
    if (dailyStopped) return
    const payload = idxs.map((i) => items[i])
    for (let attempt = 0; attempt <= 1; attempt++) {
      await take(Math.ceil(idxs.length / 10) * 2) // 번역+검수
      if (dailyStopped) return
      try {
        const r = await callFunction<{ results: (TransResult | null)[] }>(
          'translate-questions',
          { items: payload, langs },
          pcHeaders,
        )
        ;(r.results || []).forEach((res, k) => {
          results[idxs[k]] = res ?? { error: '빈응답' }
        })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/quota_daily|일일한도/.test(msg)) {
          dailyStopped = true
          idxs.forEach((i) => (results[i] = { error: '일일한도' }))
          return
        }
        if (attempt < 1) {
          await new Promise((rs) => setTimeout(rs, 1500))
          continue
        }
        idxs.forEach((i) => (results[i] = { error: msg.slice(0, 60) }))
      }
    }
  }

  for (const size of SPLIT_STEPS) {
    if (dailyStopped) break
    const todo: number[] = []
    for (let i = 0; i < items.length; i++) if (!isOk(results[i])) todo.push(i)
    if (!todo.length) break
    const batches: number[][] = []
    for (let j = 0; j < todo.length; j += size) batches.push(todo.slice(j, j + size))
    let bi = 0
    const worker = async () => {
      while (bi < batches.length && !dailyStopped) {
        await handle(batches[bi++])
        onProgress?.(doneCount(), items.length, size < SPLIT_STEPS[0] ? `재시도 ${size}개씩` : '')
        opts?.onBatch?.(snapshot()) // 배치마다 자동저장
      }
    }
    await Promise.all(Array.from({ length: Math.min(POOL, batches.length) }, worker))
  }
  return results.map((r) => r ?? { error: '미처리' })
}
