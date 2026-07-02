import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callFunction } from '../lib/supabase'
import type { MyAttempt } from '../lib/types'

// SEB(별도 앱)와 이 브라우저 탭은 서로 대화를 못 한다. 그래서 창 focus/visibility 같은 곁가지 신호로
// "SEB 끝남"을 추측하면 팝업 취소·탭 전환에도 오발동한다. 유일하게 믿을 신호는 서버 상태다:
//   "이 브라우저(로그인 유저) 명의로 '새로 끝난 응시'가 생겼는가" → 생겼다면 SEB 에서 실제로 시험이 끝난 것.
// armReturn(): SEB 실행 직전 호출 — 현재 끝난 응시 id 를 기준선으로 저장하고 대기 시작.
// 대기 중엔 my-attempts 를 주기적으로 + 탭 복귀 시 확인해, 기준선에 없던 완료 응시가 보이면 홈으로 이동.
const KEY = 'examSebWait' // localStorage: { at:number, finished:string[] }
const TTL_MS = 4 * 60 * 60 * 1000 // 응시 TTL(240분)과 맞춤 — 오래된 마커는 폐기
const POLL_MS = 5000

export function useSebReturn() {
  const navigate = useNavigate()
  const [waiting, setWaiting] = useState(false)

  // 새로고침 등으로 재진입해도 대기 상태 복구(오래된 마커는 폐기)
  useEffect(() => {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    try {
      const w = JSON.parse(raw) as { at?: number }
      if (!w?.at || Date.now() - w.at > TTL_MS) {
        localStorage.removeItem(KEY)
        return
      }
      setWaiting(true)
    } catch {
      localStorage.removeItem(KEY)
    }
  }, [])

  // 대기 중: 서버에 '기준선에 없던 끝난 응시'가 생겼는지 확인 → 있으면(=SEB 에서 실제 종료) 홈으로.
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    const check = async () => {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      let w: { at: number; finished: string[] }
      try {
        w = JSON.parse(raw)
      } catch {
        localStorage.removeItem(KEY)
        setWaiting(false)
        return
      }
      if (Date.now() - w.at > TTL_MS) {
        localStorage.removeItem(KEY)
        setWaiting(false)
        return
      }
      try {
        const { attempts } = await callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
        const baseline = new Set(w.finished ?? [])
        const done = (attempts ?? []).find(
          (a) => a.status !== 'in_progress' && !baseline.has(a.attemptId),
        )
        if (done && !stopped) {
          localStorage.removeItem(KEY)
          setWaiting(false)
          navigate('/')
        }
      } catch {
        /* 네트워크 일시 오류 — 다음 확인에서 재시도 */
      }
    }
    const id = window.setInterval(check, POLL_MS)
    const onVis = () => {
      if (!document.hidden) check()
    }
    document.addEventListener('visibilitychange', onVis)
    check()
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [waiting, navigate])

  // SEB 실행 직전 호출: 현재 끝난 응시를 기준선으로 저장 후 대기 시작.
  // (로그인 안 됐거나 조회 실패하면 자동 복귀를 포기 — 오발동보다 낫다.)
  const armReturn = useCallback(async () => {
    try {
      const { attempts } = await callFunction<{ attempts: MyAttempt[] }>('my-attempts', {})
      const finished = (attempts ?? [])
        .filter((a) => a.status !== 'in_progress')
        .map((a) => a.attemptId)
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), finished }))
      setWaiting(true)
    } catch {
      /* 로그인 안 됨/조회 실패 → 자동 복귀 생략 */
    }
  }, [])

  return { waiting, armReturn }
}
