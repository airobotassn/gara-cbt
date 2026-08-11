// 정책 문서(이용약관·개인정보처리방침·협회소개) — 관리자가 저장한 최신판을 사용자 화면이 읽는다.
//
// ⚠️ 관리자에서 고쳐도 화면이 코드 본문을 그대로 보여주면 "저장은 되는데 반영이 안 되는" 상태가 된다.
//    그래서 화면은 **DB 판이 있으면 그걸**, 없으면 기존 코드 본문을 그대로 보여준다(둘 다 있는 상태를 견딘다).
// ⚠️ `policy_docs` 는 시행일이 지난 판만 공개 정책으로 읽힌다 — 미리 써둔 개정판은 시행일 전까지 안 보인다.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type PolicyDoc = 'terms' | 'privacy' | 'about'
export interface PolicyView { body: string; version: number; effectiveAt: string }

/** 지금 시행 중인 판. 없으면 null(그럼 화면이 코드 본문을 쓴다). */
export function usePolicyDoc(doc: PolicyDoc): PolicyView | null | undefined {
  // undefined = 아직 확인 중 · null = 등록된 판 없음
  const [v, setV] = useState<PolicyView | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    supabase
      .from('policy_docs')
      .select('body, version, effective_at')
      .eq('doc', doc)
      .order('effective_at', { ascending: false })
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setV(data ? { body: (data as any).body, version: (data as any).version, effectiveAt: (data as any).effective_at } : null)
      })
    return () => { alive = false }
  }, [doc])
  return v
}
