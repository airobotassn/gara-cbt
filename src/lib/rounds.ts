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
  open_tiers: string[] | null
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
  // 이 회차가 연 급수(exam_tiers.tier 키). 빈 배열 = 아직 아무 급수도 안 열린 회차.
  // ⚠️ exams 는 RLS 정책 0개라 프론트가 못 읽는다 → 관리자(syncRoundExams)가 exam_rounds.open_tiers 에
  //    비정규화해 둔 값을 그대로 읽는다. 화면 표시용이고 판매 가능 판정의 정본은 서버(resolveExamOffer)다.
  openTiers: string[]
  // 응시권을 팔 수 있는 회차인가(표시용).
  // ⚠️ 상시(rolling)는 statusOf 가 항상 'open' 을 주지만 **응시권을 팔지 않는다**(2026-08 결정).
  //    정기시험은 접수(1~10일)·응시(11~20일) 창이 있어야 응시권 만료 기준이 서는데 상시엔 그 창이 없다.
  //    기존 rolling 행·표시 코드는 그대로 두고 결제 진입만 막는다.
  sellable: boolean
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
// ⚠️ 상시의 'open' 은 '늘 열려 있는 안내'라는 뜻이지 결제 가능이 아니다 — 판매 여부는 sellable 을 볼 것.
//    이 함수를 고치면 /plan 의 상태 배지 문구까지 같이 바뀌므로 판매 판정은 여기 얹지 않았다.
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
        .select('id, kind, title_i18n, exam_date, apply_start_at, apply_end_at, note_i18n, open_tiers, sort')
        .eq('published', true)
        // 정기시험은 시험일 오름차순(가까운 순). 상시(exam_date=null)는 뒤로 밀고 sort로 정렬.
        .order('exam_date', { ascending: true, nullsFirst: false })
        .order('sort', { ascending: true })
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
          openTiers: r.open_tiers ?? [],
          // clickable 과 일부러 분리했다 — clickable 은 '카드를 눌러 접수화면으로 갈 수 있는가'(/plan),
          // sellable 은 '거기서 결제까지 갈 수 있는가'다. 정기 회차에선 둘이 같지만 상시에선 갈린다.
          sellable: r.kind === 'regular' && status === 'open',
        }
      })
  }, [raw, lang])

  return {
    regular: views.filter((r) => r.kind === 'regular'),
    rolling: views.filter((r) => r.kind === 'rolling'),
    loading,
  }
}
