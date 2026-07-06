// 시험 일정/회차 — DB(exam_rounds)에서 로드해 현재 언어로 투영 + 접수상태/날짜 계산.
// Guide(히어로 일정 패널)와 ExamSchedule(정기·상시 목록)이 공유.
import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import type { Lang } from './i18n'

interface RawRound {
  id: string
  kind: 'regular' | 'rolling'
  title_i18n: Record<string, string> | null
  exam_date: string | null
  apply_start_at: string | null
  apply_end_at: string | null
  note_i18n: Record<string, string> | null
  sort: number
}

export type RoundStatus = 'open' | 'upcoming' | 'closed'

export interface RoundView {
  id: string
  kind: 'regular' | 'rolling'
  title: string
  note: string
  dateText: string // 정기: 시험일(언어별 포맷) / 상시: ''
  applyText: string // 접수기간 "YYYY. MM. DD ~ YYYY. MM. DD" / 상시·미설정: ''
  status: RoundStatus
  clickable: boolean // 접수중일 때만 원서접수로 이동
}

// 우리 언어코드 → BCP-47 (Intl 날짜 포맷용)
const LOCALE: Record<string, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
  hi: 'hi-IN',
  vi: 'vi-VN',
}

function fmtDate(ymd: string, lang: Lang): string {
  try {
    const d = new Date(`${ymd}T00:00:00`)
    return new Intl.DateTimeFormat(LOCALE[lang] ?? 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).format(d)
  } catch {
    return ymd
  }
}

// 접수기간(timestamptz) → 요일 없는 짧은 날짜 (범위 표기용)
function fmtShort(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(LOCALE[lang] ?? 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

// 접수기간 표기: 양끝 다 있으면 "start ~ end", 한쪽만 있으면 그쪽만, 없으면 ''(상시·미설정)
function fmtApply(r: RawRound, lang: Lang): string {
  const s = r.apply_start_at ? fmtShort(r.apply_start_at, lang) : ''
  const e = r.apply_end_at ? fmtShort(r.apply_end_at, lang) : ''
  if (s && e) return `${s} ~ ${e}`
  if (e) return `~ ${e}`
  if (s) return `${s} ~`
  return ''
}

// 접수 상태: 상시는 항상 open, 정기는 접수기간(now) 기준.
function statusOf(r: RawRound): RoundStatus {
  if (r.kind === 'rolling') return 'open'
  const now = Date.now()
  const s = r.apply_start_at ? Date.parse(r.apply_start_at) : NaN
  const e = r.apply_end_at ? Date.parse(r.apply_end_at) : NaN
  if (!Number.isNaN(s) && now < s) return 'upcoming'
  if (!Number.isNaN(e) && now > e) return 'closed'
  if (!Number.isNaN(s) || !Number.isNaN(e)) return 'open'
  return 'upcoming' // 접수기간 미설정 → 예정
}

export function useExamRounds(lang: Lang) {
  const [raw, setRaw] = useState<RawRound[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!isSupabaseConfigured) {
        if (alive) setLoading(false)
        return
      }
      const { data } = await supabase
        .from('exam_rounds')
        .select('id, kind, title_i18n, exam_date, apply_start_at, apply_end_at, note_i18n, sort')
        .eq('published', true)
        .order('sort', { ascending: true })
        .order('exam_date', { ascending: true, nullsFirst: true })
      if (!alive) return
      setRaw((data as RawRound[] | null) ?? [])
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const views = useMemo<RoundView[]>(() => {
    const pick = (m: Record<string, string> | null) => m?.[lang] ?? m?.ko ?? ''
    // 시험일이 지난 정기 회차는 목록에서 제외(접수 페이지에 끝난 시험을 쌓지 않음).
    // 접수만 마감(시험일 전)인 회차는 '마감'으로 계속 노출. 상시(exam_date 없음)는 항상 유지.
    // 자정 경계 흔들림 방지: 오늘 00:00 을 지난 것만 과거로 판정.
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const isPastExam = (r: RawRound) => {
      if (!r.exam_date) return false
      const d = Date.parse(`${r.exam_date}T23:59:59`)
      return !Number.isNaN(d) && d < todayStart.getTime()
    }
    return raw
      .filter((r) => !isPastExam(r))
      .map((r) => {
        const status = statusOf(r)
        return {
          id: r.id,
          kind: r.kind,
          title: pick(r.title_i18n),
          note: pick(r.note_i18n),
          dateText: r.exam_date ? fmtDate(r.exam_date, lang) : '',
          applyText: fmtApply(r, lang),
          status,
          clickable: status === 'open',
        }
      })
  }, [raw, lang])

  return {
    regular: views.filter((r) => r.kind === 'regular'),
    rolling: views.filter((r) => r.kind === 'rolling'),
    loading,
  }
}
