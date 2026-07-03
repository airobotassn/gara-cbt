// 응시료 — DB(exam_fees)에서 금액을 로드. 원서접수(ExamApply) 결제요약이 사용.
// 급수/합격컷/과목은 caris.ts 코드 고정, 여기선 "금액"만 다룬다. 미설정/미연결 시 caris.ts 기본값 폴백.
import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

export type FeeMap = Record<string, number>

// 트랙·급수 → 요금 키. Pro='pro', Master=`master_${gradeCode}`(g4..g1).
export function feeKey(isMaster: boolean, gradeCode: string): string {
  return isMaster ? `master_${gradeCode}` : 'pro'
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
