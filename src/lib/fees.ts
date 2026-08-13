// 응시료 — **정가 단일 소스는 DB `exam_fees`** 다. 원서접수(ExamApply) 결제요약이 이걸 쓴다.
// 급수/합격컷/과목은 caris.ts 코드 고정, 여기선 "금액"만 다룬다.
//
// ⚠️ **폴백 없음.** 예전엔 미설정 시 caris.ts 의 `fee`(달러 임시값)로 떨어졌는데, 그 상수는 제거됐다.
//    돈 받는 값이라 폴백이 있으면 "설정 누락"이 조용히 임시금액 결제로 이어진다. 키가 없으면
//    호출부가 금액을 못 받고(undefined) 화면이 '준비 중'으로 막는 게 맞다.
// 통화는 달러 하나 — amount 는 **센트 정수**다(100 = $1.00, 2026-08-13 전환). 표시는 lib/money.ts 의 usdc().
// 국내 결제는 서버가 결제 시점 환율로 원화를 계산한다 — 프론트가 환산하지 않는다.
import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

export type FeeMap = Record<string, number>

// 트랙·티어 → 요금 키. `${트랙키}_${티어키}` — 예: t1_beginner, t1_pro, t1_elite, t2_master, t2_grandmaster, t2_zenith.
// 구 키('pro'·'master_g4'..)는 20260806180000 마이그레이션에서 삭제됐다.
// ⚠️ 현재 DB 에 있는 건 CARIS-Ⅰ 세 개뿐이다(t1_*). CARIS-Ⅱ(t2_*)는 결제를 안 열어서 **일부러 행이 없다**
//    — 화면은 그 경우 '준비 중'으로 표시한다. 열 때 관리자 화면에서 세 줄 추가하면 된다.
export function feeKey(trackKey: string, tierKey: string): string {
  return `${trackKey}_${tierKey}`
}

export function useExamFees() {
  const [fees, setFees] = useState<FeeMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!isSupabaseConfigured) {
        if (alive) setLoading(false)
        return
      }
      const { data } = await supabase.from('exam_fees').select('key, amount_usd_cents')
      if (!alive) return
      const map: FeeMap = {}
      for (const r of (data as { key: string; amount_usd_cents: number }[] | null) ?? []) map[r.key] = r.amount_usd_cents
      setFees(map)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  return { fees, loading }
}
