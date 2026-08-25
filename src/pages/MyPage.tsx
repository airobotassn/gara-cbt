import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import type { EbookListResp, EbookRow, MyAttempt, MyAttemptsResponse, ServerLecture } from '../lib/types'
import EbookCover from '../components/EbookCover'
import {
  BookRow,
  LectureRow,
  LibraryFrame,
  PaneEmpty,
  Pager,
  type LibGroup,
} from '../components/LearningLibrary'
import { ANY_COLOR, COVER_COLORS } from '../lib/coverColors'
import { getTracks, TIER_COLORS } from '../lib/caris'
import InquiryBoard from '../components/InquiryBoard'
import { useInquiryAlert } from '../lib/inquiryAlert'
import { certNoPending, gradeOfTitle, gradeDisplay, certExpiryDate } from '../lib/certNo'
import { countryName, countryOptions } from '../lib/regions'
import { loadRegionIndex, loadRegions, type RegionOption } from '../lib/regionCatalog'
import { NICK_MAX, NICK_MIN, nicknameError } from '../lib/nickname'
import { krw } from '../lib/money'
import {
  ticketExamPeriodText,
  ticketReasonText,
  ticketSourceKey,
  ticketStatusKey,
  tierDisplay,
  type ExamTicketView,
} from '../lib/tickets'
import type { Lang, TFunc } from '../lib/i18n'

// gara_5 (마이페이지) 목업 디자인 그대로 + 실제 응시 데이터·탭·발급·로그인 게이트 로직 보존.
// 원본: stitch_design_critique_assistant/gara_5/code.html
// primary 는 전역 토큰 사용(라이트 #004ac6 / 다크 #7aa9ff) — 페이지별 오버라이드 제거.

// 탭 순서 = 화면에 보이는 순서. 첫 탭(이북 서재)이 /mypage 기본 화면이다.
//   ⚠️ 옛 첫 탭 '학습 대시보드'는 2026-08-25 에 통째로 찢겨나갔다 — 레벨테스트 몫(최고레벨·누적응시·
//      평균정답률·영역 밸런스·승급 기록)은 `/test/record`, 활동 기록 달력은 `/hub`(스탬프판 → 출석 기록),
//      랭킹 추이는 `/ranking` 으로 갔다. 여기(CARIS 자격검정 마이페이지)에 레벨테스트 화면이 얹혀 있던
//      것이 애초에 어긋난 자리였다. 되살릴 거면 그 세 자리부터 확인할 것 — 되돌리면 같은 말이 두 곳에 선다.
//   ⚠️ '시험 응시 현황'은 그보다 더 예전의 기본 탭이라 /mypage 였다(지금은 /mypage/attempts).
const TABS = [
  { key: 'ebooks', labelKey: 'mypage.tab_ebooks', to: '/mypage' },
  { key: 'attempts', labelKey: 'mypage.tab_attempts', to: '/mypage/attempts' },
  { key: 'earned', labelKey: 'mypage.tab_earned', to: '/mypage/earned' },
  { key: 'issuance', labelKey: 'mypage.tab_issuance', to: '/mypage/issuance' },
  { key: 'inquiry', labelKey: 'mypage.tab_inquiry', to: '/mypage/inquiry' },
]

function fmtDT(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`
}
function daysLeft(iso?: string | null) {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000))
}
/**
 * 아직 발급하지 않은 응시의 자격번호 표기 — 일련번호 자리를 가린 형태(`CA-PRO-2026-••••••`).
 * 진짜 번호는 발급 순간 서버가 채번하므로(certNo.ts 주석 참고) 그 전에는 만들어 보여주지 않는다.
 * 발급된 건은 호출부가 `a.certNo`(서버 확정값)를 먼저 쓴다.
 */
function certNoOf(a: MyAttempt) {
  const year = (a.submittedAt ? new Date(a.submittedAt).getFullYear() : 0) || new Date().getFullYear()
  return certNoPending(gradeOfTitle(a.examTitle), year)
}

// 상태 → 카드 비주얼
function statusInfo(a: MyAttempt) {
  if (a.status === 'expired' || a.status === 'voided') {
    return { icon: 'event_busy', wrap: 'bg-outline/10 border-outline/20', color: 'text-outline', badge: a.status === 'voided' ? 'Voided' : 'Expired', badgeClass: 'bg-error/10 text-error border-error/20', greyed: true }
  }
  if (a.status === 'submitted' && a.released) {
    return { icon: 'task', wrap: 'bg-secondary/10 border-secondary/20', color: 'text-secondary', badge: 'Completed', badgeClass: 'bg-secondary/10 text-secondary border-secondary/20', greyed: false }
  }
  return { icon: 'description', wrap: 'bg-primary/10 border-primary/20', color: 'text-primary', badge: a.status === 'in_progress' ? 'In progress' : 'Scoring', badgeClass: 'bg-primary/10 text-primary border-primary/20', greyed: false }
}

// 내 정보 — 국가/지역(읽기전용, 락).
//   ⚠️ 학교(school_id) 입력 UI 는 제거됨(2026-07-28). DB 컬럼·schools 테이블·school_leaderboard RPC 는 남아있고,
//      랭킹의 학교 탭도 숨김 상태(Ranking.tsx) — 되살리려면 이 섹션에 자동완성 입력을 다시 붙이면 된다.
function ProfileSection() {
  const { user, applyRegion } = useAuth()
  const { t, lang } = useT()
  const [profile, setProfile] = useState<{
    country_code: string | null
    region_code: string | null
    display_name: string | null
    nickname_changed_at: string | null
    region_locked_at: string | null
    region_changed_at: string | null
  } | null>(null)
  // 닉네임 변경 — 평생 1회. 서버(set-nickname)가 최종 판정하고 여기선 UI 상태만 잡는다.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [nickErr, setNickErr] = useState('')
  // 국가·지역 변경 — 이것도 평생 1회(닉네임과 같은 성격). 판정은 서버 RPC 한 문장이 한다.
  const [geoEditing, setGeoEditing] = useState(false)
  const [geoCountry, setGeoCountry] = useState('')
  const [geoRegion, setGeoRegion] = useState('')
  const [geoSaving, setGeoSaving] = useState(false)
  const [geoErr, setGeoErr] = useState('')

  // 프로필(국가/지역/닉네임) 로딩
  useEffect(() => {
    if (!user) return
    let alive = true
    supabase
      .from('profiles')
      .select('country_code,region_code,display_name,nickname_changed_at,region_locked_at,region_changed_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setProfile(data ?? null)
      })
    return () => {
      alive = false
    }
  }, [user?.id])

  // 지역 목록·이름은 아레나 지도 파일에서 온다(regionCatalog) — 지역 이름을 여기서 다시 만들지 않는다.
  const [regionIndex, setRegionIndex] = useState<Record<string, number> | null>(null)
  const [geoRegionList, setGeoRegionList] = useState<RegionOption[]>([])
  const [savedRegionName, setSavedRegionName] = useState('')
  useEffect(() => {
    let alive = true
    loadRegionIndex().then((idx) => { if (alive) setRegionIndex(idx) })
    return () => { alive = false }
  }, [])
  // 지금 저장돼 있는 지역의 표시 이름(고르는 목록과 별개 — 나라를 바꾸는 중에도 원래 값이 보여야 한다).
  useEffect(() => {
    let alive = true
    const { country_code: c, region_code: r } = profile ?? {}
    if (!c || !r) { setSavedRegionName(''); return }
    loadRegions(c, lang).then((list) => {
      if (alive) setSavedRegionName(list.find((x) => x.code === r)?.name ?? r)
    })
    return () => { alive = false }
  }, [profile?.country_code, profile?.region_code, lang])
  // 편집 중 고른 나라의 지역 목록.
  useEffect(() => {
    let alive = true
    if (!geoEditing || !geoCountry || !regionIndex?.[geoCountry]) { setGeoRegionList([]); return }
    loadRegions(geoCountry, lang).then((list) => { if (alive) setGeoRegionList(list) })
    return () => { alive = false }
  }, [geoEditing, geoCountry, lang, regionIndex])

  const countryLabel = profile?.country_code ? countryName(profile.country_code, lang) : '-'
  // 지역 데이터가 없는 나라는 지역이 비어 있는 게 정상이다 — '-' 로 두고 없는 칸처럼 보이게 한다.
  const regionLabel = savedRegionName || '-'
  const nickUsed = !!profile?.nickname_changed_at // 변경권 소진
  const geoNeedRegion = !!regionIndex && !!regionIndex[geoCountry]
  const geoList = countryOptions(lang, profile?.country_code ?? null)
  // 확정 전(온보딩을 아직 안 지난 회원)에는 변경 버튼을 띄우지 않는다 — 그 경로는 온보딩 소관이고,
  // 서버 RPC 도 region_locked_at 이 있는 행만 고친다.
  const geoLocked = !!profile?.region_locked_at
  const geoUsed = !!profile?.region_changed_at

  async function saveGeo() {
    if (geoSaving || !geoCountry || (geoNeedRegion && !geoRegion)) return
    setGeoSaving(true)
    setGeoErr('')
    try {
      await callFunction('set-region', {
        action: 'change',
        country_code: geoCountry,
        region_code: geoNeedRegion ? geoRegion : '',
      })
      setProfile((p) => (p ? {
        ...p,
        country_code: geoCountry,
        region_code: geoNeedRegion ? geoRegion : null,
        region_changed_at: new Date().toISOString(),
      } : p))
      // ⚠️ 컨텍스트도 같이 갱신한다 — 랭킹 탭 라벨과 아레나 '우리 순위'가 이 값을 본다.
      //    빼먹으면 이 화면만 새 나라로 바뀌고 다른 화면은 새로고침 전까지 옛 나라를 가리킨다.
      applyRegion(geoCountry, geoNeedRegion ? geoRegion : null)
      setGeoEditing(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setGeoErr(t(/change_unavailable|409/.test(msg) ? 'mypage.region_change_used' : 'nick.err_failed'))
    } finally {
      setGeoSaving(false)
    }
  }

  async function saveNick() {
    const v = draft.trim()
    if (saving || nicknameError(v)) return
    setSaving(true)
    setNickErr('')
    try {
      await callFunction('set-nickname', { nickname: v })
      setProfile((p) => (p ? { ...p, display_name: v, nickname_changed_at: new Date().toISOString() } : p))
      setEditing(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const code = /taken/.test(msg) ? 'taken' : /reserved/.test(msg) ? 'reserved' : /locked/.test(msg) ? 'locked' : 'failed'
      setNickErr(t(`nick.err_${code}`))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant/30 ambient-shadow mb-8 md:mb-10">
      <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.profile_title')}</h2>

      {/* 닉네임 — 유일한 변경 진입점(FAB 편집은 제거됨). 변경권 1회를 다 쓰면 잠긴다. */}
      <div className="mb-4">
        <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5">{t('nick.label')}</label>
        {editing ? (
          <>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-xl bg-surface border border-outline-variant px-4 py-3 font-body-md text-on-surface"
                value={draft}
                autoFocus
                maxLength={NICK_MAX}
                disabled={saving}
                onChange={(e) => { setDraft(e.target.value); setNickErr('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') saveNick(); if (e.key === 'Escape') setEditing(false) }}
              />
              <button
                onClick={saveNick}
                disabled={saving || !!nicknameError(draft)}
                className="px-5 py-3 rounded-xl bg-primary-container text-on-primary font-label-md text-[15px] font-bold disabled:opacity-40"
              >
                {saving ? t('nick.saving') : t('nick.confirm')}
              </button>
              <button
                onClick={() => { setEditing(false); setNickErr('') }}
                className="px-4 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-label-md text-[15px] font-bold"
              >
                {t('intro.cancel')}
              </button>
            </div>
            <p className="mt-2 font-body-sm text-[13px] text-outline break-keep">{t('nick.rule', { min: NICK_MIN, max: NICK_MAX })}</p>
            <p className="mt-1 font-body-sm text-[13px] text-error font-bold break-keep">{t('nick.last_chance')}</p>
            {(nickErr || (draft && nicknameError(draft))) && (
              <p className="mt-1 font-body-sm text-[13px] text-error break-keep">
                {nickErr || t(`nick.err_${nicknameError(draft)}`)}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px] rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface">
              {profile?.display_name || '-'}
            </div>
            {nickUsed ? (
              <span className="font-body-sm text-[13px] text-outline flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">lock</span>
                {t('nick.used_up')}
              </span>
            ) : (
              <button
                onClick={() => { setDraft(profile?.display_name ?? ''); setEditing(true) }}
                className="px-5 py-3 rounded-xl border border-outline-variant text-on-surface font-label-md text-[15px] font-bold hover:border-primary hover:text-primary transition-colors"
              >
                {t('nick.change_once')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 국가·지역 — 평생 1회 변경. 닉네임과 같은 자리·같은 규칙이라 생김새도 맞춘다. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-2">
        <div>
          <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5" htmlFor={geoEditing ? 'mp-country' : undefined}>{t('onboarding.country')}</label>
          {geoEditing ? (
            <select
              id="mp-country"
              className="w-full rounded-xl bg-surface border border-outline-variant px-4 py-3 font-body-md text-on-surface"
              value={geoCountry}
              // 나라를 바꾸면 지역을 비운다 — 안 비우면 옛 나라의 지역이 남아 서버가 거절한다.
              onChange={(e) => { setGeoCountry(e.target.value); setGeoRegion(''); setGeoErr('') }}
              disabled={geoSaving}
            >
              {geoList.pinned && <option value={geoList.pinned.code}>{geoList.pinned.name}</option>}
              {geoList.rest.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          ) : (
            <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface-variant select-none">{countryLabel}</div>
          )}
        </div>
        <div>
          <label className="block font-label-md text-[13px] font-semibold text-outline mb-1.5" htmlFor={geoEditing && geoNeedRegion ? 'mp-region' : undefined}>{t('onboarding.region')}</label>
          {geoEditing ? (
            geoNeedRegion ? (
              <select
                id="mp-region"
                className="w-full rounded-xl bg-surface border border-outline-variant px-4 py-3 font-body-md text-on-surface"
                value={geoRegion}
                onChange={(e) => { setGeoRegion(e.target.value); setGeoErr('') }}
                disabled={geoSaving || !geoRegionList.length}
              >
                <option value="" disabled>{t('onboarding.region')}</option>
                {geoRegionList.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            ) : (
              // 지역 목록이 없는 나라 — 고를 게 없다는 걸 빈 셀렉트가 아니라 문장으로 말한다.
              <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-outline select-none break-keep">
                {t('mypage.region_none')}
              </div>
            )
          ) : (
            <div className="w-full rounded-xl bg-surface-container-low border border-outline-variant/40 px-4 py-3 font-body-md text-on-surface-variant select-none">{regionLabel}</div>
          )}
        </div>
      </div>

      {geoEditing ? (
        <>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={saveGeo}
              disabled={geoSaving || !geoCountry || (geoNeedRegion && !geoRegion)}
              className="px-5 py-3 rounded-xl bg-primary-container text-on-primary font-label-md text-[15px] font-bold disabled:opacity-40"
            >
              {geoSaving ? t('nick.saving') : t('nick.confirm')}
            </button>
            <button
              onClick={() => { setGeoEditing(false); setGeoErr('') }}
              className="px-4 py-3 rounded-xl border border-outline-variant text-on-surface-variant font-label-md text-[15px] font-bold"
            >
              {t('intro.cancel')}
            </button>
          </div>
          <p className="mt-2 font-body-sm text-[13px] text-error font-bold break-keep">{t('mypage.region_change_warn')}</p>
          {geoErr && <p className="mt-1 font-body-sm text-[13px] text-error break-keep">{geoErr}</p>}
        </>
      ) : geoLocked && !geoUsed ? (
        <button
          onClick={() => {
            setGeoCountry(profile?.country_code ?? '')
            setGeoRegion(profile?.region_code ?? '')
            setGeoErr('')
            setGeoEditing(true)
          }}
          className="px-5 py-3 rounded-xl border border-outline-variant text-on-surface font-label-md text-[15px] font-bold hover:border-primary hover:text-primary transition-colors"
        >
          {t('mypage.region_change_once')}
        </button>
      ) : (
        <p className="font-body-sm text-[13px] text-outline flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">lock</span>
          {geoUsed ? t('mypage.region_change_used') : t('mypage.region_locked')}
        </p>
      )}
    </section>
  )
}

// 보유 응시권 한 장.
//   ⚠️ 응시 카드(아래 attempts)와 **같은 급의 크기**로 만든다. "장수가 늘어날 테니 작게" 는 금지 —
//      개수는 스크롤이 푸는 문제다(2026-08-06 반려 사유 두 건이 정확히 이거다). 11~13px 잔글씨도 금지.
//   ⚠️ 쓸 수 있는지(usable)와 그 이유는 **서버 판정을 그대로 표시만** 한다. 시험일을 브라우저에서 다시
//      비교하면 KST 기준 판정과 최대 9시간 어긋난다(lib/tickets.ts 머리 주석 참고).
function TicketCard({ tk, t, lang, onGo, onCheck }: {
  tk: ExamTicketView; t: TFunc; lang: Lang; onGo: () => void; onCheck: () => void
}) {
  const dead = tk.status === 'void' || tk.status === 'expired'
  const statusKey = ticketStatusKey(tk.status)
  const sourceKey = ticketSourceKey(tk.source)
  const reason = ticketReasonText(tk, t, lang)
  // 진행 중인 응시도 버튼을 남긴다 — 돌아갈 길이 화면에 없으면 사용자가 갇힌다(서버는 새 응시를 막을 뿐이다).
  const canGo = tk.usable || tk.usableReason === 'in_progress'

  return (
    <article
      className={`bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${dead ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start gap-5 flex-1">
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 border ${dead ? 'bg-outline/10 border-outline/20' : 'bg-primary/10 border-primary/20'}`}>
          <span className={`material-symbols-outlined text-[28px] ${dead ? 'text-outline' : 'text-primary'}`} style={{ fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
            <h3 className={`font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold break-keep ${dead ? 'text-on-surface-variant' : 'text-on-surface'}`}>
              {tierDisplay(tk.tier, lang)}
            </h3>
            {/* 상태 배지만 11px 이다 — 바로 아래 응시 카드의 배지와 **같은 값**이어야 한 화면으로 읽힌다.
                본문·보조 문구는 전부 body-md(15~16px)로 유지(잔글씨 반려 이력, CLAUDE.md 2026-08-06). */}
            <span className={`px-3 py-1 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border shrink-0 ${dead ? 'bg-outline/10 text-outline border-outline/20' : 'bg-primary/10 text-primary border-primary/20'}`}>
              {statusKey ? t(statusKey) : tk.status}
            </span>
            {sourceKey && (
              <span className="px-3 py-1 bg-tertiary/10 text-tertiary border border-tertiary/20 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full shrink-0">
                {t(sourceKey)}
              </span>
            )}
          </div>
          {/* 회차명은 그 자체가 '무슨 회차'라 라벨(ticket.round)을 앞에 또 붙이지 않는다.
              응시 기간 라벨은 일정 화면(/plan)과 같은 말이어야 해서 sched.exam_period 를 그대로 쓴다. */}
          <p className="font-body-md text-body-md text-on-surface-variant mb-1">
            {tk.roundTitle} | {t('sched.exam_period')} {ticketExamPeriodText(tk, lang)}
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant mb-3">
            {t('ticket.issued_at')} {fmtDate(tk.issuedAt)}
            {/* 관리자·무료 발급분은 0원이라 금액 자리를 통째로 비운다 — `0원` 은 '무료로 팔았다'로 읽힌다.
                ⚠️ pricePaid 는 **그때 실제로 낸 원화 스냅샷**이다(정가가 달러로 바뀐 뒤에도 그렇다).
                   달러로 환산해 보여주면 안 된다 — 지금 환율로 되돌린 값은 그 사람이 낸 돈이 아니다. */}
            {tk.pricePaid > 0 ? ` | ${t('ticket.price_paid')} ${krw(tk.pricePaid, lang)}` : ''}
          </p>
          {reason && (
            tk.usable ? (
              <p className="font-label-md text-[15px] leading-[22px] text-primary font-semibold flex items-center gap-1.5 bg-primary/5 px-3 py-1.5 rounded-lg w-fit">
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                {reason}
              </p>
            ) : (
              <p className="font-body-md text-body-md text-outline break-keep">{reason}</p>
            )
          )}
        </div>
      </div>
      {canGo && (
        <div className="shrink-0 flex flex-col items-stretch gap-2">
          {/* ⛔ 시험환경 점검을 마치기 전에는 응시 버튼을 열지 않는다.
              잠금 브라우저가 안 켜지는 PC 라는 걸 시험 당일에 알면 손쓸 방법이 없다. */}
          <button
            onClick={onCheck}
            className={`px-6 py-2.5 font-label-md text-[15px] font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border ${
              tk.envChecked
                ? 'border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'
                : 'bg-primary-container text-on-primary border-transparent ambient-shadow hover:bg-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{tk.envChecked ? 'check_circle' : 'monitor_heart'}</span>
            {t(tk.envChecked ? 'ticket.env_done' : 'ticket.env_do')}
          </button>
          <button
            onClick={onGo}
            disabled={!tk.envChecked}
            className={`px-6 py-2.5 font-label-md text-[15px] font-bold rounded-xl transition-colors flex items-center justify-center gap-2 ${
              tk.envChecked
                ? 'bg-primary-container text-on-primary hover:bg-primary ambient-shadow'
                : 'bg-outline/15 text-outline cursor-not-allowed'
            }`}
          >
            {t('ticket.go_exam')}
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </button>
          {!tk.envChecked && (
            <p className="font-body-md text-[13px] text-outline text-center max-w-[220px] break-keep">{t('ticket.env_required')}</p>
          )}
        </div>
      )}
    </article>
  )
}

// 내 서재 — **러닝 라이브러리(/ebooks)와 같은 3열**이다(2026-08-25 요청): 레벨(급수) | E-Book | 강의.
//   차이는 데이터와 버튼뿐이다 — 여기 뜨는 건 **산 것만**이고, 버튼은 구매가 아니라 열기/재생이다.
//   ⚠️ 뼈대·항목 줄은 components/LearningLibrary.tsx 가 단일 출처다. 여기서 다시 그리지 말 것 —
//      두 벌이 되는 순간 한쪽만 고쳐진다(표지 폭·열 배경·좁은 화면 탭에는 전부 반려 이력이 붙어 있다).
//   ⛔ 전체구매 칸은 **없다** — 서재는 파는 곳이 아니다.
//   이북 읽기는 뷰어(/ebooks/read/:id), 강의는 그 자리에서 재생한다(2026-08-25 결정 — 시청 전용 화면을
//   따로 만들면 서재 ↔ 시청 왕복이 생기고, 서재를 벗어날 이유가 없다).
function EbookLibrary() {
  const { t, lang } = useT()
  const navigate = useNavigate()
  const [rows, setRows] = useState<EbookRow[] | null>(null)
  const [lectures, setLectures] = useState<ServerLecture[]>([])
  const [err, setErr] = useState('')
  const [zoom, setZoom] = useState<EbookRow | null>(null)
  // 재생 중인 강의 — 한 번에 하나만(iframe 을 여러 개 띄우면 소리가 겹치고 페이지가 무거워진다).
  const [playing, setPlaying] = useState<string | null>(null)
  const [cat, setCat] = useState<'leveltest' | 'caris'>('leveltest')
  const [levelSel, setLevelSel] = useState('1')
  const [tierSel, setTierSel] = useState('beginner')
  const [bookPageRaw, setBookPage] = useState(0)
  const [lecPageRaw, setLecPage] = useState(0)
  const [pane, setPane] = useState<string>('books')

  useEffect(() => {
    // 화면 언어의 번역본이 있으면 그 제목·표지로 보여준다(없으면 서버가 한국어로 폴백).
    callFunction<EbookListResp>('ebooks', { action: 'library', lang })
      .then((r) => {
        setRows(r.ebooks)
        setLectures(r.lectures ?? [])
        // 산 것이 한쪽 카탈로그에만 있으면 그쪽을 먼저 연다 — 빈 탭으로 시작하지 않는다.
        const hasLevel = r.ebooks.some((b) => b.catalog !== 'caris') || (r.lectures ?? []).some((l) => l.catalog !== 'caris')
        if (!hasLevel) setCat('caris')
      })
      .catch((e) => setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.'))
  }, [lang])

  const catRows = (rows ?? []).filter((b) => b.catalog === cat)
  const catLectures = lectures.filter((l) => l.catalog === cat)

  // 왼쪽 열 — 스토어와 같은 사다리다(산 게 없는 칸도 남긴다. 사다리가 중간에 비면 몇 칸짜리인지부터 헷갈린다).
  const groups: LibGroup[] = cat === 'leveltest'
    ? Array.from({ length: 7 }, (_, i) => i + 1).map((lv) => ({
        key: String(lv),
        label: `Lv.${lv} ${t(`lv.${lv}.name`)}`,
        short: `Lv.${lv}`,
        desc: t(`lv.${lv}.desc`),
        color: COVER_COLORS[lv] ?? ANY_COLOR,
      }))
    : getTracks(lang).flatMap((track) =>
        track.tiers.map((tier) => ({
          key: tier.key,
          label: tier.name,
          short: tier.name,
          desc: tier.target ?? tier.prereq ?? track.name,
          color: TIER_COLORS[tier.key] ?? ANY_COLOR,
        })),
      )
  // '무관'(레벨/급수 없이 산 것)은 있을 때만 세운다 — 항상 있으면 빈 칸이 하나 더 있는 것으로 읽힌다.
  const hasAny = cat === 'leveltest'
    ? catRows.some((b) => b.targetLevel == null) || catLectures.some((l) => l.targetLevel == null)
    : catRows.some((b) => b.targetTier == null) || catLectures.some((l) => l.targetTier == null)
  if (hasAny) {
    groups.push({
      key: 'any',
      label: t(cat === 'caris' ? 'll.any_tier' : 'll.any_level'),
      short: t(cat === 'caris' ? 'll.any_tier' : 'll.any_level'),
      desc: t(cat === 'caris' ? 'll.any_tier_desc' : 'll.any_level_desc'),
      color: ANY_COLOR,
    })
  }

  const sel = cat === 'leveltest' ? levelSel : tierSel
  const setSel = cat === 'leveltest' ? setLevelSel : setTierSel
  const active = groups.find((g) => g.key === sel) ?? groups[0]
  const inGroup = (targetLevel: number | null, targetTier: string | null) =>
    cat === 'leveltest'
      ? (active?.key === 'any' ? targetLevel == null : targetLevel === Number(active?.key))
      : (active?.key === 'any' ? targetTier == null : targetTier === active?.key)

  const books = catRows.filter((b) => inGroup(b.targetLevel, b.targetTier))
  const lecs = catLectures.filter((l) => inGroup(l.targetLevel, l.targetTier))

  // 한 화면에 한 개씩, 나머지는 페이지로 넘긴다(스토어와 같은 규칙).
  //   ⚠️ 페이지 번호는 **clamp 로 접는다** — useEffect 로 0 을 다시 밀면 렌더가 한 번 더 돌고 빈 화면이 스친다.
  const bookPage = Math.min(bookPageRaw, Math.max(0, books.length - 1))
  const lecPage = Math.min(lecPageRaw, Math.max(0, lecs.length - 1))
  const bookPager = books.length > 1 ? <Pager page={bookPage} total={books.length} onGo={setBookPage} t={t} /> : undefined
  const lecPager = lecs.length > 1
    ? <Pager page={lecPage} total={lecs.length} onGo={(p) => { setLecPage(p); setPlaying(null) }} t={t} />
    : undefined

  if (err) return <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>
  if (rows === null) return <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>

  // 아무것도 안 샀으면 3열을 세우지 않는다 — 일곱 칸이 전부 '없어요'인 화면은 안내가 아니라 미로다.
  if (rows.length === 0 && lectures.length === 0) {
    return (
      <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
        <p className="font-body-md text-on-surface-variant mb-5">{t('mypage.empty_ebooks')}</p>
        <button onClick={() => navigate('/ebooks')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">{t('ebook.go_store')}</button>
      </div>
    )
  }

  const storeLink = (
    <button onClick={() => navigate('/ebooks')} className="px-5 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:border-primary/30 hover:text-primary transition-all duration-200">
      {t('ebook.go_store')}
    </button>
  )

  return (
    <>
      {/* 카탈로그 전환 — 스토어와 같은 버튼이다. 산 것이 없는 쪽도 남긴다(구조가 같아야 헷갈리지 않는다). */}
      <div className="mb-4 inline-flex flex-wrap gap-1 rounded-full border border-outline-variant bg-surface-container-low p-1" role="group">
        {(['leveltest', 'caris'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => { setCat(k); setPlaying(null); setBookPage(0); setLecPage(0) }}
            aria-pressed={cat === k}
            className={`rounded-full px-5 py-2.5 font-label-md text-[16px] font-bold tracking-tight transition-colors ${cat === k ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            {k === 'leveltest' ? 'LEVELTEST' : 'CARIS'}
          </button>
        ))}
      </div>

      <LibraryFrame
        groups={groups}
        activeKey={active?.key}
        onPick={(g) => { setSel(g.key); setPlaying(null); setBookPage(0); setLecPage(0) }}
        colTitle={t(cat === 'caris' ? 'll.tier_col' : 'll.level_col')}
        pane={pane}
        onPane={setPane}
        /* ⚠️ 마이페이지는 위에 헤더·탭줄이 더 있어 스토어보다 많이 뺀다 — 위에 뭘 더 얹으면 다시 잴 것. */
        wideMaxH="calc(100dvh - 360px)"
        narrowMaxH="calc(100dvh - 420px)"
        panes={[
          {
            key: 'books',
            title: t('ll.books'),
            body: books.length === 0
              ? <PaneEmpty text={t('ll.empty_owned')} action={storeLink} />
              : (
                <ul className="divide-y divide-outline-variant/70">
                  {books.slice(bookPage, bookPage + 1).map((b) => (
                    <BookRow
                      key={b.id}
                      b={b}
                      t={t}
                      lang={lang}
                      onZoom={() => setZoom(b)}
                      onOpen={() => navigate(`/ebooks/read/${b.id}`)}
                    />
                  ))}
                </ul>
              ),
            pager: bookPager,
          },
          {
            key: 'lectures',
            title: t('ll.lectures'),
            body: lecs.length === 0
              ? <PaneEmpty text={t('ll.empty_owned')} action={storeLink} />
              : (
                <ul className="divide-y divide-outline-variant/70">
                  {lecs.slice(lecPage, lecPage + 1).map((lec) => (
                    <LectureRow
                      key={lec.id}
                      lec={lec}
                      t={t}
                      lang={lang}
                      playing={playing === lec.id}
                      onPlay={() => setPlaying((p) => (p === lec.id ? null : lec.id))}
                    />
                  ))}
                </ul>
              ),
            pager: lecPager,
          },
        ]}
      />

      <div className="mt-6 text-center">{storeLink}</div>

      {/* 표지 확대 — 목록 썸네일은 작아서 표지 글자가 안 읽힌다(스토어와 같은 동작). */}
      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label={zoom.title}
          onClick={() => setZoom(null)}
        >
          {zoom.coverUrl ? (
            <img src={zoom.coverUrl} alt={zoom.title} className="max-h-[92dvh] max-w-[min(100%,620px)] w-auto h-auto rounded-xl shadow-2xl" />
          ) : (
            <div className="w-[min(90vw,360px)]"><EbookCover title={zoom.title} coverUrl={null} className="w-full" /></div>
          )}
        </div>
      )}
    </>
  )
}

export default function MyPage() {
  const navigate = useNavigate()
  const { section } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = section && TABS.some((t) => t.key === section) ? section : 'ebooks'
  const { isFullUser, user, loading: authLoading } = useAuth()
  const { t, lang } = useT()
  // 1:1 문의 새 답변 개수 — 세는 곳은 Layout(FAB) 한 곳이고 여기는 같은 값을 구독만 한다.
  const inquiryAlert = useInquiryAlert()
  const [list, setList] = useState<MyAttempt[] | null>(null)
  const [tickets, setTickets] = useState<ExamTicketView[]>([])
  const [err, setErr] = useState('')
  // 지금 응시할 수 있는 응시권 — 다른 탭에 있어도 이게 있으면 알려준다.
  const openTickets = tickets.filter((tk) => tk.usable)

  // 응시 + 보유 응시권을 한 번에 받는다(같은 함수라 왕복이 안 늘어난다).
  //   lang 을 보내는 이유 = 회차 제목이 다국어 JSONB 라 서버가 그 언어로 투영해 내려준다.
  useEffect(() => {
    if (!isFullUser) return
    callFunction<MyAttemptsResponse>('my-attempts', { lang })
      .then((r) => {
        setList(r.attempts)
        setTickets(r.tickets ?? []) // 옛 함수가 떠 있으면 없다 — 그때는 응시권 블록이 통째로 안 뜬다
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t('my.load_failed')))
  }, [isFullUser, lang])

  // 발급비 결제를 마치고 돌아온 길 — /pay/success 가 `?cert=<attemptId>` 를 달아 보낸다.
  // 그 응시의 발급 화면을 대신 열어준다(거기서 결제 전에 입력한 이름으로 자동 발급된다).
  // ⚠️ 목록이 도착한 뒤에만 움직인다 — attemptId 만으로는 증서에 넣을 급수·취득일을 만들 수 없다.
  //    없는 id 면 아무 일도 안 한다(남의 응시 id 를 넣어봐야 내 목록에 없으니 열리지 않는다).
  const certResumeRef = useRef(false)
  useEffect(() => {
    const id = searchParams.get('cert')
    if (!id || !list || certResumeRef.current) return
    const a = list.find((x) => x.attemptId === id)
    if (!a) return
    certResumeRef.current = true
    // 파라미터를 지우고(주소만 교체) 발급 화면으로 넘긴다 — 안 지우면 발급 화면에서 뒤로가기 했을 때
    // 이 화면이 다시 마운트되며 또 발급 화면으로 튕겨(ref 는 마운트마다 초기화) 뒤로가기가 막힌다.
    setSearchParams({}, { replace: true })
    void goCert(a)
    // goCert 는 매 렌더 새로 만들어지는 함수라 의존성에서 뺀다(넣으면 목록이 바뀔 때마다 재실행).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, list])

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const name = (meta.full_name as string) || (meta.name as string) || user?.email?.split('@')[0] || t('mypage.default_name')

  // 발급 = 서버 기록(cert_issued_at) — 마이페이지/성적표 어디서 발급해도 '발급 완료'로 남고, 재발급도 가능.
  // 발급 응답에서 진위확인 토큰·확정 자격번호를 받아 인증서(QR)에 실어 보낸다.
  // 결제 유도 화면(/certificate 의 cert-gate)에 넘길 state — 견본 화면의 CTA 도 이걸 그대로 재사용한다.
  function gateState(a: MyAttempt) {
    return {
      preview: true,
      attemptId: a.attemptId,
      name,
      qualification: a.examTitle ?? t('mypage.exam_fallback'),
      grade: gradeDisplay(a.examTitle),
      certNo: a.certNo ?? certNoOf(a),
      issueDate: fmtDate(a.submittedAt),
      expiryDate: certExpiryDate(a.examTitle, a.submittedAt ? new Date(a.submittedAt) : new Date()),
      scoreText: `${a.totalCorrect} / ${a.totalQuestions}`,
    }
  }

  // 디자인 견본 — 더미 인물(홍길동) + 진한 워터마크. 내 이름·자격번호는 싣지 않는다.
  function goSample(a: MyAttempt) {
    navigate('/certificate/sample', {
      state: { sample: true, qualification: a.examTitle ?? '', grade: gradeDisplay(a.examTitle), name: '', certNo: '', issueDate: '', gate: gateState(a) },
    })
  }

  async function goCert(a: MyAttempt) {
    let verifyToken = a.verifyToken ?? undefined
    let certNo = a.certNo ?? certNoOf(a)
    // 아직 발급(유료) 전이면 인증서 대신 결제 유도 화면으로 — 발급은 그 화면의 결제 CTA 에서 한다.
    if (!a.certIssuedAt) {
      navigate('/certificate', { state: gateState(a) })
      return
    }
    let nameRoman = a.certNameRoman ?? undefined
    try {
      const r = await callFunction<MyAttemptsResponse>('my-attempts', { issue: a.attemptId })
      if (r.issued) {
        verifyToken = r.issued.verifyToken
        certNo = r.issued.certNo
        nameRoman = r.issued.nameRoman ?? nameRoman
      }
      setList((prev) => prev?.map((x) => (x.attemptId === a.attemptId ? { ...x, certIssuedAt: new Date().toISOString(), certNo: r.issued?.certNo ?? x.certNo, verifyToken: r.issued?.verifyToken ?? x.verifyToken } : x)) ?? prev)
    } catch {
      /* 발급 기록 실패 — 증서 화면은 열어준다(다음 방문 때 상태 재동기화) */
    }
    navigate('/certificate', {
      state: {
        name,
        // 인증서에 각인된 영문 성명 — 발급 때 저장한 스냅샷을 그대로 다시 쓴다(재발급도 같은 이름).
        nameRoman,
        qualification: a.examTitle ?? t('mypage.exam_fallback'),
        grade: gradeDisplay(a.examTitle),
        certNo,
        issueDate: fmtDate(a.submittedAt),
        expiryDate: certExpiryDate(a.examTitle, a.submittedAt ? new Date(a.submittedAt) : new Date()),
        verifyToken,
        scoreText: `${a.totalCorrect} / ${a.totalQuestions}`,
      },
    })
  }

  // 로그인 안 된 상태 → 로그인 페이지로 이동 (자체 로그인 게이트 제거)
  // ⚠️ 세션 복원(비동기)이 끝나기 전에는 판정하지 않는다. 예전엔 첫 프레임에서 isFullUser 가 false 라
  //    /mypage/earned → /login → (로그인 상태라) /mypage 로 튕겨서 **탭이 학습 대시보드로 초기화**됐다.
  if (authLoading) {
    return (
      <div className="wrap">
        <div className="card pad" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
      </div>
    )
  }
  if (!isFullUser) return <Navigate to="/login" replace />

  const attempts = list ?? []
  const earned = attempts.filter((a) => a.passed === true)
  const loading = !err && list === null
  const selfLoaded = tab === 'ebooks' // 자체 로딩 탭

  return (
    <div className="bg-background text-on-background min-h-screen relative overflow-x-hidden">
      {/* 헤더 없음 — FAB이 네비 */}
      <main className="min-h-screen px-margin-mobile md:px-margin-desktop pb-24 pt-12 relative">
        <div
          className="fixed inset-0 mesh-gradient-bg -z-10 pointer-events-none"
          style={{ maskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', WebkitMaskImage: 'linear-gradient(to bottom, white 0%, white 300px, transparent 600px)', opacity: 0.15 }}
        ></div>

        {/* ⚠️ 서재 탭만 러닝 라이브러리와 **같은 폭(1240)** 이다(2026-08-25 요청). 3열이 서는 화면이라
            기본 폭(1024)에서는 가운데·오른쪽 열이 눈에 띄게 좁아 두 화면이 다른 물건처럼 보인다.
            ⚠️ 마이페이지 **전체**를 넓히지 않는다 — 응시 현황·자격증·문의는 가로로 긴 카드라 넓히면 헐렁해진다.
            대가: 탭을 옮길 때 폭이 한 번 바뀐다. */}
        <div className={`${tab === 'ebooks' ? 'max-w-[1240px]' : 'max-w-5xl'} mx-auto w-full relative z-10`}>
          {/* 홈으로 — 이 화면엔 헤더가 없어서(FAB 이 네비) 여기 말고는 홈으로 갈 길이 FAB 뿐이었다. */}
          <Link to="/" className="gd-back mb-6">
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
            {t('common.home')}
          </Link>

          {/* Page Header */}
          <header className="mb-8 md:mb-12">
            <h1 className="font-display-lg text-4xl md:text-display-lg font-bold text-on-surface mb-3 tracking-tight break-keep">{t('mypage.title')}</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              {t('mypage.greeting_hello')}<strong className="text-primary font-bold">{t('mypage.greeting_name', { name })}</strong>{t('mypage.greeting_tail')}
            </p>
          </header>

          {/* ⛔ 옛 `CARIS 응시하기` 배너는 없앴다(2026-08-11).
              그 배너는 **어느 응시권으로 가는지 모른 채** /exam 으로 보냈고, 응시권이 2장 이상이면
              서버가 "어느 걸 쓸지 골라라"로 튕기는데 고를 화면이 없어 그대로 막혔다.
              이제 입구는 아래 **보유 응시권 카드** 하나뿐이고, 카드가 곧 선택 화면이다.
              대신 응시 기간이 열린 응시권이 있으면 아래 줄로 알린다 — 안 그러면
              결제하고도 어디서 응시하는지 못 찾는다(기본 탭이 학습 대시보드라 카드가 안 보인다). */}
          {openTickets.length > 0 && tab !== 'attempts' && (
            <button
              onClick={() => navigate('/mypage/attempts')}
              className="group w-full mb-8 md:mb-10 flex items-center justify-between gap-4 rounded-2xl bg-primary-container text-on-primary px-6 py-5 md:px-8 md:py-6 ambient-shadow hover:translate-y-[-2px] transition-transform duration-200 text-left"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[26px]" style={{ fontVariationSettings: "'FILL' 1" }}>confirmation_number</span>
                </div>
                <div>
                  <div className="font-title-md text-lg md:text-[22px] font-bold">{t('ticket.open_now', { n: openTickets.length })}</div>
                  <div className="font-body-md text-body-md opacity-90">{t('ticket.open_now_sub')}</div>
                </div>
              </div>
              <span className="material-symbols-outlined text-[28px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
            </button>
          )}

          {/* 내 정보 — 국가/지역(락) */}
          <ProfileSection />

          {/* Tabs */}
          <div className="flex gap-5 sm:gap-8 border-b border-outline-variant/40 mb-8 md:mb-10 overflow-x-auto scrollbar-hide">
            {TABS.map((tb) => (
              <Link
                key={tb.key}
                to={tb.to}
                className={
                  tab === tb.key
                    ? 'pb-4 border-b-[3px] border-primary text-primary font-title-md text-base sm:text-[18px] leading-[24px] font-bold px-1 sm:px-2 whitespace-nowrap'
                    : 'pb-4 border-b-[3px] border-transparent text-outline hover:text-on-surface font-title-md text-base sm:text-[18px] leading-[24px] font-semibold px-1 sm:px-2 transition-colors whitespace-nowrap'
                }
              >
                {t(tb.labelKey)}
                {/* 새 답변 알림 점 — FAB 의 점을 보고 들어온 사람이 **어느 탭인지** 찾는 자리다.
                    점을 끄는 건 문의를 펼쳐본 순간이지 이 탭을 여는 순간이 아니다(InquiryBoard). */}
                {tb.key === 'inquiry' && inquiryAlert > 0 ? (
                  <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-error align-middle" aria-hidden="true" />
                ) : null}
              </Link>
            ))}
          </div>

          {/* 이북 서재는 자기 데이터를 따로 불러오므로 응시내역(my-attempts) 로딩/에러 배너 대상이 아니다. */}
          {err && !selfLoaded && <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant/30 text-center text-on-surface-variant">{err}</div>}
          {loading && !selfLoaded && <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('common.loading')}</div>}

          {/* 1:1 문의 — 쓴 사람과 운영자만 본다. */}
          {tab === 'inquiry' && <InquiryBoard />}

          {/* 이북 서재 — 구매한 이북 */}
          {tab === 'ebooks' && <EbookLibrary />}

          {/* 보유 응시권 — 결제했지만 아직 안 쓴 것. 탭을 6개로 늘리지 않은 이유: 탭 줄이 overflow-x-auto 라
              모바일에서 잘리고, 응시권↔응시기록은 같은 물건의 앞뒤 상태(결제 → 응시 → 결과)다. */}
          {!loading && !err && tab === 'attempts' && tickets.length > 0 && (
            <section className="mb-8 md:mb-10">
              <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-2">{t('ticket.section_title')}</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mb-5 break-keep">{t('ticket.section_sub')}</p>
              <div className="flex flex-col gap-6">
                {tickets.map((tk) => (
                  // ⚠️ 어느 응시권으로 가는지 반드시 넘긴다. 같은 회차에서 여러 급수를 살 수 있어서
                  //    지정 없이 들어가면 start-exam 이 409 pick_ticket 으로 튕기고 고를 화면이 없다.
                  <TicketCard
                    key={tk.ticketId}
                    tk={tk}
                    t={t}
                    lang={lang}
                    // 커버 화면(/exam)을 거쳐 간다 — 바로 준비창으로 떨어지면 시험 진입이 너무 급하다.
                    onGo={() => navigate(`/exam?ticket=${encodeURIComponent(tk.ticketId)}`)}
                    onCheck={() => navigate(`/exam/check?ticket=${encodeURIComponent(tk.ticketId)}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 시험 응시 현황.
              응시권 블록이 위에 섰을 때만 제목을 단다 — 없으면 탭 이름이 이미 이 목록을 가리키고 있어
              제목을 상시로 넣으면 기존 화면에 없던 줄이 하나 생긴다. */}
          {!loading && !err && tab === 'attempts' && tickets.length > 0 && attempts.length > 0 && (
            <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.tab_attempts')}</h2>
          )}
          {!loading && !err && tab === 'attempts' && (
            attempts.length === 0 ? (
              // 응시권이 있으면 다음 할 일은 '응시', 없으면 '접수'다 — 빈 화면에서 길이 갈린다.
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center">
                <p className="font-body-md text-on-surface-variant mb-5">{tickets.length > 0 ? t('mypage.empty_attempts') : t('ticket.empty')}</p>
                <button onClick={() => navigate(tickets.length > 0 ? '/exam' : '/plan')} className="bg-primary-container text-on-primary font-label-md font-bold px-6 py-3 rounded-xl hover:bg-primary transition-colors ambient-shadow">{tickets.length > 0 ? t('mypage.go_exam') : t('ticket.empty_cta')}</button>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {attempts.map((a) => {
                  const s = statusInfo(a)
                  return (
                    <article key={a.attemptId} className={`bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${s.greyed ? 'opacity-75' : ''}`}>
                      <div className="flex items-start gap-5 flex-1">
                        <div className={`w-14 h-14 rounded-xl ${s.wrap} flex items-center justify-center shrink-0 border`}>
                          <span className={`material-symbols-outlined ${s.color} text-[28px]`} style={{ fontVariationSettings: "'FILL' 1" }}>{s.icon}</span>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                            <h3 className={`font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold break-keep ${s.greyed ? 'text-on-surface-variant' : 'text-on-surface'}`}>{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                            <span className={`px-3 py-1 ${s.badgeClass} font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border shrink-0`}>{s.badge}</span>
                          </div>
                          <p className="font-body-md text-body-md text-on-surface-variant mb-3">{fmtDT(a.submittedAt)} | {t('mypage.online')}</p>
                          {a.status === 'submitted' && !a.released && (
                            <p className="font-label-md text-[15px] leading-[22px] text-primary font-semibold flex items-center gap-1.5 bg-primary/5 px-3 py-1.5 rounded-lg w-fit">
                              <span className="material-symbols-outlined text-[18px]">schedule</span>
                              {t('mypage.grading', { days: daysLeft(a.resultReleaseAt) })}
                            </p>
                          )}
                          {(a.status === 'expired' || a.status === 'voided') && (
                            <p className="font-body-md text-body-md text-outline">{t('mypage.expired')}</p>
                          )}
                        </div>
                      </div>
                      {a.status === 'submitted' && a.released && (
                        <div className="shrink-0">
                          <button onClick={() => navigate(`/exam/result/${a.attemptId}`)} className="px-6 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:bg-surface-container-low hover:border-primary/30 hover:text-primary transition-all duration-200 flex items-center gap-2 shadow-sm">
                            {t('mypage.view_score')}
                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                          </button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )
          )}

          {/* 자격 취득 현황 = CARIS 자격검정 합격만.
              WORLD ARENA 레벨 인증서 섹션은 뺐다(2026-08-03) — 레벨 인증서는 레벨테스트 결과 화면에서만 발급한다. */}
          {tab === 'earned' && (
            <h2 className="font-title-md text-lg md:text-[22px] font-bold text-on-surface mb-5">{t('mypage.tab_earned')}</h2>
          )}
          {!loading && !err && tab === 'earned' && (
            earned.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('mypage.empty_earned')}</div>
            ) : (
              <div className="flex flex-col gap-6">
                {earned.map((a) => (
                  <article key={a.attemptId} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex items-start gap-5">
                    <div className="w-14 h-14 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-secondary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                        <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface break-keep">{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                        <span className="px-3 py-1 bg-secondary/10 text-secondary font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border border-secondary/20 shrink-0">{t('mypage.passed')}</span>
                      </div>
                      <p className="font-body-md text-body-md text-on-surface-variant">{fmtDate(a.submittedAt)} | {t('mypage.cert_no')} {a.certNo ?? certNoOf(a)} | {a.totalCorrect ?? 0} / {a.totalQuestions ?? 0}</p>
                    </div>
                  </article>
                ))}
              </div>
            )
          )}

          {/* 인증서 발급 현황 */}
          {!loading && !err && tab === 'issuance' && (
            <div className="flex flex-col gap-6">
              {/* 인증서 견본 — 취득 여부와 무관하게 이 탭에 항상 있는 고정 진입점(목록 위).
                  합격 건이 있으면 그 급수 견본으로, 없으면 기본 급수 견본으로 연다. */}
              <section className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow flex flex-col md:flex-row md:items-center justify-between gap-5">
                <div className="flex items-start gap-5">
                  <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                  </div>
                  <div>
                    <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface mb-2 break-keep">{t('mypage.sample_title')}</h3>
                    <p className="font-body-md text-body-md text-on-surface-variant break-keep">{t('mypage.sample_desc')}</p>
                  </div>
                </div>
                <button
                  onClick={() => (earned[0] ? goSample(earned[0]) : navigate('/certificate/sample'))}
                  className="shrink-0 px-6 py-2.5 bg-surface-container-lowest border border-outline-variant text-on-surface font-label-md text-[15px] font-bold rounded-xl hover:border-primary/30 hover:text-primary transition-all duration-200 flex items-center justify-center gap-2"
                >
                  {t('mypage.view_sample')}
                  <span className="material-symbols-outlined text-[18px]">visibility</span>
                </button>
              </section>

              {earned.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-2xl p-12 border border-outline-variant/30 text-center text-on-surface-variant">{t('mypage.empty_issuance')}</div>
              ) : (
                <div className="flex flex-col gap-6">
                {earned.map((a) => {
                  const certNo = a.certNo ?? certNoOf(a)
                  const issued = !!a.certIssuedAt
                  return (
                    <article key={a.attemptId} className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/30 ambient-shadow ambient-shadow-hover transition-all duration-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                      <div className="flex items-start gap-5 flex-1">
                        <div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-primary text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                        </div>
                        <div>
                          <h3 className="font-title-md text-lg leading-snug md:text-[22px] md:leading-[28px] font-bold text-on-surface mb-2 break-keep">{a.examTitle ?? t('mypage.exam_fallback')}</h3>
                          <p className="font-body-md text-body-md text-on-surface-variant">{t('mypage.cert_no')} {certNo}</p>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-wrap items-center gap-3">
                        <span className={`px-3 py-1 font-label-sm text-[11px] leading-[14px] uppercase tracking-wider font-bold rounded-full border ${issued ? 'bg-secondary/10 text-secondary border-secondary/20' : 'bg-outline/10 text-outline border-outline/20'}`}>{issued ? 'Issued' : 'Ready'}</span>
                        <button onClick={() => goCert(a)} className="px-6 py-2.5 bg-primary-container text-on-primary font-label-md text-[15px] font-bold rounded-xl hover:bg-primary transition-colors ambient-shadow flex items-center gap-2">
                          {issued ? t('mypage.reissue') : t('mypage.issue')}
                          <span className="material-symbols-outlined text-[18px]">download</span>
                        </button>
                      </div>
                    </article>
                  )
                })}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

    </div>
  )
}
