// 관리자 화면 공용 데이터 훅 — 화면마다 같은 로딩/에러 처리를 베끼지 않으려고 뺐다.
//   ⚠️ 컴포넌트 파일이 아니라 여기 있는 이유: 컴포넌트 파일이 훅·상수까지 export 하면
//      Vite 의 fast refresh 가 그 파일 전체를 다시 마운트해 편집 중 상태가 날아간다.
import { useCallback, useEffect, useState } from 'react'
import { callFunction } from './supabase'

export function useAdminData<T>(action: string, params?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  // ⚠️ params 를 그대로 deps 에 넣으면 객체가 매 렌더 새로 만들어져 무한 루프가 된다 → 문자열로 접는다.
  const key = JSON.stringify(params ?? {})
  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      setData(await callFunction<T>('admin', { action, ...JSON.parse(key) }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [action, key])
  useEffect(() => { load() }, [load])
  return { data, loading, err, reload: load, setData }
}

// 결제 상태 표기 — ⚠️ 화면에 `paid`·`pending` 같은 영문 코드를 그대로 내보내지 않는다.
//   이 화면을 보는 사람은 개발자가 아니라 사무 담당자다. 뜻이 안 통하면 문의가 관리자에게 온다.
export const PAY_STATUS_LABEL: Record<string, string> = {
  paid: '결제 완료',
  pending: '결제 진행 중',
  confirming: '승인 확인 중',
  waiting_deposit: '입금 대기',
  refunded: '환불 완료',
  canceled: '결제 취소',
  failed: '결제 실패',
  expired: '기한 만료',
}
export const payStatusLabel = (s: string) => PAY_STATUS_LABEL[s] ?? s
export const productLabel = (t: string) => (t === 'exam' ? '응시료' : t === 'cert' ? '자격증 발급비' : '이북')

/** 관리자 화면 공용 날짜 표기(KST). */
export function fmtAdminDT(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
