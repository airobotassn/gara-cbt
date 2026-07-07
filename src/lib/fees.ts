// 응시료 — DB(exam_fees)에서 금액을 로드. 원서접수(ExamApply) 결제요약이 사용.
// 급수/합격컷/과목은 caris.ts 코드 고정, 여기선 "금액"만 다룬다. 미설정/미연결 시 caris.ts 기본값 폴백.
import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

export type FeeMap = Record<string, number>

// 트랙·티어 → 요금 키. `${트랙키}_${티어키}` — 예: t1_beginner, t1_pro, t1_elite, t2_master, t2_grandmaster, t2_zenith.
// (구 키 'pro'·'master_g4'.. 는 개편으로 폐기 — DB exam_fees 시드/관리자 재설정 필요. 미설정 시 caris.ts 티어 기본값 폴백.)
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
      const { data } = await supabase.from('exam_fees').select('key, amount')
      if (!alive) return
      const map: FeeMap = {}
      for (const r of (data as { key: string; amount: number }[] | null) ?? []) map[r.key] = r.amount
      setFees(map)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  return { fees, loading }
}
