// 시험 일정/회차 — DB(exam_rounds)에서 로드해 현재 언어로 투영 + 접수상태/날짜 계산.
// Guide(히어로 일정 패널)와 /plan(회차 목록)이 공유.
//
// ⚠️ 2026-09-04 에 **상시(rolling) 회차를 없앴다.** 회차는 이제 정기 하나뿐이라 kind 컬럼이 사라졌고,
//    회차 안내문(note_i18n)·수동 정렬순서(sort)도 같이 뺐다(둘 다 값을 넣은 회차가 하나도 없었고,
//    sort 는 정렬 3순위라 앞의 접수일·시험일이 같아야 도달하는데 그런 회차가 없어 한 번도 안 걸렸다).
import { useEffect, useMemo, useState } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'
import type { Lang } from './i18n'

interface RawRound {
  id: string
  title_i18n: Record<string, string> | null
  exam_date: string | null
  apply_start_at: string | null
  apply_end_at: string | null
  // 응시 창(정기시험). 월 규칙이면 그 달 11~20일. 없으면 exam_date 하루짜리 회차(월 규칙 이전 회차).
  exam_start_at: string | null
  exam_end_at: string | null
  open_tiers: string[] | null
}

export type RoundStatus = 'open' | 'upcoming' | 'closed'

export interface RoundView {
  id: string
  title: string
  // 응시 기간 "MM. DD ~ MM. DD"(창이 없는 옛 회차는 그 하루)
  // ⚠️ '시험일 하루'가 아니다 — 월 규칙에서 응시는 11~20일 열흘이라 하루를 뽑으면 거짓말이 된다.
  dateText: string
  applyText: string // 접수기간 "YYYY. MM. DD ~ YYYY. MM. DD" / 미설정: ''
  // 원본 날짜(ISO). /plan 이 접수중 회차의 채점·발표 구간을 계산해 쓴다 — 포맷된 문자열을 되파싱하지 않도록.
  applyStartAt: string | null
  applyEndAt: string | null
  examStartAt: string | null
  examEndAt: string | null
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

// 접수기간(timestamptz) → 요일 없는 짧은 날짜 (범위 표기용). /plan 의 일정 표도 같은 표기를 쓴다.
export function fmtShort(iso: string, lang: Lang): string {
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

// 응시 기간 표기. 창(11~20일)이 있으면 범위로, 없으면(옛 회차) 시험일 하루로.
function examText(r: RawRound, lang: Lang): string {
  if (r.exam_start_at && r.exam_end_at) {
    return `${fmtShort(r.exam_start_at, lang)} ~ ${fmtShort(r.exam_end_at, lang)}`
  }
  return r.exam_date ? fmtDate(r.exam_date, lang) : ''
}

// 접수 상태 — 접수기간(now) 기준.
function statusOf(r: RawRound): RoundStatus {
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
        .select('id, title_i18n, exam_date, apply_start_at, apply_end_at, exam_start_at, exam_end_at, open_tiers')
        .eq('published', true)
        // 접수 시작일 오름차순(= 지금 신청할 수 있는 것부터). /plan 은 접수하러 오는 페이지라
        // '언제부터 신청하나' 가 줄 세우는 기준이다.
        // ⚠️ 시험일(exam_date) 순이 아니다 — 정기시험끼리는 두 기준이 같은 순서지만, 접수를 길게 여는
        //    회차(구성원 테스트처럼 몇 년짜리)는 시험일 순으로 두면 지금 접수중인데도 맨 뒤에 선다.
        // 접수일이 없는(미설정) 회차는 뒤로 민다.
        .order('apply_start_at', { ascending: true, nullsFirst: false })
        .order('exam_date', { ascending: true, nullsFirst: false })
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
    // 시험일이 지난 회차는 목록에서 제외(접수 페이지에 끝난 시험을 쌓지 않음).
    // 접수만 마감(시험일 전)인 회차는 '마감'으로 계속 노출.
    // 자정 경계 흔들림 방지: 오늘 00:00 을 지난 것만 과거로 판정.
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    // ⚠️ 끝을 정하는 건 **응시 창의 끝**이다. exam_date(대표일)로만 보면 월 규칙 회차가 20일 다음날
    //    사라지는 건 같지만, 대표일을 첫날로 바꾸는 순간 응시 기간 도중에 목록에서 없어진다.
    const isPastExam = (r: RawRound) => {
      const end = r.exam_end_at
        ? Date.parse(r.exam_end_at)
        : r.exam_date
          ? Date.parse(`${r.exam_date}T23:59:59`)
          : NaN
      return !Number.isNaN(end) && end < todayStart.getTime()
    }
    return raw
      .filter((r) => !isPastExam(r))
      .map((r) => {
        const status = statusOf(r)
        return {
          id: r.id,
          title: pick(r.title_i18n),
          dateText: examText(r, lang),
          applyText: fmtApply(r, lang),
          applyStartAt: r.apply_start_at,
          applyEndAt: r.apply_end_at,
          examStartAt: r.exam_start_at,
          examEndAt: r.exam_end_at,
          status,
          clickable: status === 'open',
          openTiers: r.open_tiers ?? [],
          // clickable 과 일부러 분리해 둔다 — clickable 은 '카드를 눌러 접수화면으로 갈 수 있는가'(/plan),
          // sellable 은 '거기서 결제까지 갈 수 있는가'다. 상시 회차가 없어진 지금은 두 값이 같지만,
          // 판매만 막아야 하는 회차(문항 미등록 등)가 생기면 갈라지는 자리라 이름을 남겨 둔다.
          sellable: status === 'open',
        }
      })
  }, [raw, lang])

  return { regular: views, loading }
}
