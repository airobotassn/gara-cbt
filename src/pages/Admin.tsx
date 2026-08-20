import { useCallback, useEffect, useState, lazy, Suspense, Fragment, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { renderEbookCover } from '../lib/ebookCover'
import { krw, usdc, usdInputToCents, centsToUsdInput } from '../lib/money'
import { feeKey } from '../lib/fees'
import { translateEbook, EBOOK_LANGS, EBOOK_LANG_LABEL } from '../lib/ebookTranslate'
import { fitNoticeHtml, importNoticeHtml } from '../lib/noticeHtml'
import { isIsolatedHtml } from '../lib/noticeRender'
import HtmlBody from '../components/HtmlBody'
import { NOTICE_WIDTH } from '../lib/noticeRender'
import type {
  AdminListResponse,
  AdminAttemptRow,
  AdminDetailResponse,
  AdminAnswerRow,
  GradeQueueItem,
  GradeQueueResponse,
  GradeRound,
  GradeRoundsResponse,
  AdminNoticeListResponse,
  NoticeRow,
  AdminFaqListResponse,
  FaqRow,
  AdminExamRoundListResponse,
  ExamRoundRow,
  AdminExamListResp,
  AdminExamItem,
  AdminBankListResp,
  QuestionBankItem,
  AdminExamSetResp,
  ExamSetRow,
  AdminQuestionListResp,
  AdminQuestionRow,
  AdminQuestionEventsResp,
  AdminQuestionEvent,
  QuestionImportRow,
  CbtAnalytics,
  CbtRoundStat,
  CbtTierStat,
  CbtQDiff,
  CbtUsersResp,
  CbtUserDetailResp,
  CbtUserAttempt,
  I18nText,
  AdminEbookRow,
  AdminEbookListResp,
  AdminEbookBuyer,
  AdminEbookBuyersResp,
  EbookTranslation,
} from '../lib/types'
// WORLD ARENA 화면들 — 옛 <LevelTestAdmin/> 껍데기는 없어지고 개별 컴포넌트가 대메뉴 아래로 꽂힌다.
import { ArenaDashboard, ArenaAttempts, ArenaQuestions, ArenaUserPanel, type ArenaUserRow } from './AdminLevelTest'
// 재편으로 새로 만든 화면들(Admin.tsx 가 이미 6천 줄이라 분리) — 라우팅만 여기서 한다.
import {
  PaymentsAdmin, MinigameStatAdmin, DailyStatAdmin, TermPoolAdmin, CoinPolicyAdmin,
  CertAdmin, LecturesAdmin, QnaAdmin, PolicyAdmin, SiteInfoAdmin, PopupAdmin, AdminHead, EnvCheckAdmin,
} from './AdminReform'
import { useAdminData, payStatusLabel, productLabel } from '../lib/adminData'
import { useDraft } from '../lib/adminDraft'
import DraftBar from '../components/DraftBar'
import { getTracks, tierName, isTierLocked, TIER_EXAM_SPEC, tierTotal, TIER_DRAW_CELLS, POOL_MULTIPLIER, buildDrawCells } from '../lib/caris'
import { REGIONS, countryName, flagEmoji } from '../lib/regions'
import { gradeDisplay, certExpiryDate, fmtCertDate } from '../lib/certNo'
import { optimizeEbookHtml, optimizeSummary } from '../lib/ebookOptimize'

// 관리자 최상위 = **대메뉴 6개 + 홈 대시보드** (2026-08-11 재편 · PPT `관리자 페이지 수정사항` 1페이지).
//   옛 구조는 상단 2탭(`CARIS 시험` / `WORLD ARENA`) + 각자의 서브탭이었다. 화면 자체는 그대로 두고
//   **어느 대메뉴 밑에 서는가만** 바꾼 것이다 — 그래야 나중 단계에서 신규 화면을 자리에 얹기만 하면 된다.
//
// ⚠️ 홈(대시보드)은 대메뉴 6개 어디에도 없다. **좌상단 시스템 이름이 홈으로 가는 유일한 길**이다.
//    PPT 가 "이름 클릭 시 대시보드 표출" 이라고 못박았고, 6개 목록에도 대시보드가 없다.
// ⚠️ 각 제품의 상세 대시보드(CARIS 분석 · 아레나 분석)는 없어지지 않고 그 대메뉴 안에 남는다.
//    홈은 전체 요약, 대메뉴 안은 그 제품 상세 — 합치면 CARIS 분석이 묻힌다.
type TopMenu = 'members' | 'arena' | 'caris' | 'library' | 'board' | 'site'
interface SubItem { key: string; label: string; root?: boolean; children?: { key: string; label: string }[] }

const MENUS: { key: TopMenu; label: string }[] = [
  { key: 'members', label: '유저관리' },
  { key: 'arena', label: 'WORLD ARENA' },
  { key: 'caris', label: 'CARIS' },
  { key: 'library', label: 'Learning Library' },
  { key: 'board', label: '게시판 관리' },
  { key: 'site', label: '홈페이지 관리' },
]

// 대메뉴 → 하위메뉴 → 세부. **각 단계의 첫 항목이 기본**(?tab·?sub 없이 들어오면 여기로).
// ⚠️ 세부(3단)는 **자기 줄에 따로 선다.** 하위메뉴와 같은 줄에 붙이면 어느 게 상위인지 안 보인다.
//    (미니게임의 현황/문항, 제출답안/주관식채점, 고객센터의 FAQ/Q&A, 러닝라이브러리의 이북/콘텐츠가 전부 3단이다.)
const SUBS: Record<TopMenu, SubItem[]> = {
  members: [
    { key: 'users', label: '유저' },
    { key: 'payments', label: '결제관리' },
  ],
  arena: [
    { key: 'dash', label: '대시보드' },
    // PPT 2페이지 도형 그대로 — '미니게임' 이 상위고 게임 현황·게임 문항이 그 아래다.
    { key: 'minigame', label: '미니게임', children: [{ key: 'stat', label: '게임 현황' }, { key: 'quiz', label: '게임 문항' }] },
    { key: 'leveltest', label: '레벨테스트', children: [{ key: 'stat', label: '참여 현황' }, { key: 'quiz', label: '문항 관리' }] },
    { key: 'daily', label: '오늘의 학습', children: [{ key: 'stat', label: '참여 현황' }, { key: 'quiz', label: '문항 관리' }] },
    { key: 'chat', label: '채팅 관리' },
    { key: 'coin', label: '코인 관리' },
  ],
  caris: [
    { key: 'dash', label: '대시보드' },
    { key: 'plan', label: 'CARIS PLAN' },
    { key: 'status', label: 'CARIS 현황', children: [{ key: 'tickets', label: '접수·응시권' }, { key: 'env', label: '시험환경 점검' }] },
    { key: 'subs', label: '제출답안/채점', children: [{ key: 'list', label: '제출 답안' }, { key: 'grading', label: '주관식 채점' }] },
    { key: 'questions', label: '문항관리' },
    { key: 'cert', label: '인증서 관리' },
  ],
  // ⚠️ 겨냥하는 시험(LEVEL TEST / CARIS)이 상위다. 교재·강의는 그 안의 종류일 뿐이라 아래로 간다.
  library: [
    { key: 'lt', label: 'LEVEL TEST', children: [{ key: 'ebooks', label: 'E-BOOK 관리' }, { key: 'contents', label: '콘텐츠 관리' }] },
    { key: 'caris', label: 'CARIS', children: [{ key: 'ebooks', label: 'E-BOOK 관리' }, { key: 'contents', label: '콘텐츠 관리' }] },
  ],
  board: [
    { key: 'notice', label: '공지사항' },
    { key: 'support', label: '고객센터', children: [{ key: 'faq', label: 'FAQ' }, { key: 'qna', label: 'Q&A' }] },
    { key: 'about', label: '협회소개' },
    { key: 'privacy', label: '개인정보처리방침' },
    { key: 'terms', label: '이용약관' },
  ],
  site: [
    { key: 'info', label: '사이트 정보' },
    { key: 'popup', label: '팝업 관리' },
    { key: 'fx', label: '환율 관리' },
    { key: 'admins', label: '관리자 관리', root: true },
  ],
}

const isTopMenu = (v: string): v is TopMenu => MENUS.some((m) => m.key === v)
/** 메뉴 이동 — 화면들이 서로를 딥링크할 때 쓴다(대시보드 '처리 대기' 카드 등). `sub` 은 3단 키. */
export type AdminGo = (top: TopMenu | '', tab?: string, sub?: string, extra?: Record<string, string>) => void

export default function Admin() {
  const { isFullUser, loginWithGoogle } = useAuth()
  // 대메뉴·하위메뉴 상태를 URL 쿼리(?top·?tab)로 → 브라우저 뒤로/앞으로가 메뉴 사이를 오간다.
  const [params, setParams] = useSearchParams()
  // 권한 확인은 여기 한 번뿐이다. 옛 구조는 두 화면이 각자 `me` 를 불러 로그인 게이트가 두 벌이었다.
  const [state, setState] = useState<'checking' | 'denied' | 'ok'>('checking')
  const [isRoot, setIsRoot] = useState(false)

  useEffect(() => {
    if (!isFullUser) {
      setState('checking')
      return
    }
    callFunction<{ ok: boolean; isRoot?: boolean }>('admin', { action: 'me' })
      .then((r) => {
        setIsRoot(!!r.isRoot)
        setState('ok')
      })
      .catch(() => setState('denied'))
  }, [isFullUser])

  const rawTop = params.get('top') ?? ''
  const top: TopMenu | '' = isTopMenu(rawTop) ? rawTop : ''
  // ⚠️ 루트 전용 항목은 목록에서 빼야 한다 — 남겨두면 권한 없는 사람이 주소로 들어와 빈 화면을 본다.
  const subs = top ? SUBS[top].filter((s) => !s.root || isRoot) : []
  const rawTab = params.get('tab') ?? ''
  const tab = subs.some((s) => s.key === rawTab) ? rawTab : subs[0]?.key ?? ''
  const kids = subs.find((s) => s.key === tab)?.children ?? []
  const rawSub = params.get('sub') ?? ''
  const sub = kids.some((k) => k.key === rawSub) ? rawSub : kids[0]?.key ?? ''

  const go: AdminGo = (t, nextTab, nextSub, extra) =>
    setParams(() => {
      // 이동할 땐 이전 화면의 보조 파라미터를 버린다 — 남기면 엉뚱한 화면에 필터가 걸린 채 열린다.
      const p = new URLSearchParams()
      if (t) {
        p.set('top', t)
        if (nextTab) p.set('tab', nextTab)
        if (nextSub) p.set('sub', nextSub)
      }
      for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v)
      return p
    })

  // ── 게이트 ──
  if (!isFullUser) {
    return (
      <div className="wrap">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
          <h2 className="exam-title">관리자 로그인</h2>
          <p className="exam-sub">관리자 계정으로 로그인해 주세요.</p>
          <button className="btn-ink" style={{ marginTop: 16 }} onClick={() => loginWithGoogle()}>
            구글로 로그인
          </button>
        </div>
      </div>
    )
  }
  if (state === 'checking') {
    return (
      <div className="wrap">
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>확인 중…</div>
      </div>
    )
  }
  if (state === 'denied') {
    return (
      <div className="wrap">
        <div className="exam-card" style={{ textAlign: 'center', maxWidth: 420, margin: '40px auto' }}>
          <div className="exam-ico">🔒</div>
          <h2 className="exam-title">접근 권한이 없습니다</h2>
          <p className="exam-sub">관리자 전용 페이지입니다.</p>
        </div>
      </div>
    )
  }

  return (
    // `admin` = 폭·토큰(admin.css), `admin-cbt` = --a-* 보강 + .admin-head 레이아웃(cbt.css).
    // 옛 CARIS 화면이 이미 둘을 같이 쓰고 있었다 — 이제 아레나 화면도 같은 껍데기 안에 서므로 여기로 올린다.
    <div className="wrap admin admin-cbt">
      {/* ⚠️ 아이콘을 Material Symbols 로 쓰지 않는다 — 이 화면들 대부분에서 여기가 유일한 아이콘이라
          웹폰트가 붙기 전까지 `space_dashboard` 라는 **글자**가 그대로 보인다(실제로 그랬다).
          관리자페이지임을 알리는 첫 표기라 폰트 로딩에 기대면 안 된다. */}
      <button className="admin-brand" onClick={() => go('')} title="대시보드로">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
          <path d="M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h8v8H3v-8zm10-3h8v11h-8V10z" />
        </svg>
        GARA 통합관리시스템
      </button>

      <div className="admin-tabs admin-tabs-top">
        {MENUS.map((m) => (
          <button key={m.key} className={top === m.key ? 'on' : ''} onClick={() => go(m.key)}>
            {m.label}
          </button>
        ))}
      </div>

      {subs.length > 0 && (
        <div className="admin-tabs" style={{ marginBottom: kids.length ? 10 : 18, flexWrap: 'wrap' }}>
          {subs.map((s) => (
            <button key={s.key} className={tab === s.key ? 'on' : ''} onClick={() => go(top as TopMenu, s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* 3단(세부) — 자기 줄에 따로 선다. 하위메뉴와 같은 줄에 붙이면 상하 관계가 안 보인다. */}
      {kids.length > 0 && (
        <div className="admin-tabs admin-tabs-sub">
          {kids.map((k) => (
            <button key={k.key} className={sub === k.key ? 'on' : ''} onClick={() => go(top as TopMenu, tab, k.key)}>
              {k.label}
            </button>
          ))}
        </div>
      )}

      <AdminScreen top={top} tab={tab} sub={sub} isRoot={isRoot} go={go} />
    </div>
  )
}

// 대메뉴/하위메뉴/세부 → 화면. 옛 서브탭 화면들이 여기로 모인다.
function AdminScreen({ top, tab, sub, isRoot, go }: { top: TopMenu | ''; tab: string; sub: string; isRoot: boolean; go: AdminGo }) {
  if (!top) return <HomeDashboard go={go} />
  switch (`${top}/${tab}${sub ? `/${sub}` : ''}`) {
    // ── 회원관리 ──
    case 'members/users': return <MembersAdmin />
    case 'members/payments': return <PaymentsAdmin />
    // ── WORLD ARENA ──
    case 'arena/dash': return <ArenaDashboard />
    case 'arena/minigame/stat': return <MinigameStatAdmin />
    case 'arena/minigame/quiz': return <TermPoolAdmin scope="minigame" />
    case 'arena/leveltest/stat': return <ArenaAttempts />
    case 'arena/leveltest/quiz': return <ArenaQuestions isRoot={isRoot} />
    case 'arena/daily/stat': return <DailyStatAdmin />
    case 'arena/daily/quiz': return <TermPoolAdmin scope="daily" />
    case 'arena/chat': return <ChatModAdmin />
    case 'arena/coin': return <CoinPolicyAdmin />
    // ── CARIS ──
    case 'caris/dash': return <DashboardAdmin go={go} />
    case 'caris/plan': return <RoundsAdmin />
    case 'caris/status/tickets': return <TicketsAdmin isRoot={isRoot} />
    case 'caris/status/env': return <EnvCheckAdmin />
    case 'caris/subs/list': return <SubmissionList />
    case 'caris/subs/grading': return <GradingAdmin />
    case 'caris/questions': return <QuestionsAdmin isRoot={isRoot} />
    case 'caris/cert': return <CertAdmin />
    // ── Learning Library ──
    case 'library/lt/ebooks': return <EbooksAdmin key="lt" catalog="leveltest" />
    case 'library/lt/contents': return <LecturesAdmin key="lt" catalog="leveltest" />
    case 'library/caris/ebooks': return <EbooksAdmin key="caris" catalog="caris" />
    case 'library/caris/contents': return <LecturesAdmin key="caris" catalog="caris" />
    // ── 게시판 관리 ──
    case 'board/notice': return <NoticesAdmin />
    case 'board/support/faq': return <FaqAdmin />
    case 'board/support/qna': return <QnaAdmin />
    // ⚠️ key 가 없으면 세 문서가 **같은 컴포넌트 인스턴스**를 재사용해 본문(state)이 그대로 남는다 —
    //    협회소개를 보다 이용약관으로 넘어가면 협회소개 글이 그대로 보인다(실제로 그랬다).
    case 'board/about': return <PolicyAdmin key="about" doc="about" />
    case 'board/privacy': return <PolicyAdmin key="privacy" doc="privacy" />
    case 'board/terms': return <PolicyAdmin key="terms" doc="terms" />
    // ── 홈페이지 관리 ──
    case 'site/info': return <SiteInfoAdmin />
    case 'site/popup': return <PopupAdmin />
    case 'site/fx': return <FxAdmin />
    case 'site/admins': return isRoot ? <AdminAccountsAdmin /> : <HomeDashboard go={go} />
    default: return <HomeDashboard go={go} />
  }
}

// 홈 대시보드 — PPT 1페이지가 요구한 6가지(오늘 접속자 · 신규/휴면 회원 · 최근 문의 · 시스템 알림 ·
// 매출 · 인기 이북/콘텐츠). 각 제품의 상세 분석은 그 대메뉴 안에 따로 있다.
interface HomeStats {
  users: number; todayVisitors: number; newUsers7d: number; dormant: number
  revenue30d: number; paid30d: number; refund30d: number; unfulfilled: number
  topEbooks: { id: string; title: string; n: number }[]
  alerts: { id: string; severity: string; source: string; message: string; link: string | null; at: string }[]
  inquiries: { id: string; title: string; status: string; at: string }[]
}
function HomeDashboard({ go }: { go: AdminGo }) {
  const { data, loading, err, reload } = useAdminData<HomeStats>('homeStats')
  const kpis = [
    { k: '오늘 접속자', v: `${data?.todayVisitors ?? 0}명`, sub: `누적 유저 ${(data?.users ?? 0).toLocaleString()}명`, accent: 'blue' },
    { k: '신규 유저', v: `${data?.newUsers7d ?? 0}명`, sub: '최근 7일', accent: 'violet' },
    { k: '휴면 유저', v: `${data?.dormant ?? 0}명`, sub: '90일 이상 미접속', accent: 'muted' },
    { k: '매출(30일)', v: krw(data?.revenue30d ?? 0), sub: `결제 ${data?.paid30d ?? 0}건 · 환불 ${data?.refund30d ?? 0}건`, accent: 'green' },
  ]
  return (
    <>
      <AdminHead title="대시보드" onReload={reload} loading={loading} />
      {err && <div className="admin-section admin-empty">{err}</div>}

      <div className="admin-cards">
        {kpis.map((c) => (
          <div key={c.k} className={`admin-card k-${c.accent}`}>
            <div className="k">{c.k}</div>
            <div className="v">{c.v}</div>
            <div className="s">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 시스템 알림 — 관리자가 안 보면 사고 나는 것들. 모니터링 웹훅이 밀어넣은 것도 여기 같이 선다. */}
      <div className="admin-section">
        <div className="admin-section-head">
          <h3>시스템 알림</h3>
          {(data?.unfulfilled ?? 0) > 0 && (
            <button className="admin-mini" onClick={() => go('members', 'payments', undefined, { queue: 'unfulfilled' })}>
              미지급 결제 {data!.unfulfilled}건 보기
            </button>
          )}
        </div>
        {data?.alerts.length ? (
          <table className="admin-table">
            <tbody>
              {data.alerts.map((a) => (
                <tr key={a.id}>
                  <td style={{ width: 90 }}>
                    <span className={`badge ${a.severity === 'error' ? 'low' : a.severity === 'warn' ? '' : 'ok'}`}>{a.severity}</span>
                  </td>
                  <td style={{ width: 120, color: 'var(--muted)' }}>{a.source}</td>
                  <td>{a.message}</td>
                  <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(a.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="admin-empty">
            {(data?.unfulfilled ?? 0) > 0
              ? `미확인 알림은 없지만 미지급 결제가 ${data!.unfulfilled}건 있습니다.`
              : '미확인 알림이 없습니다.'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <div className="admin-section">
          <div className="admin-section-head">
            <h3>최근 문의</h3>
            <button className="admin-mini" onClick={() => go('board', 'support', 'qna')}>전체 보기</button>
          </div>
          {data?.inquiries.length ? (
            <table className="admin-table">
              <tbody>
                {data.inquiries.map((i) => (
                  <tr key={i.id}>
                    <td>{i.title}</td>
                    <td style={{ width: 90 }}>{i.status === 'open' ? <span className="badge low">대기</span> : <span className="badge ok">완료</span>}</td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(i.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="admin-empty">문의가 없습니다.</div>}
        </div>

        <div className="admin-section">
          <div className="admin-section-head">
            <h3>인기 이북</h3>
            <button className="admin-mini" onClick={() => go('library', 'lt', 'ebooks')}>이북 관리</button>
          </div>
          {data?.topEbooks.length ? (
            <table className="admin-table">
              <tbody>
                {data.topEbooks.map((b) => (
                  <tr key={b.id}><td>{b.title}</td><td style={{ width: 80, textAlign: 'right' }}>{b.n}명</td></tr>
                ))}
              </tbody>
            </table>
          ) : <div className="admin-empty">구매 기록이 없습니다.</div>}
          {/* 인기 콘텐츠(강의)는 아직 조회 기록을 남기지 않는다 — 유튜브 임베드라 재생 수가 우리 쪽에 안 남는다. */}
          <p className="admin-hint" style={{ marginTop: 10 }}>강의는 유튜브 임베드라 재생 수가 우리 쪽에 남지 않습니다.</p>
        </div>
      </div>

    </>
  )
}


const PAGE = 50

function fmtDT(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: '응시 중',
  submitted: '제출 완료',
  voided: '무효',
  expired: '만료',
}

// 제출답안 목록 빠른 필터 — 대시보드 '처리 대기' 카드가 URL(`?f=`)로 프리셋을 넘긴다.
//   ⚠️ state 가 아니라 URL 인 이유: 대시보드와 제출답안이 이제 서로 다른 하위메뉴라
//      부모 state 로 넘길 방법이 없다(옛 구조는 한 컴포넌트 안이라 됐다).
type SubsFilter = 'all' | 'in_progress' | 'result_pending' | 'passed' | 'failed'
const SUBS_FILTERS: { key: SubsFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'in_progress', label: '진행중' },
  { key: 'result_pending', label: '결과공개 대기' },
  { key: 'passed', label: '합격' },
  { key: 'failed', label: '불합격' },
]
function matchSubsFilter(r: AdminAttemptRow, f: SubsFilter): boolean {
  const pct = r.totalQuestions && r.totalCorrect != null ? (r.totalCorrect / r.totalQuestions) * 100 : null
  const releasePending = !r.resultReleaseAt || new Date(r.resultReleaseAt).getTime() > Date.now()
  switch (f) {
    case 'in_progress': return r.status === 'in_progress'
    case 'result_pending': return r.status === 'submitted' && releasePending
    case 'passed': return r.status === 'submitted' && pct != null && pct >= 60
    case 'failed': return r.status === 'submitted' && pct != null && pct < 60
    default: return true
  }
}

// 제출 답안 목록 — 옛 CarisExamAdmin 본문 그대로(admin 함수 호출). 게이트·탭은 최상위로 올라갔다.
function SubmissionList() {
  const [params, setParams] = useSearchParams()
  // 빠른 필터는 URL(`?f=`)에서 읽는다 — 대시보드 '처리 대기' 카드가 이 값으로 딥링크한다.
  const rawF = params.get('f') ?? ''
  const subsFilter: SubsFilter = (SUBS_FILTERS.some((x) => x.key === rawF) ? rawF : 'all') as SubsFilter
  const setSubsFilter = (f: SubsFilter) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev)
      if (f === 'all') p.delete('f')
      else p.set('f', f)
      return p
    })
  const [rows, setRows] = useState<AdminAttemptRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<AdminDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [subsRound, setSubsRound] = useState<string>('') // 회차 필터: '' 전체 · roundId · 'none' 미배정
  const [subsExam, setSubsExam] = useState<string>('') // 급수(등록시험) 필터: '' 전체 · examId
  const [subRounds, setSubRounds] = useState<ExamRoundRow[]>([])
  const [subExams, setSubExams] = useState<AdminExamItem[]>([])

  const load = useCallback(async (off: number) => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminListResponse>('admin', {
        action: 'list',
        limit: PAGE,
        offset: off,
      })
      setRows(res.attempts)
      setTotal(res.total)
      setOffset(off)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '목록을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(0) }, [load])

  // 회차·급수 필터 옵션(등록시험 기준)
  useEffect(() => {
    Promise.all([
      callFunction<AdminExamRoundListResponse>('admin', { action: 'examRoundList' }),
      callFunction<AdminExamListResp>('admin', { action: 'examListForAdmin' }),
    ])
      .then(([r, e]) => { setSubRounds(r.rounds); setSubExams(e.exams) })
      .catch(() => { /* 필터 옵션 실패해도 목록은 나옴 */ })
  }, [])

  // 회차 바뀌면 급수 필터 초기화
  useEffect(() => { setSubsExam('') }, [subsRound])

  async function openDetail(id: string) {
    setDetailLoading(true)
    try {
      setDetail(await callFunction<AdminDetailResponse>('admin', { action: 'detail', attemptId: id }))
    } catch (e) {
      alert(e instanceof Error ? e.message : '상세를 불러올 수 없습니다.')
    } finally {
      setDetailLoading(false)
    }
  }

  const pageNo = Math.floor(offset / PAGE) + 1
  const pageMax = Math.max(1, Math.ceil(total / PAGE))
  // 제출답안 회차·급수 필터
  const reMatch = (r: AdminAttemptRow) =>
    (!subsRound || (subsRound === 'none' ? !r.roundId : r.roundId === subsRound)) &&
    (!subsExam || r.examId === subsExam)
  const subExamOpts = (subsRound && subsRound !== 'none' ? subExams.filter((e) => e.round_id === subsRound) : subExams)
    .slice().sort((a, b) => tierRank(a.tier) - tierRank(b.tier))
  // 회차는 일정 내림차순(최신·미래가 위) — 주관식 채점(gradeRounds)과 동일 순서
  const subRegular = subRounds.filter((r) => r.kind === 'regular').sort((a, b) => (b.examDate ?? '').localeCompare(a.examDate ?? ''))

  return (
    <>
      <div className="admin-head">
        <h1>제출 답안 관리</h1>
        <div className="admin-head-actions">
          <label className="grade-round">
            <span className="grade-round-lab">회차</span>
            <select value={subsRound} onChange={(e) => setSubsRound(e.target.value)}>
              <option value="">전체</option>
              {subRegular.map((r) => (
                <option key={r.id} value={r.id}>{r.titleI18n.ko || '(회차명 없음)'}</option>
              ))}
              <option value="none">상시·미배정</option>
            </select>
          </label>
          <label className="grade-round">
            <span className="grade-round-lab">시험</span>
            <select value={subsExam} onChange={(e) => setSubsExam(e.target.value)}>
              <option value="">전체 급수</option>
              {subExamOpts.map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.tier ? TIER_LABEL[ex.tier] ?? ex.tier : ex.title}</option>
              ))}
            </select>
          </label>
          <span className="admin-count">총 {total}건</span>
          <button className="admin-mini" onClick={() => load(offset)} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      {/* 빠른 필터(이 페이지 기준) — 대시보드 '처리 대기' 카드가 프리셋 지정 */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {SUBS_FILTERS.map((f) => {
          const c = rows.filter((r) => matchSubsFilter(r, f.key) && reMatch(r)).length
          return (
            <button key={f.key} className={subsFilter === f.key ? 'on' : ''} onClick={() => setSubsFilter(f.key)}>
              {f.label}
              {f.key !== 'all' && <span style={{ opacity: 0.55, marginLeft: 5 }}>{c}</span>}
            </button>
          )
        })}
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>제출일시</th>
              <th>시험</th>
              <th>응시자</th>
              <th>상태</th>
              <th>점수</th>
              <th>결과 공개</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => matchSubsFilter(r, subsFilter) && reMatch(r)).map((r) => (
              <tr key={r.attemptId}>
                <td>{fmtDT(r.submittedAt)}</td>
                <td>{r.examTitle}</td>
                <td>
                  <div className="admin-user">
                    <b>{r.userName || '-'}</b>
                    <span>{r.userEmail}</span>
                  </div>
                </td>
                <td>
                  <span className={`admin-badge st-${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                </td>
                <td>
                  {r.status === 'submitted' && r.totalCorrect != null
                    ? `${r.totalCorrect} / ${r.totalQuestions}`
                    : '-'}
                </td>
                <td>{fmtDT(r.resultReleaseAt)}</td>
                <td>
                  <button className="admin-mini" onClick={() => openDetail(r.attemptId)}>
                    상세
                  </button>
                </td>
              </tr>
            ))}
            {!rows.filter((r) => matchSubsFilter(r, subsFilter) && reMatch(r)).length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {rows.length ? '이 필터에 해당하는 답안이 없습니다(이 페이지 기준).' : '제출된 답안이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-pager">
        <button className="admin-mini" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}>
          ‹ 이전
        </button>
        <span>
          {pageNo} / {pageMax}
        </span>
        <button
          className="admin-mini"
          disabled={offset + PAGE >= total || loading}
          onClick={() => load(offset + PAGE)}
        >
          다음 ›
        </button>
      </div>

      {(detail || detailLoading) && (
        <div className="admin-modal-bg" onClick={() => setDetail(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDetail(null)}>
              ✕
            </button>
            {detailLoading || !detail ? (
              <div style={{ padding: 40, textAlign: 'center' }}>불러오는 중…</div>
            ) : (
              <>
                <h2>
                  {detail.attempt.userName || '-'} <span className="admin-modal-email">{detail.attempt.userEmail}</span>
                </h2>
                <p className="admin-modal-meta">
                  {detail.attempt.examTitle} · 제출 {fmtDT(detail.attempt.submittedAt)} ·{' '}
                  {detail.attempt.totalCorrect != null
                    ? `${detail.attempt.totalCorrect}/${detail.attempt.totalQuestions}점`
                    : '미채점'}
                </p>
                <InterruptionPanel attemptId={detail.attempt.attemptId} />
                <div className="admin-ans-list">
                  {detail.answers.map((a) => (
                    <div key={a.number} className={`admin-ans ${a.isCorrect ? 'ok' : 'no'}`}>
                      <span className="admin-ans-no">{a.number}</span>
                      <span className="admin-ans-q">{a.prompt}</span>
                      <span className="admin-ans-pick">
                        {a.selectedIndex === null ? '미응답' : `${a.selectedIndex + 1}번`}
                        {' / 정답 '}
                        {a.correctIndex + 1}번
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── 응시 중단 정황 · 복구 ──
//
// 감독관 없는 자율응시라 "응시 화면을 벗어났다 돌아오면 무효" 가 기본값이다(start-exam).
// 서버는 **PC 가 뻗은 것과 일부러 나간 것을 구분할 수 없으므로** 자동으로 봐주지 않고,
// 문의가 오면 여기 자료를 보고 사람이 푼다.
//
// ⚠️ 여기 값은 **증거가 아니라 정황**이다. 랜선을 뽑으면 종료 신호도 안 남는다.
//    그래도 아래 세 가지를 같이 보면 판단이 선다:
//      · 닫힘 신호 — 있으면 사람이 창을 닫은 것. 없이 끊겼으면 알릴 틈이 없었던 것(정전·정지).
//      · 공백 길이 — 사고는 대개 짧고, 찾아보고 온 건 길다.
//      · 진행률   — 하나도 안 풀고 훑기만 하다 나갔는지.
interface InterruptionResp {
  attempt: {
    status: string
    void_reason: string | null
    started_at: string | null
    last_seen_at: string | null
    answered_count: number
    total_questions: number | null
    entry_count: number
    reinstated_at: string | null
    reinstated_by: string | null
    reinstate_note: string | null
    resume_deadline: string | null
  }
  events: { kind: string; at: string; detail: Record<string, unknown> }[]
  summary: {
    gapSec: number | null
    answered: number
    totalQuestions: number
    hadCloseSignal: boolean
    closeVia: string | null
    reentryCount: number
  }
}

const EVENT_LABEL: Record<string, string> = {
  start: '응시 시작',
  closed: '화면 닫힘(사용자가 닫음)',
  reentry: '재진입 → 무효 처리',
  reinstate: '관리자 복구',
}

function fmtGap(sec: number | null): string {
  if (sec == null) return '알 수 없음'
  if (sec < 60) return `${sec}초`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}분 ${sec % 60}초`
  return `${Math.floor(m / 60)}시간 ${m % 60}분`
}

function InterruptionPanel({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<InterruptionResp | null>(null)
  const [note, setNote] = useState('')
  // 복구 후 응시 가능 기한(일). **회차 응시 기간과 무관하게** 이 기간은 열린다 —
  // 마지막 날 사고를 다음 날 처리하면 회차가 이미 끝나 있어서, 이게 없으면 복구가 성립하지 않는다.
  const [graceDays, setGraceDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await callFunction<InterruptionResp>('admin', { action: 'examInterruption', attemptId }))
    } catch {
      /* 이력이 없거나 옛 응시 — 패널을 통째로 감춘다 */
    }
  }, [attemptId])
  // Checkout.tsx 와 같은 모양 — 조회는 effect 바깥(비동기 콜백)에서 상태를 만진다.
  useEffect(() => { ;(async () => { await load() })() }, [load])

  if (!data) return null
  const { attempt, summary, events } = data
  // 중단 흔적이 전혀 없는 평범한 응시에는 아무것도 띄우지 않는다(모달을 어지럽히지 않기 위해).
  // 진행중인데 오래 끊겨 있는 응시도 보여준다 — 응시창이 닫힌 뒤 사고가 접수되면 무효가 아니라
  // in_progress 로 남아 있고, 그게 바로 복구가 필요한 상태다(start-exam 의 resume_blocked).
  const stalled = attempt.status === 'in_progress' && Boolean(attempt.last_seen_at)
  if (attempt.status !== 'voided' && !stalled && summary.reentryCount === 0 && !attempt.reinstated_at) return null

  async function reinstate() {
    if (!note.trim()) { setMsg('복구 사유를 적어주세요.'); return }
    setBusy(true)
    setMsg('')
    try {
      const r = await callFunction<{ note?: string }>('admin', { action: 'examReinstate', attemptId, note, graceDays })
      setMsg(r.note ?? '복구했습니다.')
      setNote('')
      await load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '복구하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-card" style={{ margin: '12px 0', padding: 14, border: '1px solid var(--line2)', borderRadius: 10 }}>
      <b style={{ display: 'block', marginBottom: 8 }}>응시 중단 기록</b>

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0, fontSize: 14 }}>
        <dt>무효 사유</dt>
        <dd style={{ margin: 0 }}>
          {attempt.void_reason === 'reentry'
            ? '응시 화면을 벗어났다 다시 들어옴'
            : attempt.void_reason === 'quit'
              ? '응시자가 스스로 종료(포기)'
              : (attempt.void_reason ?? '-')}
        </dd>

        {/* ⭐ 판단의 핵심 — 이 한 줄이 '사고'와 '일부러 나감'을 가른다 */}
        <dt>닫힘 신호</dt>
        <dd style={{ margin: 0 }}>
          {summary.hadCloseSignal
            ? `있음 — 사람이 창을 닫았다는 뜻${summary.closeVia ? ` (${summary.closeVia})` : ''}`
            : '없음 — 알릴 틈이 없이 끊김(정전·PC 정지 등에서 나타나는 모양)'}
        </dd>

        <dt>비어 있던 시간</dt>
        <dd style={{ margin: 0 }}>{fmtGap(summary.gapSec)}</dd>

        <dt>끊긴 시점 진행률</dt>
        <dd style={{ margin: 0 }}>
          {summary.answered} / {summary.totalQuestions} 문항
          {summary.answered === 0 && summary.totalQuestions > 0 && ' — 한 문항도 답하지 않음'}
        </dd>

        <dt>재진입 횟수</dt>
        <dd style={{ margin: 0 }}>{summary.reentryCount}회</dd>
      </dl>

      <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>
        {events.map((e, i) => (
          <div key={i}>
            {fmtDT(e.at)} · {EVENT_LABEL[e.kind] ?? e.kind}
          </div>
        ))}
      </div>

      {attempt.reinstated_at ? (
        <p style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6 }}>
          <b>복구됨</b> — {fmtDT(attempt.reinstated_at)} · {attempt.reinstated_by} · 사유: {attempt.reinstate_note}
          {/* 아직 안 들어온 상태 = 시계가 멈춰 있다. 언제까지 들어와야 하는지가 문의 응대의 핵심이다. */}
          {attempt.resume_deadline && (
            <>
              <br />
              응시 기한 <b>{fmtDT(attempt.resume_deadline)}</b> 까지 · 제한시간은 처음부터 다시 ·
              시계는 응시자가 다시 들어오는 순간부터 갑니다.
            </>
          )}
        </p>
      ) : attempt.status !== 'submitted' ? (
        <div style={{ marginTop: 12 }}>
          {/* ⚠️ 새 응시가 아니다 — 문항 세트는 그대로고 이미 쓴 시간도 돌려주지 않는다(남은 시간만 복원).
              "처음부터 다시" 가 필요하면 응시권을 새로 발급하는 게 맞다. */}
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6, lineHeight: 1.6 }}>
            복구하면 <b>제한시간을 처음부터 다시</b> 받고, 시계는 <b>응시자가 실제로 다시 들어오는 순간부터</b> 갑니다.
            아래 기한 안에는 <b>응시 기간이 끝났어도</b> 들어갈 수 있습니다. 문항 세트는 그대로입니다.
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="복구 사유 (예: 정전 문의 접수, 닫힘 신호 없음 확인)"
            style={{ width: '100%', padding: '8px 10px', marginBottom: 6 }}
          />
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            응시 기한{' '}
            <input
              type="number"
              min={1}
              max={30}
              value={graceDays}
              onChange={(e) => setGraceDays(Number(e.target.value))}
              style={{ width: 64, padding: '4px 6px' }}
            />{' '}
            일 이내
          </label>
          <button className="admin-mini" onClick={reinstate} disabled={busy}>
            {busy ? '복구 중…' : '이 응시 복구'}
          </button>
        </div>
      ) : null}

      {msg && <p style={{ marginTop: 8, fontSize: 13 }}>{msg}</p>}
    </div>
  )
}

// ── 게시판 분류(board_categories) — 공지·FAQ 가 같은 표를 쓰고 kind 로 갈린다 (2026-08-19) ──
//   예전엔 분류가 여기 상수(NOTICE_CATS/FAQ_CATS)와 i18n 사전 두 곳에 박혀 있어서, 하나 늘리려면
//   개발자가 고치고 배포해야 했다. 지금은 관리자가 '분류 관리' 모달에서 만들고 고치고 지운다.
//   ⛔ 분류를 지워도 글은 안 지운다 — 그 글들은 '미분류' 로 내려오고(공개 화면에선 안 보인다)
//      여기서 다시 분류를 지정하면 살아난다. 서버 주석(admin/index.ts 의 boardCat*)과 한 쌍이다.
interface BoardCat {
  id: string
  key: string
  labelI18n: I18nText
  icon: string
  sort: number
  count: number // 이 분류를 쓰는 글 수(미공개 포함)
}
type BoardKind = 'notice' | 'faq'
interface BoardCatResp {
  categories: BoardCat[]
  orphans: { key: string; count: number }[]
}
const KIND_WORD: Record<BoardKind, string> = { notice: '공지', faq: 'FAQ' }

/** FAQ 사이드바 아이콘 후보. 관리자가 Material Symbols 이름을 외울 필요가 없게 골라 담았다. */
const CAT_ICONS = ['help', 'calendar_month', 'computer', 'credit_card', 'workspace_premium', 'domain', 'school', 'description', 'support_agent', 'settings']

function useBoardCats(kind: BoardKind) {
  const [cats, setCats] = useState<BoardCat[]>([])
  const [orphans, setOrphans] = useState<{ key: string; count: number }[]>([])
  const reloadCats = useCallback(async () => {
    try {
      const r = await callFunction<BoardCatResp>('admin', { action: 'boardCatList', kind })
      setCats(r.categories ?? [])
      setOrphans(r.orphans ?? [])
    } catch {
      /* 분류를 못 불러와도 글 목록은 보여야 한다 — 이름 대신 키가 그대로 뜬다. */
    }
  }, [kind])
  useEffect(() => {
    reloadCats()
  }, [reloadCats])
  return { cats, orphans, reloadCats }
}

/** 분류 이름. 지워진 분류(고아)면 키를 그대로 보여준다 — 무슨 값이었는지 알아야 다시 지정할 수 있다. */
function catLabelOf(cats: BoardCat[], key: string): string {
  return cats.find((c) => c.key === key)?.labelI18n?.ko || key
}
const isOrphanCat = (cats: BoardCat[], key: string) => !!key && !cats.some((c) => c.key === key)

/** 분류 관리 모달 — 추가·이름 수정·순서·삭제. 공지·FAQ 화면이 같은 것을 띄운다. */
function BoardCatModal({ kind, onClose, onChanged }: { kind: BoardKind; onClose: () => void; onChanged: () => void }) {
  const [cats, setCats] = useState<BoardCat[]>([])
  const [orphans, setOrphans] = useState<{ key: string; count: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 편집 중인 한 건. id 가 없으면 새로 만드는 중.
  const [draft, setDraft] = useState<{ id?: string; key: string; labelKo: string; icon: string } | null>(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await callFunction<BoardCatResp>('admin', { action: 'boardCatList', kind })
      setCats(r.categories ?? [])
      setOrphans(r.orphans ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '분류를 불러올 수 없습니다.')
    }
  }, [kind])
  useEffect(() => {
    load()
  }, [load])

  async function call(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null }>('admin', body)
      await load()
      onChanged()
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:' + String.fromCharCode(10) + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft) return
    if (!draft.labelKo.trim()) {
      alert('한국어 분류 이름은 필수입니다.')
      return
    }
    await call({
      action: 'boardCatUpsert',
      kind,
      category: { id: draft.id, key: draft.key, icon: draft.icon, labelI18n: { ko: draft.labelKo.trim() } },
    })
    setDraft(null)
  }

  async function remove(c: BoardCat) {
    // ⚠️ 몇 건이 딸려 내려가는지 **먼저** 알려준다. 지워도 글은 남지만, 공개 화면에서 사라지는 건 사실이다.
    const name = c.labelI18n.ko || c.key
    const msg = c.count > 0
      ? [
          `"${name}" 분류를 지울까요?`,
          '',
          `이 분류를 쓰는 ${KIND_WORD[kind]} ${c.count}건은 삭제되지 않지만,`,
          '· 사용자 화면에서는 내려갑니다',
          `· 관리자 목록에서 '미분류' 로 모입니다 (분류를 다시 지정하면 다시 보입니다)`,
        ].join(String.fromCharCode(10))
      : `"${name}" 분류를 지울까요?`
    if (!confirm(msg)) return
    await call({ action: 'boardCatDelete', id: c.id })
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= cats.length) return
    const next = [...cats]
    ;[next[i], next[j]] = [next[j], next[i]]
    setCats(next) // 낙관적 반영 — 눌렀는데 안 움직이는 것처럼 보이지 않게
    await call({ action: 'boardCatReorder', ids: next.map((c) => c.id) })
  }

  return (
    <div className="admin-modal-bg">
      {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 다른 모달과 같은 규칙(입력하던 값이 날아간다). */}
      <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2 style={{ margin: 0 }}>{KIND_WORD[kind]} 분류 관리</h2>
        <p style={{ margin: '8px 0 14px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          한국어 이름만 쓰면 저장할 때 나머지 5개국어로 자동 번역됩니다.
          분류를 지워도 글은 지워지지 않고 ‘미분류’로 내려갑니다.
        </p>

        {err && <div className="admin-section admin-empty">{err}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>순서</th>
                <th>이름 (한국어)</th>
                <th>키</th>
                <th style={{ textAlign: 'right' }}>글</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <button className="admin-mini" disabled={busy || i === 0} onClick={() => move(i, -1)} title="위로">↑</button>
                    <button className="admin-mini" style={{ marginLeft: 4 }} disabled={busy || i === cats.length - 1} onClick={() => move(i, 1)} title="아래로">↓</button>
                  </td>
                  <td>
                    {kind === 'faq' && c.icon && (
                      <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: -4, marginRight: 6, opacity: 0.7 }}>{c.icon}</span>
                    )}
                    {c.labelI18n.ko || <span style={{ color: 'var(--muted)' }}>(이름 없음)</span>}
                  </td>
                  <td style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: 13 }}>{c.key}</td>
                  <td style={{ textAlign: 'right' }}>{c.count}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="admin-mini" disabled={busy} onClick={() => setDraft({ id: c.id, key: c.key, labelKo: c.labelI18n.ko ?? '', icon: c.icon })}>편집</button>
                    <button className="admin-mini" style={{ marginLeft: 6 }} disabled={busy} onClick={() => remove(c)}>삭제</button>
                  </td>
                </tr>
              ))}
              {!cats.length && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>분류가 없습니다.</td></tr>
              )}
              {/* 고아 = 지워진(또는 옛) 분류를 달고 있는 글들. 같은 키로 다시 만들면 그대로 돌아온다. */}
              {orphans.map((o) => (
                <tr key={`orphan-${o.key}`}>
                  <td />
                  <td style={{ color: 'var(--muted)' }}>미분류</td>
                  <td style={{ color: 'var(--muted)', fontFamily: 'monospace', fontSize: 13 }}>{o.key}</td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{o.count}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="admin-mini" disabled={busy} onClick={() => setDraft({ key: o.key, labelKo: '', icon: '' })}>이 키로 되살리기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {draft ? (
          <div className="admin-section" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{draft.id ? '분류 편집' : '새 분류'}</h3>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ ...fieldStyle, flex: 2, minWidth: 160 }}>
                이름 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input type="text" style={inpStyle} value={draft.labelKo} onChange={(e) => setDraft({ ...draft, labelKo: e.target.value })} placeholder="예: 채용 공고" />
              </label>
              <label style={{ ...fieldStyle, flex: 1, minWidth: 150 }}>
                {/* ⚠️ 키는 만들 때만 정한다 — 나중에 바꾸면 그 분류를 쓰던 글이 통째로 미분류가 된다(서버도 무시한다). */}
                키 {draft.id ? <em style={{ color: 'var(--muted)' }}>(변경 불가)</em> : <em style={{ color: 'var(--muted)' }}>(영문 소문자)</em>}
                <input
                  type="text"
                  style={{ ...inpStyle, fontFamily: 'monospace', opacity: draft.id ? 0.6 : 1 }}
                  value={draft.key}
                  disabled={!!draft.id}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                  placeholder="recruit"
                />
              </label>
              {kind === 'faq' && (
                <label style={{ ...fieldStyle, flex: 1, minWidth: 150 }}>
                  아이콘
                  <select style={inpStyle} value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}>
                    <option value="">(없음)</option>
                    {CAT_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="admin-mini" onClick={() => setDraft(null)}>취소</button>
              <button className="admin-mini" disabled={busy} onClick={save}>{busy ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="admin-mini" onClick={() => setDraft({ key: '', labelKo: '', icon: '' })}>+ 새 분류</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 공지사항 관리 (admin 함수의 noticeList/noticeUpsert/noticeDelete) ──
interface NoticeDraft {
  id?: string
  category: string
  required: boolean
  pinned: boolean
  published: boolean
  publishedAt: string // YYYY-MM-DD (편집용)
  titleI18n: I18nText
  bodyI18n: I18nText
}

function emptyDraft(): NoticeDraft {
  return {
    category: 'guide',
    required: false,
    pinned: false,
    published: true,
    publishedAt: new Date().toISOString().slice(0, 10),
    titleI18n: {},
    bodyI18n: {},
  }
}

function fmtDay(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}. ${p(d.getMonth() + 1)}. ${p(d.getDate())}`
}

const inpStyle: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--line2)',
  // 배경을 transparent 로 두면 모달 배경(--page)과 같은 색이라 입력칸이 안 보인다.
  // 회색 반투명 채움 → 라이트(밝은 배경 위)·다크(어두운 배경 위) 양쪽에서 배경과 대비된다.
  background: 'rgba(128,128,128,.10)',
  color: 'inherit',
  font: 'inherit',
  width: '100%',
}
const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 13,
  color: 'var(--muted)',
}

// 공지 본문 WYSIWYG 에디터(react-quill) — 관리자 전용이라 lazy 로딩(공개 번들에 Quill 제외)
const RichEditor = lazy(() => import('../components/RichEditor'))

function NoticesAdmin() {
  const [rows, setRows] = useState<NoticeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<NoticeDraft | null>(null)
  const [saving, setSaving] = useState(false)
  // 분류는 DB(board_categories)에서 온다 — 관리자가 '분류 관리' 에서 만든 그대로.
  const { cats, reloadCats } = useBoardCats('notice')
  const [catOpen, setCatOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminNoticeListResponse>('admin', { action: 'noticeList' })
      setRows(res.notices)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '공지를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // 작성 중 자동 임시저장.
  //   ⚠️ 옛 방식(`notice-draft` 키 하나 + 새로 쓸 때 confirm 한 번)은 ① 저장되고 있는지 알 수 없고
  //      ② 그 confirm 을 놓치면 초안이 영영 묻혔고 ③ **편집 중인 공지는 아예 안 지켜졌다**(새 공지만 저장).
  //      지금은 공용 훅으로 바꿔 새 글·편집 모두 지키고, 목록에서 골라 불러온다.
  const noticeDraft = useDraft({
    kind: 'notice',
    refId: draft?.id,
    value: draft,
    title: draft?.titleI18n?.ko?.trim() || '제목 없는 공지',
    enabled: !!draft,
  })

  // 본문 입력 방식 — 편집기(WYSIWYG) ↔ HTML 소스. 만들어온 HTML 은 소스 쪽으로 들어온다.
  //   ⚠️ 이 상태는 draft 와 같이 초기화해야 한다 — HTML 모드로 켜둔 채 다른 공지를 열면
  //      평범한 글을 소스 편집기로 마주하게 된다.
  const [htmlMode, setHtmlMode] = useState(false)
  const [htmlNotes, setHtmlNotes] = useState<string[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)

  // 들여오기 = 정리(importNoticeHtml) → **표준 폭 맞추기**(fitNoticeHtml) 한 벌.
  //   ⚠️ 파일과 붙여넣기가 같은 경로를 타야 한다 — 한쪽만 폭을 맞추면 어떻게 넣었는지에 따라
  //      같은 파일이 다른 크기로 올라간다.
  function takeHtml(source: string) {
    const { html, notes } = importNoticeHtml(source)
    const fit = fitNoticeHtml(html)
    patchBody(fit.html)
    setHtmlNotes(fit.note ? [...notes, fit.note] : notes)
  }

  // .html 파일을 골라 본문으로. 붙여넣기와 **같은 정리 경로**를 탄다(둘이 다르면 결과가 갈린다).
  async function pickHtmlFile() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.html,.htm,text/html'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      // ⚠️ 모드를 **먼저** 바꾼다 — 편집기가 붙어 있는 채로 본문을 넣으면 그 순간 CSS 가 지워진다.
      setHtmlMode(true)
      takeHtml(await file.text())
    }
    input.click()
  }

  // 소스칸에 통짜 문서를 붙여넣은 경우도 같이 편다(파일로 넣은 것과 결과가 같아야 한다).
  function patchBodySource(v: string) {
    if (/<html[\s>]|<body[\s>]/i.test(v)) {
      takeHtml(v)
      return
    }
    patchBody(v)
  }

  function openNew() {
    setHtmlMode(false)
    setHtmlNotes([])
    // 첫 분류를 기본값으로 — 분류를 다 지운 상태면 옛 기본값('guide')이 남지만, 저장 즉시 미분류로 보인다.
    setDraft({ ...emptyDraft(), category: cats[0]?.key ?? 'guide' })
  }
  function openEdit(n: NoticeRow) {
    // ⚠️ 만들어 온 HTML(=<style> 이 든 본문)은 **편집기로 열면 안 된다.** Quill 은 자기가 아는
    //    서식만 남기고 나머지를 버리는데, 여는 즉시 onChange 가 한 번 돌아 `<style>` 이 통째로
    //    사라진다 — 오타 하나 고치러 들어갔다가 디자인이 날아가고 그대로 저장된다(실측).
    setHtmlMode(isIsolatedHtml(n.bodyI18n.ko ?? ''))
    setHtmlNotes([])
    setDraft({
      id: n.id,
      category: n.category,
      required: n.required,
      pinned: n.pinned,
      published: n.published,
      publishedAt: (n.publishedAt || '').slice(0, 10),
      titleI18n: { ...n.titleI18n },
      bodyI18n: { ...n.bodyI18n },
    })
  }
  function patch(p: Partial<NoticeDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function patchTitle(v: string) {
    setDraft((d) => (d ? { ...d, titleI18n: { ...d.titleI18n, ko: v } } : d))
  }
  function patchBody(v: string) {
    setDraft((d) => (d ? { ...d, bodyI18n: { ...d.bodyI18n, ko: v } } : d))
  }

  async function save() {
    if (!draft) return
    if (!draft.titleI18n.ko?.trim()) {
      alert('한국어 제목은 필수입니다.')
      return
    }
    setSaving(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null }>('admin', {
        action: 'noticeUpsert',
        notice: {
          ...draft,
          publishedAt: draft.publishedAt
            ? new Date(draft.publishedAt + 'T00:00:00+09:00').toISOString()
            : null,
        },
      })
      noticeDraft.clear() // 저장됐으니 초안은 더 필요 없다
      setDraft(null)
      await load()
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function remove(n: NoticeRow) {
    if (!confirm(`"${n.titleI18n.ko ?? ''}" 공지를 삭제할까요?`)) return
    try {
      await callFunction('admin', { action: 'noticeDelete', id: n.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>공지사항 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={() => setCatOpen(true)}>
            분류 관리
          </button>
          <button className="admin-mini" onClick={openNew}>
            + 새 공지
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>분류</th>
              <th>제목 (한국어)</th>
              <th>게시일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${n.published ? 'submitted' : 'voided'}`}>
                    {n.published ? '공개' : '비공개'}
                  </span>
                  {n.pinned && (
                    <span className="admin-badge st-in_progress" style={{ marginLeft: 6 }}>
                      고정
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {/* 지워진 분류를 달고 있는 글 — 공개 화면에선 이미 안 보인다. 편집에서 다시 지정하면 살아난다. */}
                  {isOrphanCat(cats, n.category) ? (
                    <span style={{ color: 'var(--muted)' }} title={`분류 '${n.category}' 가 삭제됨 — 편집에서 다시 지정하세요`}>
                      미분류 ({n.category})
                    </span>
                  ) : (
                    catLabelOf(cats, n.category)
                  )}
                  {n.required && (
                    <span className="admin-badge st-voided" style={{ marginLeft: 6 }}>
                      필독
                    </span>
                  )}
                </td>
                <td>{n.titleI18n.ko || <span style={{ color: 'var(--muted)' }}>(제목 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDay(n.publishedAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => openEdit(n)}>
                    편집
                  </button>
                  <button
                    className="admin-mini"
                    style={{ marginLeft: 6 }}
                    onClick={() => remove(n)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  등록된 공지가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {catOpen && (
        <BoardCatModal
          kind="notice"
          onClose={() => setCatOpen(false)}
          onChanged={() => {
            reloadCats()
            load() // 분류가 바뀌면 목록의 '미분류' 표시도 같이 바뀐다
          }}
        />
      )}

      {draft && (
        <div className="admin-modal-bg">
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{draft.id ? '공지 편집' : '새 공지'}</h2>
              <DraftBar
                status={noticeDraft.status}
                savedAt={noticeDraft.savedAt}
                drafts={noticeDraft.drafts}
                onRefresh={noticeDraft.refresh}
                onRestore={(p: NoticeDraft) => setDraft(p)}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...fieldStyle, flex: 1, minWidth: 120 }}>
                  분류
                  <select
                    style={inpStyle}
                    value={draft.category}
                    onChange={(e) => patch({ category: e.target.value })}
                  >
                    {/* 지워진 분류를 달고 있는 글도 열 수 있어야 한다 — 없는 값이면 select 가 첫 항목으로
                        튀어서, 저장만 눌러도 조용히 다른 분류가 된다. 그래서 현재 값을 임시 항목으로 넣는다. */}
                    {isOrphanCat(cats, draft.category) && (
                      <option value={draft.category}>미분류 ({draft.category})</option>
                    )}
                    {cats.map((c) => (
                      <option key={c.id} value={c.key}>
                        {c.labelI18n.ko || c.key}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...fieldStyle, flex: 1, minWidth: 120 }}>
                  게시일
                  <input
                    type="date"
                    style={inpStyle}
                    value={draft.publishedAt}
                    onChange={(e) => patch({ publishedAt: e.target.value })}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  공개
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={draft.pinned}
                    onChange={(e) => patch({ pinned: e.target.checked })}
                  />
                  상단 고정
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(e) => patch({ required: e.target.checked })}
                  />
                  필독
                </label>
              </div>

              <label style={fieldStyle}>
                제목 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.titleI18n.ko ?? ''}
                  onChange={(e) => patchTitle(e.target.value)}
                  placeholder="공지 제목"
                />
              </label>
              <div style={fieldStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span>본문 <em style={{ color: 'var(--muted)' }}>(한국어 · 서식·이미지 가능)</em></span>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="admin-mini"
                    aria-pressed={!htmlMode}
                    style={!htmlMode ? { fontWeight: 700 } : undefined}
                    onClick={() => {
                      // 되돌릴 수 없다 — 편집기가 열리는 순간 CSS 가 사라지고 취소해도 안 돌아온다.
                      if (
                        isIsolatedHtml(draft.bodyI18n.ko ?? '') &&
                        !confirm(
                          '편집기로 열면 이 공지의 디자인(CSS)이 사라지고 글자만 남습니다. 되돌릴 수 없습니다.' +
                            String.fromCharCode(10, 10) +
                            '계속할까요?',
                        )
                      ) return
                      setHtmlMode(false)
                    }}
                  >
                    편집기
                  </button>
                  <button
                    type="button"
                    className="admin-mini"
                    aria-pressed={htmlMode}
                    style={htmlMode ? { fontWeight: 700 } : undefined}
                    onClick={() => setHtmlMode(true)}
                  >
                    HTML
                  </button>
                  <button type="button" className="admin-mini" onClick={pickHtmlFile}>
                    HTML 파일 불러오기
                  </button>
                  {/* 저장 **전에** 확인할 수 있어야 한다 — 예전엔 저장하고 실제 공지를 열어봐야
                      어떻게 나오는지 알 수 있었다. */}
                  <button
                    type="button"
                    className="admin-mini"
                    onClick={() => setPreviewOpen(true)}
                    disabled={!(draft.bodyI18n.ko ?? '').trim()}
                  >
                    미리보기
                  </button>
                </div>
                {htmlMode ? (
                  <textarea
                    style={{
                      ...inpStyle,
                      minHeight: 380,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: 'pre',
                      overflowWrap: 'normal',
                      overflowX: 'auto',
                    }}
                    value={draft.bodyI18n.ko ?? ''}
                    onChange={(e) => patchBodySource(e.target.value)}
                    placeholder="<style> 와 태그를 그대로 붙여넣으세요. 통짜 문서(<html>…)를 넣으면 본문만 알아서 추려냅니다."
                    spellCheck={false}
                  />
                ) : (
                  <Suspense fallback={<div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>에디터 불러오는 중…</div>}>
                    <RichEditor value={draft.bodyI18n.ko ?? ''} onChange={patchBody} />
                  </Suspense>
                )}
                {htmlNotes.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--error, #d43a3a)', lineHeight: 1.6 }}>
                    {htmlNotes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 저장하면 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역되어 올라갑니다.
                (한국어 원문 기준 · 수정 후 저장하면 다시 번역)
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="admin-mini" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="btn-ink" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && draft && (
        <NoticePreviewModal
          title={draft.titleI18n.ko ?? ''}
          body={draft.bodyI18n.ko ?? ''}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  )
}

/**
 * 공지 미리보기 — 저장 전에 PC·폰 양쪽을 확인한다.
 *
 * ⚠️ 실제 공지 화면과 **같은 렌더러(<HtmlBody>)** 를 쓴다. 여기서 따로 그리면 미리보기는
 *    멀쩡한데 올려놓고 보니 다른, 제일 나쁜 상태가 된다.
 * ⚠️ 폰 칸은 `width:390px` 로 **자리만** 좁힌다 — 축소는 HtmlBody 가 알아서 한다(같은 규칙이
 *    실제 폰에서도 돌아야 하므로 여기서 배율을 흉내내면 안 된다).
 */
function NoticePreviewModal({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  const [device, setDevice] = useState<'pc' | 'phone'>('pc')
  const phone = device === 'phone'
  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div
        className="admin-modal admin-modal-wide"
        style={{ maxWidth: 'min(1180px, 96vw)', height: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2 style={{ marginBottom: 4 }}>{title || '(제목 없음)'}</h2>
        <p className="admin-modal-meta" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          미리보기 — 실제 공지 화면과 같은 방식으로 그립니다
          <span style={{ flex: 1 }} />
          <button type="button" className="admin-mini" aria-pressed={!phone}
            style={!phone ? { fontWeight: 700 } : undefined} onClick={() => setDevice('pc')}>
            PC
          </button>
          <button type="button" className="admin-mini" aria-pressed={phone}
            style={phone ? { fontWeight: 700 } : undefined} onClick={() => setDevice('phone')}>
            폰
          </button>
        </p>
        <div style={{ flex: 1, overflow: 'auto', background: '#f1f3f7', borderRadius: 10, padding: 16 }}>
          <div
            style={{
              // PC = 표준 폭 + 카드 여백 24×2 + 테두리 1×2(공지 화면의 카드와 같은 값), 폰 = 흔한 화면 폭.
              // ⚠️ 2px만 모자라도 미리보기에만 가로 스크롤바가 떠서 실제 화면과 달라 보인다.
              width: phone ? 390 : NOTICE_WIDTH + 50,
              maxWidth: '100%',
              margin: '0 auto',
              background: '#fff',
              border: '1px solid #d7dbe3',
              borderRadius: 12,
              padding: phone ? 16 : 24,
              color: '#20293c',
            }}
          >
            <HtmlBody html={body} className="notice-content" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── FAQ 관리 (admin 함수의 faqList/faqUpsert/faqDelete) ──
//   분류는 공지와 같은 표(board_categories, kind='faq')에서 온다 — 위 BoardCatModal 참고.
/** 미분류(지워진 분류를 달고 있는 글) 묶음을 가리키는 화면 전용 키. DB 에 저장되는 값이 아니다. */
const FAQ_NONE = '__none__'

interface FaqDraft {
  id?: string
  category: string
  sort: number
  published: boolean
  questionI18n: I18nText
  answerI18n: I18nText
  tagI18n: I18nText
}

function emptyFaqDraft(): FaqDraft {
  return { category: '', sort: 9999, published: true, questionI18n: {}, answerI18n: {}, tagI18n: {} }
}

function FaqAdmin() {
  const [rows, setRows] = useState<FaqRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const { cats, reloadCats } = useBoardCats('faq')
  const [catOpen, setCatOpen] = useState(false)
  const [draft, setDraft] = useState<FaqDraft | null>(null)
  const faqDraft = useDraft({ kind: 'faq', refId: draft?.id, value: draft, title: draft?.questionI18n?.ko?.trim() || '새 FAQ', enabled: !!draft })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [catFilter, setCatFilter] = useState<string>('schedule')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminFaqListResponse>('admin', { action: 'faqList' })
      setRows(res.faqs)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'FAQ를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function openNew() {
    // 보고 있던 분류로 시작한다. '미분류' 를 보던 중이면 첫 분류로(미분류는 저장할 수 있는 값이 아니다).
    const base = catFilter === FAQ_NONE ? (cats[0]?.key ?? '') : catFilter
    setDraft({ ...emptyFaqDraft(), category: base })
  }
  function openEdit(f: FaqRow) {
    setDraft({
      id: f.id,
      category: f.category,
      sort: f.sort,
      published: f.published,
      questionI18n: { ...f.questionI18n },
      answerI18n: { ...f.answerI18n },
      tagI18n: { ...f.tagI18n },
    })
  }
  function patch(p: Partial<FaqDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function patchField(k: 'questionI18n' | 'answerI18n' | 'tagI18n', v: string) {
    setDraft((d) => (d ? { ...d, [k]: { ...d[k], ko: v } } : d))
  }

  async function save() {
    if (!draft) return
    if (!draft.questionI18n.ko?.trim()) {
      alert('한국어 질문은 필수입니다.')
      return
    }
    setSaving(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null }>('admin', {
        action: 'faqUpsert',
        faq: draft,
      })
      faqDraft.clear()
      setDraft(null)
      await load()
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function remove(f: FaqRow) {
    if (!confirm(`"${f.questionI18n.ko ?? ''}" FAQ를 삭제할까요?`)) return
    try {
      await callFunction('admin', { action: 'faqDelete', id: f.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  // 같은 분류 안에서 ↑(-1)/↓(+1) 이동 → 전체 순서 재구성해 서버가 sort 재부여
  async function move(f: FaqRow, dir: -1 | 1) {
    const group = rows.filter((r) => r.category === f.category).sort((a, b) => a.sort - b.sort)
    const idx = group.findIndex((r) => r.id === f.id)
    const swap = idx + dir
    if (swap < 0 || swap >= group.length) return
    const g = [...group]
    ;[g[idx], g[swap]] = [g[swap], g[idx]]
    const catKeys = cats.map((c) => c.key)
    const known = new Set<string>(catKeys)
    const ids: string[] = []
    for (const key of catKeys) {
      if (key === f.category) g.forEach((r) => ids.push(r.id))
      else rows.filter((r) => r.category === key).sort((a, b) => a.sort - b.sort).forEach((r) => ids.push(r.id))
    }
    rows.filter((r) => !known.has(r.category)).sort((a, b) => a.sort - b.sort).forEach((r) => ids.push(r.id))
    setBusy(true)
    try {
      await callFunction('admin', { action: 'faqReorder', ids })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '순서 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  // 고른 분류가 사라졌으면(그 분류를 방금 지웠다면) 첫 분류로 접는다 — 빈 화면을 보여주지 않는다.
  const activeCat =
    catFilter === FAQ_NONE || cats.some((c) => c.key === catFilter) ? catFilter : (cats[0]?.key ?? catFilter)
  const orphanRows = rows.filter((r) => isOrphanCat(cats, r.category))
  const group = (activeCat === FAQ_NONE ? orphanRows : rows.filter((r) => r.category === activeCat)).sort(
    (a, b) => a.sort - b.sort,
  )

  return (
    <>
      <div className="admin-head">
        <h1>FAQ 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={() => setCatOpen(true)}>
            분류 관리
          </button>
          <button className="admin-mini" onClick={openNew}>
            + 새 FAQ
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      {/* 분류 버튼 — 눌러서 해당 분류만 보기(공개 FAQ 사이드바처럼) */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {cats.map((c) => {
          const count = rows.filter((r) => r.category === c.key).length
          return (
            <button
              key={c.id}
              className={activeCat === c.key ? 'on' : ''}
              onClick={() => setCatFilter(c.key)}
            >
              {c.labelI18n.ko || c.key}
              {count > 0 && <span style={{ opacity: 0.55, marginLeft: 5 }}>{count}</span>}
            </button>
          )
        })}
        {/* 분류가 지워져 갈 곳을 잃은 글들. 있을 때만 칸이 생긴다 — 평소엔 없는 게 정상이다. */}
        {orphanRows.length > 0 && (
          <button className={activeCat === FAQ_NONE ? 'on' : ''} onClick={() => setCatFilter(FAQ_NONE)}>
            미분류
            <span style={{ opacity: 0.55, marginLeft: 5 }}>{orphanRows.length}</span>
          </button>
        )}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>질문 (한국어)</th>
              <th style={{ textAlign: 'center' }}>순서</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {group.map((f, i) => (
              <tr key={f.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${f.published ? 'submitted' : 'voided'}`}>
                    {f.published ? '공개' : '비공개'}
                  </span>
                </td>
                <td>{f.questionI18n.ko || <span style={{ color: 'var(--muted)' }}>(질문 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                  <button
                    className="admin-mini"
                    disabled={busy || i === 0}
                    onClick={() => move(f, -1)}
                    aria-label="위로"
                    title="위로"
                  >
                    ↑
                  </button>
                  <button
                    className="admin-mini"
                    style={{ marginLeft: 4 }}
                    disabled={busy || i === group.length - 1}
                    onClick={() => move(f, 1)}
                    aria-label="아래로"
                    title="아래로"
                  >
                    ↓
                  </button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => openEdit(f)}>
                    편집
                  </button>
                  <button className="admin-mini" style={{ marginLeft: 6 }} onClick={() => remove(f)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!group.length && !loading && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {activeCat === FAQ_NONE ? '미분류 FAQ가 없습니다.' : '이 분류에 FAQ가 없습니다. “+ 새 FAQ”로 추가하세요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {catOpen && (
        <BoardCatModal
          kind="faq"
          onClose={() => setCatOpen(false)}
          onChanged={() => {
            reloadCats()
            load() // 분류가 바뀌면 칸·'미분류' 묶음도 같이 바뀐다
          }}
        />
      )}

      {draft && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><h2 style={{ margin: 0 }}>{draft.id ? 'FAQ 편집' : '새 FAQ'}</h2><DraftBar status={faqDraft.status} savedAt={faqDraft.savedAt} drafts={faqDraft.drafts} onRefresh={faqDraft.refresh} onRestore={(p: FaqDraft) => setDraft(p)} /></div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...fieldStyle, flex: 2, minWidth: 140 }}>
                  분류
                  <select
                    style={inpStyle}
                    value={draft.category}
                    onChange={(e) => patch({ category: e.target.value })}
                  >
                    {/* 공지와 같은 이유 — 없는 값이면 select 가 첫 항목으로 튀어 조용히 분류가 바뀐다. */}
                    {isOrphanCat(cats, draft.category) && (
                      <option value={draft.category}>미분류 ({draft.category})</option>
                    )}
                    {cats.map((c) => (
                      <option key={c.id} value={c.key}>
                        {c.labelI18n.ko || c.key}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, alignSelf: 'flex-end', paddingBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  공개
                </label>
              </div>

              <label style={fieldStyle}>
                질문 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.questionI18n.ko ?? ''}
                  onChange={(e) => patchField('questionI18n', e.target.value)}
                  placeholder="질문"
                />
              </label>
              <label style={fieldStyle}>
                답변 <em style={{ color: 'var(--muted)' }}>(한국어)</em>
                <textarea
                  rows={5}
                  style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.6 }}
                  value={draft.answerI18n.ko ?? ''}
                  onChange={(e) => patchField('answerI18n', e.target.value)}
                  placeholder="답변"
                />
              </label>
              <label style={fieldStyle}>
                태그 <em style={{ color: 'var(--muted)' }}>(한국어 · 선택, 짧은 라벨)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.tagI18n.ko ?? ''}
                  onChange={(e) => patchField('tagI18n', e.target.value)}
                  placeholder="예: 응시 환경"
                />
              </label>
              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 저장하면 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역되어 올라갑니다.
                (한국어 원문 기준 · 수정 후 저장하면 다시 번역)
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="admin-mini" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="btn-ink" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── 채팅 검수 (유사채팅 보드) — admin 함수의 chatModList / chatHide / chatUnhide / chatApprove ──
//   ⚠️ 이 컴포넌트는 WORLD ARENA 관리자(AdminLevelTest.tsx)로 노출 위치를 옮겼다(export). 데이터는 여전히 admin 함수.
//
// 2026-08-05 개편. 옛 화면의 문제 세 가지를 한꺼번에 걷어냈다:
//   · 신고 건별로 줄이 생겨서 같은 메시지가 3번 나왔다(버튼도 3벌 → 하나 누르면 셋이 같이 회색).
//   · 처리한 것과 안 한 것이 한 표에 섞여 할 일이 몇 개인지 셀 수 없었다.
//   · '신고 목록'과 '검수 대기' 표가 따로 있었는데 관리자가 내리는 결정은 어차피 같았다.
// 지금은 **메시지 1건 = 1줄**, `처리 대기 / 처리 완료` 탭 2개, 방 필터 하나.
interface ChatModReport {
  id: string
  reporterId: string | null
  reporterName: string | null
  reason: string | null
  status: string
  createdAt: string
}
interface ChatModRow {
  id: number
  userId: string | null
  displayName: string | null
  isAnon: boolean
  body: string | null
  room: string | null
  modStatus: string
  deletedAt: string | null
  hiddenBy: string | null
  createdAt: string
  reportCount: number
  openCount: number
  reports: ChatModReport[]
}
interface ChatModRoomCount { room: string; count: number }
interface ChatModResponse {
  tab: string
  rows: ChatModRow[]
  total: number
  counts: { queue: number; done: number }
  rooms: ChatModRoomCount[]
  truncated: boolean
}
const CHAT_REPORT_STATUS_LABEL: Record<string, string> = { open: '대기', resolved: '처리됨', dismissed: '무효' }
// 방 표기 — 'global'(World) 또는 ISO2 국가코드. 방 도입 전 글은 room 이 비어 있을 수 있다.
// 국기·나라이름은 채팅/아레나가 쓰는 lib/regions 의 것을 그대로 쓴다(표기가 화면마다 달라지면 안 된다).
const chatRoomLabel = (room?: string | null) =>
  !room || room === 'global' ? '🌍 World' : `${flagEmoji(room) || '🏳'} ${countryName(room, 'ko') || room}`
// 신고자 표기 — 서버가 profiles 에서 이름을 붙여준다. 없으면(탈퇴·프로필 미생성) uuid 앞 8자로 폴백.
// uuid 전체를 찍으면 칸을 다 먹고 어차피 사람이 못 읽는다. 툴팁(title)에 전체 uuid 를 남겨 대조는 가능하게.
function chatReporterLabel(r: ChatModReport): string {
  if (r.reporterName) return r.reporterName
  return r.reporterId ? `#${r.reporterId.slice(0, 8)}` : '-'
}
// 줄이 큐에 올라온 이유 배지 — 관리자가 "왜 내 앞에 왔는지"를 한눈에 알아야 판단이 빨라진다.
//   자동가림 = 신고 누적으로 서버가 이미 내린 글 · 보류 = 모더레이션 장애로 검사 못 한 글 · 신고 = 그 외.
function chatKindBadge(r: ChatModRow): { label: string; tone: string } | null {
  if (r.modStatus === 'auto_hidden') return { label: `자동가림 · 신고 ${r.openCount}`, tone: 'st-expired' }
  if (r.modStatus === 'pending') return { label: '모더레이션 보류', tone: 'st-in_progress' }
  if (r.openCount > 0) return { label: `신고 ${r.openCount}건`, tone: 'st-in_progress' }
  return null
}
// 처리 완료 줄의 결과 표기 — 뭘 했는지가 보여야 되돌릴지 판단할 수 있다.
function chatDoneLabel(r: ChatModRow): string {
  if (r.deletedAt && r.hiddenBy === 'self') return '작성자 삭제'
  if (r.deletedAt) return '숨김'
  return '문제없음'
}
const CHAT_PAGE = 50

export function ChatModAdmin() {
  const [tab, setTab] = useState<'queue' | 'done'>('queue')
  const [room, setRoom] = useState('all')
  const [rows, setRows] = useState<ChatModRow[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<{ queue: number; done: number }>({ queue: 0, done: 0 })
  const [rooms, setRooms] = useState<ChatModRoomCount[]>([])
  const [truncated, setTruncated] = useState(false)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  // 신고 상세(누가·왜)는 기본 접힘 — 줄마다 펼쳐 놓으면 목록이 다시 노이즈가 된다.
  const [openDetail, setOpenDetail] = useState<Set<number>>(new Set())

  const load = useCallback(async (t: 'queue' | 'done', rm: string, off: number) => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<ChatModResponse>('admin', {
        action: 'chatModList',
        tab: t,
        room: rm,
        limit: CHAT_PAGE,
        offset: off,
      })
      setRows(res.rows)
      setTotal(res.total)
      setCounts(res.counts)
      setRooms(res.rooms ?? [])
      setTruncated(!!res.truncated)
      setOffset(off)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '목록을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(tab, room, 0)
  }, [load, tab, room])

  // 처리 3종. 어느 것이든 끝나면 목록을 다시 읽어 그 줄이 대기에서 빠지게 한다.
  async function act(kind: 'hide' | 'unhide' | 'approve', messageId: number) {
    setBusyId(messageId)
    try {
      await callFunction('admin', {
        action: kind === 'hide' ? 'chatHide' : kind === 'unhide' ? 'chatUnhide' : 'chatApprove',
        message_id: messageId,
      })
      await load(tab, room, offset)
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리에 실패했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  // 완전삭제 — 되돌릴 수 없으므로 본문 일부를 보여주며 한 번 확인받는다.
  async function purgeRow(r: ChatModRow) {
    const preview = (r.body ?? '').slice(0, 30)
    if (!window.confirm(`완전삭제하면 되돌릴 수 없습니다.\n\n"${preview}"\n\n이 메시지와 딸린 신고 ${r.reportCount}건을 지웁니다.`)) return
    setBusyId(r.id)
    try {
      await callFunction('admin', { action: 'chatPurge', message_id: r.id })
      await load(tab, room, offset)
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  function toggleDetail(id: number) {
    setOpenDetail((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pageNo = Math.floor(offset / CHAT_PAGE) + 1
  const pageMax = Math.max(1, Math.ceil(total / CHAT_PAGE))

  return (
    <>
      <div className="admin-head">
        <h1>채팅 검수</h1>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={() => load(tab, room, offset)} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      {/* 탭 = 칸 나누기. 처리한 줄이 대기 탭에서 사라져야 "비어 있으면 할 일 없음"이 성립한다. */}
      <div className="admin-tabs" style={{ margin: '14px 0 4px' }}>
        <button className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>
          처리 대기 {counts.queue}
        </button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
          처리 완료 {counts.done}
        </button>
      </div>

      {/* 방별 건수 칩 — 드롭다운이 아니라 줄로 깐다.
          드롭다운은 '열어봐야' 어느 방에 신고가 있는지 알 수 있어서, 새 방에서 터진 걸 놓친다.
          나라가 170개여도 칩은 **큐에 실제로 뜬 방만** 생기므로 평소엔 한 줄이다(건수 많은 순 = 서버 정렬). */}
      {rooms.length > 1 && (
        <div className="chatmod-rooms">
          <button className={room === 'all' ? 'on' : ''} onClick={() => setRoom('all')}>
            전체 <b>{tab === 'queue' ? counts.queue : counts.done}</b>
          </button>
          {rooms.map((r) => (
            <button key={r.room} className={room === r.room ? 'on' : ''} onClick={() => setRoom(r.room)}>
              {chatRoomLabel(r.room)} <b>{r.count}</b>
            </button>
          ))}
        </div>
      )}

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      {truncated && (
        <div className="admin-section admin-empty">
          후보가 {1000}건을 넘어 일부만 표시합니다 — 방 필터로 좁혀 주세요.
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{tab === 'queue' ? '사유' : '결과'}</th>
              <th>방</th>
              <th>메시지 본문</th>
              <th>작성자</th>
              <th>작성일시</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const hidden = r.deletedAt != null
              const badge = chatKindBadge(r)
              const detail = openDetail.has(r.id)
              return (
                <Fragment key={r.id}>
                  <tr>
                    {/* 사유 배지가 곧 펼치기 버튼이다 — 배지가 이미 "신고 2건"이라고 말하는데
                        본문 옆에 '신고 2건 보기' 버튼을 또 두면 같은 말이 두 번이고 본문이 밀려 개행된다. */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {(() => {
                        const lbl = tab === 'queue' ? badge?.label : chatDoneLabel(r)
                        const tone = tab === 'queue' ? badge?.tone ?? '' : hidden ? 'st-expired' : 'st-submitted'
                        if (!lbl) return '-'
                        if (!r.reportCount) return <span className={`admin-badge ${tone}`}>{lbl}</span>
                        return (
                          <button
                            className={`admin-badge chatmod-badge-btn ${tone}`}
                            onClick={() => toggleDetail(r.id)}
                            title="신고 상세 펼치기"
                          >
                            {lbl} <span className="chatmod-caret">{detail ? '▴' : '▾'}</span>
                          </button>
                        )
                      })()}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{chatRoomLabel(r.room)}</td>
                    <td style={{ maxWidth: 420, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {r.body ?? <span style={{ color: 'var(--muted)' }}>(내용 없음)</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.isAnon ? `${r.displayName} (익명)` : r.displayName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(r.createdAt)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/* 결정 3종. 숨김/완전삭제를 나눠 둔 이유:
                          · 숨김 = 소프트 삭제. 채팅창에선 완전히 사라지지만 행은 남는다 →
                            오판정 복구 · 반복 위반자 추적 · 처리 기록이 필요해서다.
                          · 완전삭제 = 행 자체를 지운다. 되돌릴 수 없다. 개인정보·불법물처럼
                            "남아 있는 것 자체가 문제"인 건에만 쓴다. */}
                      {hidden ? (
                        r.hiddenBy === 'self' ? (
                          // 작성자가 스스로 지운 글은 되살릴 수 없다(서버도 409 로 막는다) — 숨김 해제를 안 낸다.
                          <span style={{ color: 'var(--muted)', fontSize: 12 }}>작성자 삭제</span>
                        ) : (
                          <button className="admin-mini" disabled={busyId === r.id} onClick={() => act('unhide', r.id)}>
                            숨김 해제
                          </button>
                        )
                      ) : (
                        <>
                          <button className="admin-mini" disabled={busyId === r.id} onClick={() => act('hide', r.id)}>
                            숨김
                          </button>
                          <button
                            className="admin-mini"
                            style={{ marginLeft: 6 }}
                            disabled={busyId === r.id}
                            onClick={() => act('approve', r.id)}
                          >
                            문제없음
                          </button>
                        </>
                      )}
                      {/* 완전삭제는 숨김 여부와 무관하게 항상 낸다 — 이미 숨긴 글도 지워야 할 때가 있다. */}
                      <button
                        className="admin-mini chatmod-danger"
                        style={{ marginLeft: 6 }}
                        disabled={busyId === r.id}
                        onClick={() => purgeRow(r)}
                      >
                        완전삭제
                      </button>
                    </td>
                  </tr>
                  {detail && (
                    <tr>
                      <td colSpan={6} style={{ background: 'var(--soft)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 2px' }}>
                          {r.reports.map((rep) => (
                            <div key={rep.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13 }}>
                              <span className={`admin-badge st-${rep.status === 'open' ? 'in_progress' : rep.status === 'dismissed' ? 'expired' : 'submitted'}`}>
                                {CHAT_REPORT_STATUS_LABEL[rep.status] ?? rep.status}
                              </span>
                              <b title={rep.reporterId ?? undefined}>{chatReporterLabel(rep)}</b>
                              <span style={{ flex: 1, wordBreak: 'break-word' }}>{rep.reason || '(사유 없음)'}</span>
                              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDT(rep.createdAt)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {tab === 'queue' ? '처리할 신고가 없습니다.' : '처리한 내역이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageMax > 1 && (
        <div className="admin-pager">
          <button className="admin-mini" disabled={offset === 0 || loading} onClick={() => load(tab, room, Math.max(0, offset - CHAT_PAGE))}>
            ‹ 이전
          </button>
          <span>{pageNo} / {pageMax}</span>
          <button className="admin-mini" disabled={offset + CHAT_PAGE >= total || loading} onClick={() => load(tab, room, offset + CHAT_PAGE)}>
            다음 ›
          </button>
        </div>
      )}
    </>
  )
}

// ── 시험 일정/회차 관리 (exam_rounds) ──────────────────────────────
const ROUND_KINDS = ['regular', 'rolling'] as const
const ROUND_KIND_LABEL: Record<string, string> = { regular: '정기시험', rolling: '상시시험' } // 편집폼 유형 select 라벨

// 목록 필터 세그먼트: 정기(안 지난 것) · 상시 · 지난 시험(지난 정기). '지난 시험'은 별도 데이터가 아니라 시험일 기준 분류.
type RoundFilter = 'regular' | 'rolling' | 'past'
const ROUND_FILTERS: { key: RoundFilter; label: string }[] = [
  { key: 'regular', label: '정기시험' },
  { key: 'rolling', label: '상시시험' },
  { key: 'past', label: '지난 시험' },
]
// 지난 시험 판정 — 공개화면(useExamRounds)의 isPastExam 과 동일 경계: 시험일 다음날 0시부터 과거.
function isPastRound(examDate: string | null): boolean {
  if (!examDate) return false
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const d = Date.parse(`${examDate}T23:59:59`)
  return !Number.isNaN(d) && d < todayStart.getTime()
}
// 회차가 필터 세그먼트에 속하는지 (지난 시험 = 지난 정기, 정기 = 안 지난 정기, 상시 = rolling)
function matchRoundFilter(r: ExamRoundRow, f: RoundFilter): boolean {
  if (f === 'rolling') return r.kind === 'rolling'
  const past = r.kind === 'regular' && isPastRound(r.examDate)
  return f === 'past' ? past : r.kind === 'regular' && !past
}

interface RoundDraft {
  id?: string
  kind: 'regular' | 'rolling'
  sort: number
  published: boolean
  titleI18n: I18nText
  noteI18n: I18nText
  examDate: string // YYYY-MM-DD
  applyStart: string // YYYY-MM-DD
  applyEnd: string // YYYY-MM-DD
  examStart: string // YYYY-MM-DD — 응시 창 시작(KST)
  examEnd: string // YYYY-MM-DD — 응시 창 종료(KST)
  tiers: string[] // 이 회차가 여는 급수(getTracks 티어 key)
}

// 서버가 회차에 얹어 내려주는 응시 창. types.ts 의 ExamRoundRow 는 다른 작업이 만지고 있어 여기서 로컬로 넓힌다.
type ExamRoundRowX = ExamRoundRow & { examStartAt?: string | null; examEndAt?: string | null }

// 정기시험 일정은 전부 KST 기준이다. 오프셋 없이 저장하면 timestamptz 가 UTC 로 읽어 9시간 어긋난다
// (예전엔 `${날짜}T23:59:59` 를 그대로 보내서 마감이 다음날 08:59 KST 로 저장됐다).
const KST_OFFSET = '+09:00'
/** ISO(timestamptz) → KST 날짜 'YYYY-MM-DD'. slice(0,10) 은 UTC 날짜라 밤 시각에서 하루 어긋난다. */
function dayKST(iso?: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '' : new Date(t + 9 * 3600e3).toISOString().slice(0, 10)
}
/** KST 기준 오늘. 브라우저 시간대를 믿으면 해외 접속 관리자가 다른 달을 본다. */
function kstToday(): { y: number; m: number } {
  const k = new Date(Date.now() + 9 * 3600e3)
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1 }
}
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function emptyRoundDraft(kind: 'regular' | 'rolling'): RoundDraft {
  // 정기시험은 월 3구간(1~10 접수 / 11~20 응시 / 21~말일 채점)으로 돈다 → 응시 창을 그 달 11~20일로 미리 채운다.
  // 상수로 박는 게 아니라 기본값일 뿐이다 — 회차마다 다를 수 있어 관리자가 그대로 고칠 수 있어야 한다.
  const t = kstToday()
  return {
    kind, sort: 9999, published: true, titleI18n: {}, noteI18n: {},
    examDate: '', applyStart: '', applyEnd: '',
    examStart: ymd(t.y, t.m, 11), examEnd: ymd(t.y, t.m, 20),
    tiers: [],
  }
}

// 티어 key → 표시명(6개, getTracks 단일출처). 회차 목록 배지·라벨용.
const TIER_LABEL: Record<string, string> = Object.fromEntries(
  getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => [ti.key, ti.name])),
)
// 급수 진행 순서(Beginner→Pro→Elite→Master→GM→Zenith) — 드롭다운·목록 정렬 기준(알파벳순 방지).
const TIER_ORDER: string[] = getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => ti.key))
const tierRank = (t?: string | null) => { const i = TIER_ORDER.indexOf(t ?? ''); return i < 0 ? 999 : i }

/** 응시료 편집 — 티어별 금액(원)만 다룬다. **정가 단일 소스가 DB `exam_fees` 라 여기가 유일한 입력구**다.
 *
 *  ⚠️ 통화는 원(KRW) 하나다. 달러로 적어두고 환율을 곱하는 방식은 쓰지 않는다 — 주문 시점과 승인 시점의
 *     환율이 다르면 금액 불일치로 결제 승인이 튕기고, 여기 적은 값과 실제 청구액이 달라진다.
 *  ⚠️ **비운 티어는 결제가 막힌다**(원서접수 화면이 '준비 중'을 띄우고 결제 버튼을 잠근다). 이건 버그가 아니라
 *     의도다 — 금액 미설정을 임시값으로 때우면 엉뚱한 돈이 청구된다. 지금 CARIS-Ⅱ 3개가 여기 해당한다.
 *  키 규칙은 src/lib/fees.ts 의 feeKey() = `${트랙키}_${티어키}` 와 반드시 같아야 한다.
 */
function ExamFeeBox() {
  const TRACKS = getTracks('ko')
  const TIERS = TRACKS.flatMap((tr) => tr.tiers.map((tier) => ({ track: tr, tier })))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setMsg('')
    try {
      const res = await callFunction<{ fees: { key: string; amount: number }[] }>('admin', { action: 'examFeeList' })
      const m: Record<string, string> = {}
      for (const f of res.fees ?? []) m[f.key] = String(f.amount)
      setAmounts(m)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '응시료를 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    // 빈칸은 "저장 안 함"이 아니라 **그 티어를 아직 안 연다**는 뜻이라 0 으로 밀지 않고 그냥 빼고 보낸다.
    const fees = Object.entries(amounts)
      .map(([key, v]) => ({ key, amount: Number(v) }))
      .filter((f) => String(amounts[f.key] ?? '').trim() !== '' && Number.isFinite(f.amount) && f.amount > 0)
    if (!fees.length) { setMsg('저장할 금액이 없습니다.'); return }
    setSaving(true)
    setMsg('')
    try {
      await callFunction('admin', { action: 'examFeeSave', fees })
      await load()
      setMsg('저장했습니다.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-section" style={{ marginBottom: 20 }}>
      <div className="admin-head" style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 18 }}>응시료 (원)</h1>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={load} disabled={loading || saving}>새로고침</button>
          <button className="admin-mini" onClick={save} disabled={loading || saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 12px' }}>
        원(KRW) 단위 정수로 입력하세요. <b>비워두면 그 급수는 원서접수에서 ‘준비 중’으로 표시되고 결제가 막힙니다.</b>
        <br />
        ⓘ <b>Master 이후(CARIS-Ⅱ)는 아직 열지 않은 급수</b>라 금액을 넣을 수 없습니다 — 문제은행·출제 배분표가 없어
        금액만 들어가면 문항 0개짜리 시험이 팔립니다.
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            {/* 요금 키(t1_beginner …)는 화면에서 뺐다 — DB PK 이자 코드가 feeKey() 로 조립하는 값이라
                관리자가 보고 할 일이 없고, 트랙·급수가 같은 줄에 이미 적혀 있다. */}
            <tr><th>트랙</th><th>급수</th><th style={{ width: 160 }}>응시료(원)</th></tr>
          </thead>
          <tbody>
            {TIERS.map(({ track, tier }) => {
              const k = feeKey(track.key, tier.key)
              // 아직 안 연 급수는 금액칸 자체를 잠근다 — 여기 숫자가 들어가는 순간 원서접수에서 결제가 열리는데
              // 그 시험은 문항이 0개다. 서버(examFeeSave)도 같은 값을 거절하지만, 사용자는 저장 버튼을 누르기
              // **전에** 왜 못 넣는지 알아야 한다.
              const locked = isTierLocked(tier.key)
              return (
                <tr key={k}>
                  <td style={{ whiteSpace: 'nowrap' }}>{track.name}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{tier.name}</td>
                  <td>
                    <input
                      style={{ ...inpStyle, ...(locked ? { opacity: .55, cursor: 'not-allowed' } : null) }}
                      type="number"
                      min={0}
                      step={100}
                      disabled={locked}
                      title={locked ? '아직 열지 않은 급수입니다.' : undefined}
                      placeholder={locked ? '준비 중 (잠김)' : '미설정'}
                      value={locked ? '' : amounts[k] ?? ''}
                      onChange={(e) => setAmounts((m) => ({ ...m, [k]: e.target.value }))}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 14 }}>{msg}</div>}
    </div>
  )
}

function RoundsAdmin() {
  const [rows, setRows] = useState<ExamRoundRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<RoundDraft | null>(null)
  const roundDraft = useDraft({ kind: 'exam-round', refId: draft?.id, value: draft, title: draft?.titleI18n?.ko?.trim() || '새 회차', enabled: !!draft })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [kindFilter, setKindFilter] = useState<RoundFilter>('regular')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<AdminExamRoundListResponse>('admin', { action: 'examRoundList' })
      setRows(res.rounds)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '시험 일정을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  function openNew() {
    setDraft(emptyRoundDraft(kindFilter === 'rolling' ? 'rolling' : 'regular'))
  }
  function openEdit(r: ExamRoundRow) {
    const rx = r as ExamRoundRowX
    setDraft({
      id: r.id,
      kind: r.kind,
      sort: r.sort,
      published: r.published,
      titleI18n: { ...r.titleI18n },
      noteI18n: { ...r.noteI18n },
      examDate: r.examDate ?? '',
      applyStart: dayKST(r.applyStartAt),
      applyEnd: dayKST(r.applyEndAt),
      examStart: dayKST(rx.examStartAt),
      examEnd: dayKST(rx.examEndAt),
      tiers: r.tiers ?? [],
    })
  }
  function patch(p: Partial<RoundDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }
  function patchField(k: 'titleI18n' | 'noteI18n', v: string) {
    setDraft((d) => (d ? { ...d, [k]: { ...d[k], ko: v } } : d))
  }
  function toggleTier(key: string, on: boolean) {
    setDraft((d) => {
      if (!d) return d
      const set = new Set(d.tiers)
      if (on) set.add(key)
      else set.delete(key)
      return { ...d, tiers: [...set] }
    })
  }

  async function save() {
    if (!draft) return
    if (!draft.titleI18n.ko?.trim()) {
      alert('한국어 회차명은 필수입니다.')
      return
    }
    const isReg = draft.kind === 'regular'
    // 선택된 급수 → [{key, title}]. title = "회차명 · 급수명"(다운스트림 examTitle 로 노출)
    const roundKo = draft.titleI18n.ko?.trim() || '시험'
    const tiers = getTracks('ko')
      .flatMap((tr) => tr.tiers)
      .filter((ti) => draft.tiers.includes(ti.key))
      .map((ti) => ({ key: ti.key, title: `${roundKo} · ${ti.name}`, total: tierTotal(ti.key), durationMin: TIER_EXAM_SPEC[ti.key]?.durationMin ?? 120 }))
    setSaving(true)
    try {
      const res = await callFunction<{ translateWarning?: string | null; tierWarning?: string | null }>('admin', {
        action: 'examRoundUpsert',
        round: {
          id: draft.id,
          kind: draft.kind,
          sort: draft.sort,
          published: draft.published,
          titleI18n: draft.titleI18n,
          noteI18n: isReg ? {} : draft.noteI18n,
          examDate: isReg ? draft.examDate || null : null,
          // ⚠️ 오프셋(+09:00)을 반드시 붙인다 — 이 값들이 이제 결제·응시 게이트의 판정 기준이라,
          //    UTC 로 저장되면 접수·응시가 9시간씩 어긋나서 열리고 닫힌다.
          applyStartAt: isReg && draft.applyStart ? `${draft.applyStart}T00:00:00${KST_OFFSET}` : null,
          applyEndAt: isReg && draft.applyEnd ? `${draft.applyEnd}T23:59:59${KST_OFFSET}` : null,
          examStartAt: isReg && draft.examStart ? `${draft.examStart}T00:00:00${KST_OFFSET}` : null,
          examEndAt: isReg && draft.examEnd ? `${draft.examEnd}T23:59:59${KST_OFFSET}` : null,
          tiers,
        },
      })
      roundDraft.clear()
      setDraft(null)
      await load()
      // 급수 경고는 번역 경고와 따로 띄운다 — 한 문자열로 합쳤더니 '접수가 있어 급수를 못 지웠다'가
      // '자동 번역을 건너뛰었습니다'로 읽혀서, 관리자가 해제된 줄 알고 넘어갔다.
      if (res?.tierWarning) alert('⚠️ 급수 설정이 일부 반영되지 않았습니다.\n\n' + res.tierWarning)
      if (res?.translateWarning) alert('저장됐지만 자동 번역은 건너뛰었습니다:\n' + res.translateWarning)
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }
  async function remove(r: ExamRoundRow) {
    if (!confirm(`"${r.titleI18n.ko ?? ''}" 일정을 삭제할까요?`)) return
    try {
      await callFunction('admin', { action: 'examRoundDelete', id: r.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  // 같은 유형(정기/상시) 안에서 ↑↓ 이동 → 전체 순서 재구성해 서버가 sort 재부여
  async function move(r: ExamRoundRow, dir: -1 | 1) {
    const grp = rows.filter((x) => x.kind === r.kind).sort((a, b) => a.sort - b.sort)
    const idx = grp.findIndex((x) => x.id === r.id)
    const swap = idx + dir
    if (swap < 0 || swap >= grp.length) return
    const g = [...grp]
    ;[g[idx], g[swap]] = [g[swap], g[idx]]
    const ids: string[] = []
    for (const k of ROUND_KINDS) {
      if (k === r.kind) g.forEach((x) => ids.push(x.id))
      else rows.filter((x) => x.kind === k).sort((a, b) => a.sort - b.sort).forEach((x) => ids.push(x.id))
    }
    setBusy(true)
    try {
      await callFunction('admin', { action: 'examRoundReorder', ids })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '순서 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  // 정기시험은 시험일 오름차순 자동정렬(수동 순서 없음). 상시는 sort(수동 ↑↓) 순.
  const group = rows
    .filter((r) => matchRoundFilter(r, kindFilter))
    .sort((a, b) => {
      if (kindFilter === 'rolling') return a.sort - b.sort
      const av = a.examDate || '9999-99-99'
      const bv = b.examDate || '9999-99-99'
      return kindFilter === 'past' ? bv.localeCompare(av) : av.localeCompare(bv) // 지난 시험은 최근순
    })
  const isReg = draft?.kind === 'regular'
  // 편집 중인 회차가 **서버 기준으로** 이미 열어둔 급수. 잠긴 급수(CARIS-Ⅱ) 체크박스를 풀지 말지의 기준이다
  // — 새 회차(id 없음)면 빈 배열이라 잠긴 급수는 전부 못 켠다.
  const serverTiers = (draft?.id ? rows.find((r) => r.id === draft.id)?.tiers : null) ?? []

  return (
    <>
      <ExamFeeBox />

      <div className="admin-head">
        <h1>시험 등록</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {rows.length}건</span>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={openNew}>
            + 새 회차
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      {/* 유형 세그먼트 — 정기 / 상시 / 지난 시험(지난 정기, 시험일 다음날 0시부터) */}
      <div className="admin-tabs" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
        {ROUND_FILTERS.map((f) => {
          const count = rows.filter((r) => matchRoundFilter(r, f.key)).length
          return (
            <button key={f.key} className={kindFilter === f.key ? 'on' : ''} onClick={() => setKindFilter(f.key)}>
              {f.label}
              {count > 0 && <span style={{ opacity: 0.55, marginLeft: 5 }}>{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>회차명 (한국어)</th>
              <th>시험일</th>
              <th>접수기간</th>
              <th>응시기간</th>
              <th>열린 급수</th>
              {kindFilter === 'rolling' && <th style={{ textAlign: 'center' }}>순서</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {group.map((r, i) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${r.published ? 'submitted' : 'voided'}`}>
                    {r.published ? '공개' : '비공개'}
                  </span>
                </td>
                <td>{r.titleI18n.ko || <span style={{ color: 'var(--muted)' }}>(회차명 없음)</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.kind === 'rolling' ? '상시' : r.examDate ?? '-'}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 14 }}>
                  {r.kind === 'rolling'
                    ? '연중'
                    : r.applyStartAt || r.applyEndAt
                      ? `${dayKST(r.applyStartAt) || '?'} ~ ${dayKST(r.applyEndAt) || '?'}`
                      : '-'}
                </td>
                {/* 응시기간이 실제 응시 가능 여부를 정한다(시험일은 대표 표기일일 뿐). 비면 시험일 하루로 처리된다. */}
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 14 }}>
                  {r.kind === 'rolling'
                    ? '-'
                    : (r as ExamRoundRowX).examStartAt || (r as ExamRoundRowX).examEndAt
                      ? `${dayKST((r as ExamRoundRowX).examStartAt) || '?'} ~ ${dayKST((r as ExamRoundRowX).examEndAt) || '?'}`
                      : <span title="응시기간 미설정 — 시험일 하루만 응시할 수 있습니다.">시험일 하루</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.tiers?.length
                    ? r.tiers.map((t) => (
                        <span key={t} className="admin-badge st-in_progress" style={{ marginRight: 4 }}>
                          {TIER_LABEL[t] ?? t}
                        </span>
                      ))
                    : <span style={{ color: 'var(--muted)' }}>-</span>}
                </td>
                {kindFilter === 'rolling' && (
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                    <button
                      className="admin-mini"
                      disabled={busy || i === 0}
                      onClick={() => move(r, -1)}
                      aria-label="위로"
                      title="위로"
                    >
                      ↑
                    </button>
                    <button
                      className="admin-mini"
                      style={{ marginLeft: 4 }}
                      disabled={busy || i === group.length - 1}
                      onClick={() => move(r, 1)}
                      aria-label="아래로"
                      title="아래로"
                    >
                      ↓
                    </button>
                  </td>
                )}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => openEdit(r)}>
                    편집
                  </button>
                  <button className="admin-mini" style={{ marginLeft: 6 }} onClick={() => remove(r)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!group.length && !loading && (
              <tr>
                <td colSpan={kindFilter === 'rolling' ? 8 : 7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {kindFilter === 'past' ? '지난 시험이 없습니다.' : '이 유형의 회차가 없습니다. “+ 새 회차”로 추가하세요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><h2 style={{ margin: 0 }}>{draft.id ? '회차 편집' : '새 회차'}</h2><DraftBar status={roundDraft.status} savedAt={roundDraft.savedAt} drafts={roundDraft.drafts} onRefresh={roundDraft.refresh} onRestore={(p: RoundDraft) => setDraft(p)} /></div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ ...fieldStyle, flex: 2, minWidth: 140 }}>
                  유형
                  <select
                    style={inpStyle}
                    value={draft.kind}
                    onChange={(e) => patch({ kind: e.target.value as 'regular' | 'rolling' })}
                  >
                    {ROUND_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {ROUND_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, alignSelf: 'flex-end', paddingBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  공개
                </label>
              </div>

              <label style={fieldStyle}>
                회차명 <em style={{ color: 'var(--error, #d43a3a)' }}>(한국어 · 필수)</em>
                <input
                  type="text"
                  style={inpStyle}
                  value={draft.titleI18n.ko ?? ''}
                  onChange={(e) => patchField('titleI18n', e.target.value)}
                  placeholder="예: 제 5회 CARIS"
                />
              </label>

              {/* 열리는 급수 — 체크한 급수마다 이 회차용 시험(exams)이 생성된다. 회차마다 문항 별도. */}
              <div style={fieldStyle}>
                <span>열리는 급수 <em style={{ color: 'var(--muted)' }}>(이 회차에 응시 가능한 시험 · 급수마다 문항 따로)</em></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
                  {getTracks('ko').map((tr) => (
                    <div key={tr.key}>
                      {/* 트랙 표기에서 Ⅰ/Ⅱ 를 뺐으므로(둘 다 'CARIS') 그룹 머리는 트랙 성격으로 적는다. */}
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>
                        {tr.key === 't2' ? '피지컬 AI 전문가' : 'AI·로봇 리터러시'}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {tr.tiers.map((ti) => {
                          const on = draft.tiers.includes(ti.key)
                          // 잠긴 급수(CARIS-Ⅱ)는 **새로 열지 못한다**. 다만 이미 열려 있는 회차는 그대로 둔다 —
                          // 기준은 화면 상태(draft)가 아니라 **서버가 준 그 회차의 열린 급수**(serverTiers)다.
                          // draft 로 판정하면 체크를 한 번 풀었을 때 다시 못 켜는 함정이 되고, 임시저장 복원본
                          // 에서는 열려 있는 급수가 잠긴 것처럼 보인다.
                          const locked = isTierLocked(ti.key) && !serverTiers.includes(ti.key)
                          return (
                            <label
                              key={ti.key}
                              title={locked ? '아직 열지 않은 급수입니다(문제은행 미구축).' : undefined}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                                cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? .5 : 1,
                                padding: '6px 11px', borderRadius: 8,
                                border: `1px solid ${on ? 'var(--blue)' : 'rgba(128,128,128,.35)'}`,
                                color: on ? 'var(--blue)' : 'inherit', fontWeight: on ? 700 : 400,
                              }}
                            >
                              <input type="checkbox" checked={on} disabled={locked} onChange={(e) => toggleTier(ti.key, e.target.checked)} />
                              {ti.name}
                              {locked && <span style={{ fontSize: 12, color: 'var(--muted)' }}>준비 중</span>}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '8px 0 0', lineHeight: 1.5 }}>
                  ⓘ <b>Master 이후(CARIS-Ⅱ)는 아직 열 수 없습니다</b> — 문제은행과 출제 배분표가 없어 응시권을 팔면
                  문항 0개짜리 시험이 됩니다. 이미 열려 있는 회차는 그대로 두고, 해제는 할 수 있습니다.
                </p>
              </div>

              {isReg ? (
                <>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                      시험일
                      <input type="date" style={inpStyle} value={draft.examDate} onChange={(e) => patch({ examDate: e.target.value })} />
                    </label>
                    <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                      접수 시작
                      <input type="date" style={inpStyle} value={draft.applyStart} onChange={(e) => patch({ applyStart: e.target.value })} />
                    </label>
                    <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                      접수 마감
                      <input type="date" style={inpStyle} value={draft.applyEnd} onChange={(e) => patch({ applyEnd: e.target.value })} />
                    </label>
                  </div>
                  {/* 응시 창 — '시험일'은 안내용 대표일이고, 실제로 응시가 열리고 닫히는 건 이 두 날짜다. */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                      응시 시작
                      <input type="date" style={inpStyle} value={draft.examStart} onChange={(e) => patch({ examStart: e.target.value })} />
                    </label>
                    <label style={{ ...fieldStyle, flex: 1, minWidth: 130 }}>
                      응시 종료
                      <input type="date" style={inpStyle} value={draft.examEnd} onChange={(e) => patch({ examEnd: e.target.value })} />
                    </label>
                    <div style={{ flex: 2, minWidth: 220, alignSelf: 'flex-end', paddingBottom: 6, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                      정기시험은 <b>1~10일 접수 · 11~20일 응시 · 21~말일 채점</b>으로 돕니다.<br />
                      비워두면 <b>시험일 하루</b>만 응시할 수 있습니다.
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0 }}>
                  상시시험은 시험일·접수기간이 없습니다(연중 접수).
                </p>
              )}

              {/* 설명은 상시시험 카드에만 표시됨 → 상시일 때만 입력 */}
              {!isReg && (
                <label style={fieldStyle}>
                  설명 <em style={{ color: 'var(--muted)' }}>(한국어 · 카드에 표시)</em>
                  <textarea
                    rows={3}
                    style={{ ...inpStyle, resize: 'vertical', lineHeight: 1.6 }}
                    value={draft.noteI18n.ko ?? ''}
                    onChange={(e) => patchField('noteI18n', e.target.value)}
                    placeholder="예: 원하는 날짜를 예약해 온라인(CBT)으로 응시합니다."
                  />
                </label>
              )}

              <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                🌐 {isReg ? '회차명은' : '회차명·설명은'} 저장 시 <b>영어·일본어·중국어·힌디어·베트남어</b>로 자동 번역됩니다. 날짜는 화면 언어에 맞게 자동 표기됩니다.
              </p>
              {isReg && (
                <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
                  ⓘ 접수 시작~마감 기간이면 “접수중”, 시작 전이면 “예정”, 마감 후면 “마감”으로 표시됩니다.
                  <br />
                  ⓘ 이 날짜들은 표시용이 아니라 <b>실제 게이트</b>입니다 — 접수기간 밖이면 결제가 막히고, 응시기간 밖이면 응시가 막힙니다(모두 KST 기준).
                  <br />
                  ⓘ 이미 접수(응시권·진행 중 결제)가 있는 급수는 체크를 해제해도 <b>닫히지 않습니다</b>. 접수분을 먼저 회수·환불하세요.
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="admin-mini" onClick={() => setDraft(null)} disabled={saving}>
                취소
              </button>
              <button className="btn-ink" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── 접수·응시권 관리 ──────────────────────────────────────────────
// 응시권(exam_tickets) = "결제했다"와 "응시했다" 사이를 담는 유일한 행. 이 탭이 그 원장 화면이다.
//
// ⚠️ 새 타입은 types.ts 가 아니라 여기 로컬 interface 로 둔다(그 파일은 다른 작업이 만지고 있다).
// ⚠️ 금액은 전부 **원화(krw)** 다. 구매자 화면은 달러로 표시하지만 관리자는 실제 청구액을 봐야 한다.
// ⚠️ 상태는 서버가 계산해 내려주는 `effStatus` 를 찍는다. 저장값(`status`)을 그대로 쓰면
//    응시 창이 끝난 응시권이 관리자에겐 '미사용', 사용자 마이페이지에선 '만료'로 보인다.

interface TicketRow {
  ticketId: string
  userId: string
  name: string | null
  email: string | null
  roundId: string
  roundTitle: string
  roundKind: string | null
  examDate: string | null
  examEndAt: string | null
  tier: string
  status: string // DB 저장값
  effStatus: string // 화면 표시값(만료 접기 반영)
  source: string
  pricePaid: number
  grantedBy: string | null
  note: string | null
  issuedAt: string
  consumedAt: string | null
  voidedAt: string | null
  voidReason: string | null
  expiresAt: string | null
  paymentId: string | null
  paymentOrderId: string | null
  paymentStatus: string | null
  paymentFulfilled: boolean | null
  attemptId: string | null
  attemptStatus: string | null
}
interface TicketListResp { tickets: TicketRow[]; total: number }

interface TicketCounts { sold: number; unused: number; used: number; expired: number; voided: number; revenue: number; free: number }
interface TicketRoundSummary extends TicketCounts {
  roundId: string
  title: string
  kind: string
  examDate: string | null
  examStartAt: string | null
  examEndAt: string | null
}
interface TicketTierSummary extends TicketCounts { roundId: string; tier: string }
interface TicketSummaryResp {
  rounds: TicketRoundSummary[]
  tiers: TicketTierSummary[]
  sets: Record<string, { total: number; loaded: number; active: boolean }> // 회차 지정 시에만 채워진다
  truncated: boolean
}

const TICKET_STATUS_LABEL: Record<string, string> = { issued: '미사용', consumed: '응시 완료', void: '무효', expired: '만료' }
const TICKET_STATUS_CLASS: Record<string, string> = { issued: 'st-in_progress', consumed: 'st-submitted', void: 'st-voided', expired: 'st-expired' }
const TICKET_SOURCE_LABEL: Record<string, string> = { pg: '결제', admin: '관리자 발급', free: '무료' }
const TICKET_STATUS_FILTERS: { key: string; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'issued', label: '미사용' },
  { key: 'consumed', label: '응시 완료' },
  { key: 'expired', label: '만료' },
  { key: 'void', label: '무효' },
]

function TicketsAdmin({ isRoot }: { isRoot: boolean }) {
  const [rounds, setRounds] = useState<ExamRoundRow[]>([])
  const [roundId, setRoundId] = useState('')
  const [sum, setSum] = useState<TicketSummaryResp | null>(null)
  const [rows, setRows] = useState<TicketRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [tier, setTier] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('') // 확정된 검색어(입력 중 값은 qLive)
  const [qLive, setQLive] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [grantDraft, setGrantDraft] = useState<{ roundId: string; tier: string; email: string; note: string } | null>(null)
  const [voidDraft, setVoidDraft] = useState<TicketRow | null>(null)

  const loadSummary = useCallback(async (rid: string) => {
    try {
      setSum(await callFunction<TicketSummaryResp>('admin', { action: 'examTicketSummary', roundId: rid || undefined }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '접수 현황을 불러올 수 없습니다.')
    }
  }, [])

  const loadList = useCallback(async (off: number, f: { roundId: string; tier: string; status: string; q: string }) => {
    setLoading(true)
    setErr('')
    try {
      const res = await callFunction<TicketListResp>('admin', {
        action: 'examTicketList',
        limit: PAGE,
        offset: off,
        roundId: f.roundId || undefined,
        tier: f.tier || undefined,
        status: f.status || undefined,
        q: f.q || undefined,
      })
      setRows(res.tickets)
      setTotal(res.total)
      setOffset(off)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '응시권 목록을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    callFunction<AdminExamRoundListResponse>('admin', { action: 'examRoundList' })
      .then((r) => setRounds(r.rounds))
      .catch(() => { /* 필터 옵션이 없어도 목록은 나온다 */ })
  }, [])
  useEffect(() => { loadSummary(roundId) }, [roundId, loadSummary])
  useEffect(() => { loadList(0, { roundId, tier, status, q }) }, [roundId, tier, status, q, loadList])

  function refresh() {
    loadSummary(roundId)
    loadList(offset, { roundId, tier, status, q })
  }

  async function doGrant() {
    if (!grantDraft) return
    try {
      const res = await callFunction<{ ok: boolean }>('admin', {
        action: 'examTicketGrant',
        roundId: grantDraft.roundId,
        tier: grantDraft.tier,
        email: grantDraft.email,
        note: grantDraft.note,
      })
      if (res?.ok) {
        setGrantDraft(null)
        refresh()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : '발급에 실패했습니다.')
    }
  }

  async function doVoid(reason: string, settlePayment: 'refunded' | 'keep') {
    if (!voidDraft) return
    try {
      const res = await callFunction<{ ok: boolean; paymentNote?: string | null }>('admin', {
        action: 'examTicketVoid',
        id: voidDraft.ticketId,
        reason,
        settlePayment,
      })
      setVoidDraft(null)
      if (res?.paymentNote) alert(res.paymentNote)
      refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : '회수에 실패했습니다.')
    }
  }

  const roundOpts = rounds.slice().sort((a, b) => (b.examDate ?? '').localeCompare(a.examDate ?? ''))
  const curRound = rounds.find((r) => r.id === roundId) ?? null
  // 접수 0건인 급수도 줄을 세운다 — '문항 미추출' 경고는 표를 파는 **전에** 보여야 쓸모가 있다.
  // (응시권 집계만으로 줄을 만들면 아직 안 팔린 급수가 표에서 통째로 사라진다.)
  const tierRows: TicketTierSummary[] = roundId
    ? (() => {
        const byKey = new Map((sum?.tiers ?? []).filter((t) => t.roundId === roundId).map((t) => [t.tier, t]))
        const keys = new Set<string>([...byKey.keys(), ...Object.keys(sum?.sets ?? {})])
        return [...keys]
          .sort((a, b) => tierRank(a) - tierRank(b))
          .map((k) => byKey.get(k) ?? { roundId, tier: k, sold: 0, unused: 0, used: 0, expired: 0, voided: 0, revenue: 0, free: 0 })
      })()
    : []
  const pageNo = Math.floor(offset / PAGE) + 1
  const pageMax = Math.max(1, Math.ceil(total / PAGE))

  return (
    <>
      <div className="admin-head">
        <h1>접수·응시권</h1>
        <div className="admin-head-actions">
          <label className="grade-round">
            <span className="grade-round-lab">회차</span>
            <select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
              <option value="">전체 회차</option>
              {roundOpts.map((r) => (
                <option key={r.id} value={r.id}>{r.titleI18n.ko || '(회차명 없음)'}</option>
              ))}
            </select>
          </label>
          <span className="admin-count">응시권 {total}장</span>
          <button className="admin-mini" onClick={refresh} disabled={loading}>새로고침</button>
          {isRoot && (
            <button
              className="admin-mini"
              onClick={() => {
                const reg = roundOpts.filter((r) => r.kind === 'regular')
                const pre = reg.some((r) => r.id === roundId) ? roundId : reg[0]?.id ?? ''
                setGrantDraft({ roundId: pre, tier: '', email: '', note: '' })
              }}
            >
              + 수기 발급
            </button>
          )}
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      {sum?.truncated && (
        <div className="admin-section admin-empty">
          응시권이 너무 많아 집계를 일부만 셌습니다. 회차를 골라서 보세요.
        </div>
      )}

      {/* 접수 현황 — 회차 지표의 단일 집계원(examTicketSummary). 대시보드 퍼널도 같은 값을 쓴다. */}
      <div className="admin-section" style={{ marginBottom: 20 }}>
        <div className="admin-section-head">
          <h3 style={{ margin: 0 }}>접수 현황 {curRound ? `· ${curRound.titleI18n.ko ?? ''}` : ''}</h3>
          <span className="admin-hint">접수 = 무효를 뺀 발급분(미사용 + 응시 완료 + 만료)</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              {roundId ? (
                <tr>
                  <th>급수</th>
                  <th style={{ textAlign: 'right' }}>접수</th>
                  <th style={{ textAlign: 'right' }}>미사용</th>
                  <th style={{ textAlign: 'right' }}>응시 완료</th>
                  <th style={{ textAlign: 'right' }}>만료</th>
                  <th style={{ textAlign: 'right' }}>무효</th>
                  <th style={{ textAlign: 'right' }}>결제액</th>
                  <th>문항 세트</th>
                </tr>
              ) : (
                <tr>
                  <th>회차</th>
                  <th>응시기간</th>
                  <th style={{ textAlign: 'right' }}>접수</th>
                  <th style={{ textAlign: 'right' }}>미사용</th>
                  <th style={{ textAlign: 'right' }}>응시 완료</th>
                  <th style={{ textAlign: 'right' }}>만료</th>
                  <th style={{ textAlign: 'right' }}>무효</th>
                  <th style={{ textAlign: 'right' }}>결제액</th>
                </tr>
              )}
            </thead>
            <tbody>
              {roundId
                ? tierRows.map((t) => {
                    const set = sum?.sets?.[t.tier]
                    // 문항 세트가 비어 있으면 응시권을 팔아도 시험 당일 전원이 400 을 받는다 — 여기서 미리 보이게 한다.
                    const short = !!set && set.loaded < set.total
                    return (
                      <tr key={t.tier}>
                        <td style={{ whiteSpace: 'nowrap' }}><b>{TIER_LABEL[t.tier] ?? t.tier}</b></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{t.sold}</b></td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.unused}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.used}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.expired}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.voided}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {krw(t.revenue)}
                          {t.free > 0 && <span style={{ color: 'var(--muted)', fontSize: 14 }}> · 무료 {t.free}</span>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 14, color: short ? 'var(--k-amber, #d98a00)' : 'var(--muted)' }}>
                          {set ? `${set.loaded} / ${set.total}${short ? ' ⚠ 미추출' : ''}` : '—'}
                        </td>
                      </tr>
                    )
                  })
                : (sum?.rounds ?? []).filter((r) => r.sold > 0 || r.voided > 0).map((r) => (
                    <tr key={r.roundId}>
                      <td><b>{r.title || '(회차명 없음)'}</b></td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 14 }}>
                        {r.kind === 'rolling'
                          ? '상시'
                          : r.examStartAt || r.examEndAt
                            ? `${dayKST(r.examStartAt) || '?'} ~ ${dayKST(r.examEndAt) || '?'}`
                            : r.examDate ?? '-'}
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{r.sold}</b></td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.unused}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.used}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.expired}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.voided}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{krw(r.revenue)}</td>
                    </tr>
                  ))}
              {((roundId && !tierRows.length) || (!roundId && !(sum?.rounds ?? []).some((r) => r.sold > 0 || r.voided > 0))) && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 26, color: 'var(--muted)' }}>
                    접수된 응시권이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 응시권 목록 */}
      <div className="admin-head" style={{ marginTop: 4 }}>
        <h1 style={{ fontSize: 18 }}>응시권 목록</h1>
        <div className="admin-head-actions">
          <label className="grade-round">
            <span className="grade-round-lab">급수</span>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">전체 급수</option>
              {TIER_ORDER.map((k) => <option key={k} value={k}>{TIER_LABEL[k] ?? k}</option>)}
            </select>
          </label>
          <label className="grade-round">
            <span className="grade-round-lab">상태</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {TICKET_STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <input
            style={{ ...inpStyle, width: 200 }}
            placeholder="이름·이메일 검색"
            value={qLive}
            onChange={(e) => setQLive(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setQ(qLive.trim()) }}
          />
          <button className="admin-mini" onClick={() => setQ(qLive.trim())} disabled={loading}>검색</button>
        </div>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>응시자</th>
              <th>회차 · 급수</th>
              <th>발급</th>
              <th>결제</th>
              <th>응시</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.ticketId}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge ${TICKET_STATUS_CLASS[t.effStatus] ?? ''}`}>
                    {TICKET_STATUS_LABEL[t.effStatus] ?? t.effStatus}
                  </span>
                </td>
                <td>
                  <div>{t.name || <span style={{ color: 'var(--muted)' }}>(이름 없음)</span>}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 14 }}>{t.email ?? '-'}</div>
                </td>
                <td>
                  <div>{t.roundTitle || '(회차명 없음)'}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 14 }}>{TIER_LABEL[t.tier] ?? t.tier}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                  <div>{fmtDT(t.issuedAt)}</div>
                  <div style={{ color: 'var(--muted)' }}>
                    {TICKET_SOURCE_LABEL[t.source] ?? t.source}
                    {t.grantedBy ? ` · ${t.grantedBy}` : ''}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                  <div>{t.pricePaid > 0 ? krw(t.pricePaid) : <span style={{ color: 'var(--muted)' }}>무상</span>}</div>
                  {t.paymentStatus && (
                    <div style={{ color: 'var(--muted)' }}>
                      {t.paymentStatus}
                      {t.paymentFulfilled === false ? ' · 미지급' : ''}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                  {t.attemptId
                    ? <span>{STATUS_LABEL[t.attemptStatus ?? ''] ?? t.attemptStatus}</span>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {isRoot && t.status !== 'void' && (
                    <button className="admin-mini" onClick={() => setVoidDraft(t)}>회수</button>
                  )}
                  {t.status === 'void' && t.voidReason && (
                    <span style={{ color: 'var(--muted)', fontSize: 14 }} title={t.voidReason}>회수됨</span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  조건에 맞는 응시권이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageMax > 1 && (
        <div className="admin-pager" style={{ marginTop: 12 }}>
          <button className="admin-mini" disabled={loading || pageNo === 1} onClick={() => loadList(offset - PAGE, { roundId, tier, status, q })}>‹ 이전</button>
          <span>{pageNo} / {pageMax}</span>
          <button className="admin-mini" disabled={loading || pageNo >= pageMax} onClick={() => loadList(offset + PAGE, { roundId, tier, status, q })}>다음 ›</button>
        </div>
      )}

      {/* 수기 발급 (루트 전용) — 단체 접수·장애 보상용 무료 응시권 */}
      {grantDraft && (
        <div className="admin-modal-bg">
        {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setGrantDraft(null)}>✕</button>
            <h2>응시권 수기 발급</h2>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 14px', lineHeight: 1.6 }}>
              결제 없이 응시권을 만듭니다(무상, 결제 원장에 남지 않음). 단체 접수·시험 당일 장애 보상에만 쓰세요.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={fieldStyle}>
                회차
                {/* 상시 회차는 응시 기간이 없어 만료를 정할 수 없다 → 서버도 400 으로 막는다. 목록에서 빼둔다. */}
                <select style={inpStyle} value={grantDraft.roundId} onChange={(e) => setGrantDraft({ ...grantDraft, roundId: e.target.value })}>
                  <option value="">선택하세요</option>
                  {roundOpts.filter((r) => r.kind === 'regular').map((r) => (
                    <option key={r.id} value={r.id}>{r.titleI18n.ko || '(회차명 없음)'}</option>
                  ))}
                </select>
              </label>
              <label style={fieldStyle}>
                급수 <em style={{ color: 'var(--muted)' }}>(회차에 열려 있는 급수만 발급됩니다)</em>
                <select style={inpStyle} value={grantDraft.tier} onChange={(e) => setGrantDraft({ ...grantDraft, tier: e.target.value })}>
                  <option value="">선택하세요</option>
                  {(rounds.find((r) => r.id === grantDraft.roundId)?.tiers ?? TIER_ORDER)
                    .slice().sort((a, b) => tierRank(a) - tierRank(b))
                    .map((k) => <option key={k} value={k}>{TIER_LABEL[k] ?? k}</option>)}
                </select>
              </label>
              <label style={fieldStyle}>
                대상 이메일 <em style={{ color: 'var(--muted)' }}>(가입된 계정)</em>
                <input type="email" style={inpStyle} value={grantDraft.email} placeholder="user@example.com"
                  onChange={(e) => setGrantDraft({ ...grantDraft, email: e.target.value })} />
              </label>
              <label style={fieldStyle}>
                발급 사유 <em style={{ color: 'var(--error, #d43a3a)' }}>(필수)</em>
                <input type="text" style={inpStyle} value={grantDraft.note} placeholder="예: 제5회 단체접수 · 사내 결재 #123"
                  onChange={(e) => setGrantDraft({ ...grantDraft, note: e.target.value })} />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button className="admin-mini" onClick={() => setGrantDraft(null)}>취소</button>
              <button className="btn-ink" onClick={doGrant}>발급</button>
            </div>
          </div>
        </div>
      )}

      {voidDraft && <VoidTicketModal row={voidDraft} onClose={() => setVoidDraft(null)} onSubmit={doVoid} />}
    </>
  )
}

// 응시권 회수 모달 — 사유 + **연결 결제를 어떻게 할지**를 반드시 같이 고르게 한다.
// 결제를 paid 로 두면 payments 의 부분 유니크가 계속 걸려 그 사용자는 같은 회차·급수를 영구히 다시 못 산다.
function VoidTicketModal({ row, onClose, onSubmit }: {
  row: TicketRow
  onClose: () => void
  onSubmit: (reason: string, settlePayment: 'refunded' | 'keep') => void
}) {
  const [reason, setReason] = useState('')
  const [settle, setSettle] = useState<'refunded' | 'keep'>('keep')
  const paid = row.paymentStatus === 'paid'
  return (
    <div className="admin-modal-bg">
    {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2>응시권 회수</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 14px', lineHeight: 1.6 }}>
          {row.name ?? '(이름 없음)'} · {row.email ?? '-'}<br />
          {row.roundTitle} · {TIER_LABEL[row.tier] ?? row.tier} · {row.pricePaid > 0 ? krw(row.pricePaid) : '무상'}
          {row.attemptId && <><br /><b>이미 응시한 응시권입니다.</b> 성적·인증서는 자동으로 무효가 되지 않습니다 — 따로 처리하세요.</>}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={fieldStyle}>
            회수 사유 <em style={{ color: 'var(--error, #d43a3a)' }}>(필수)</em>
            <input type="text" style={inpStyle} value={reason} placeholder="예: 본인확인 실패 · 오등록 정정"
              onChange={(e) => setReason(e.target.value)} />
          </label>
          {row.paymentId && (
            <div style={fieldStyle}>
              <span>연결 결제 처리 <em style={{ color: 'var(--muted)' }}>(주문 {row.paymentOrderId ?? '-'} · 현재 {row.paymentStatus ?? '-'})</em></span>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.6, color: 'inherit' }}>
                <input type="radio" name="settle" checked={settle === 'keep'} onChange={() => setSettle('keep')} />
                <span>결제는 그대로 둔다 — 이 사용자는 같은 회차·급수를 <b>다시 결제할 수 없습니다</b>. 재응시가 필요하면 수기 발급으로 주세요.</span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.6, color: 'inherit' }}>
                <input type="radio" name="settle" checked={settle === 'refunded'} onChange={() => setSettle('refunded')} disabled={!paid} />
                <span>
                  환불 완료로 표시한다 — 결제를 <code>refunded</code> 로 바꿔 <b>재구매를 열어줍니다</b>.
                  {' '}<b>실제 환불은 여기서 일어나지 않습니다</b>(PG 관리자에서 먼저 처리하세요).
                  {!paid && <><br /><span style={{ color: 'var(--muted)' }}>이 결제는 paid 상태가 아니라 선택할 수 없습니다.</span></>}
                </span>
              </label>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button className="admin-mini" onClick={onClose}>취소</button>
          <button className="btn-ink" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim(), settle)}>회수</button>
        </div>
      </div>
    </div>
  )
}

// ── 관리자 계정 관리 (루트 전용) ──────────────────────────────────
// admin_users 는 CBT·CARIS ARENA 공용 → 여기서 추가하면 양쪽 관리자 권한이 함께 부여됨.
interface AdminAccountRow {
  email: string
  role: 'root' | 'admin'
  added_by: string | null
  created_at: string | null
}

function AdminAccountsAdmin() {
  const [rows, setRows] = useState<AdminAccountRow[] | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await callFunction<{ admins: AdminAccountRow[]; candidates?: string[] }>('admin', { action: 'admins' })
      setRows(r.admins)
      setCandidates(r.candidates ?? [])
    } catch (e) {
      setMsg('불러오기 실패: ' + (e instanceof Error ? e.message : String(e)))
      setRows([])
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function add() {
    const t = email.trim().toLowerCase()
    if (!t) return
    setBusy(true)
    setMsg('')
    try {
      const r = await callFunction<{ admins: AdminAccountRow[]; candidates?: string[] }>('admin', { action: 'addAdmin', email: t })
      setRows(r.admins)
      setCandidates(r.candidates ?? [])
      setEmail('')
      setMsg(`✅ ${t} 추가됨`)
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }
  async function remove(target: string) {
    if (!confirm(`${target} 을(를) 관리자에서 삭제할까요?`)) return
    setBusy(true)
    setMsg('')
    try {
      const r = await callFunction<{ admins: AdminAccountRow[]; candidates?: string[] }>('admin', { action: 'removeAdmin', email: target })
      setRows(r.admins)
      setCandidates(r.candidates ?? [])
      setMsg(`🗑 ${target} 삭제됨`)
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>관리자 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">{rows ? `${rows.length}명` : ''}</span>
          <button className="admin-mini" onClick={load} disabled={busy}>
            새로고침
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px', lineHeight: 1.6 }}>
        이미 <b>로그인(가입)한 유저</b>만 관리자로 지정할 수 있습니다. 추가하면 그 계정으로 CARIS·WORLD ARENA 관리자 페이지를 모두 쓸 수 있어요. (추가·삭제는 루트 관리자만)
      </p>

      <div className="admin-section" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <input
          list="cbt-admin-candidates"
          style={{ ...inpStyle, width: 280 }}
          placeholder="가입 유저 이메일 선택/입력"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <datalist id="cbt-admin-candidates">
          {candidates.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button className="btn-ink" onClick={add} disabled={busy || !email.trim()}>
          추가
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>지정 가능 {candidates.length}명</span>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>이메일</th>
              <th>권한</th>
              <th>추가한 사람</th>
              <th>추가일</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((a) => (
              <tr key={a.email}>
                <td>{a.email}</td>
                <td>
                  <span className={`admin-badge st-${a.role === 'root' ? 'submitted' : 'in_progress'}`}>
                    {a.role === 'root' ? '루트' : '관리자'}
                  </span>
                </td>
                <td>{a.added_by ?? '-'}</td>
                <td>{fmtDT(a.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.role === 'root' ? (
                    <span style={{ color: 'var(--muted)' }}>삭제 불가</span>
                  ) : (
                    <button className="admin-mini" onClick={() => remove(a.email)} disabled={busy}>
                      삭제
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  관리자 목록이 비어 있습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * 번역 실패 사유(기계 문구) → 관리자가 읽고 **뭘 하면 되는지 아는** 한 문장.
 *
 * 왜 필요한가(2026-08-19): 분당 한도(429)에 걸리면 번역이 조용히 덜 채워진 채 끝났다. 화면엔
 * '실패 조각 N개' 만 떠서, 개발자가 아닌 관리자는 원인을 알 수 없어 매번 문의가 왔다.
 * ⚠️ 사유 문자열의 출처는 서버(`translate-ebook` 의 shortReason) 하나다 — 여기서 새로 만들지 말 것.
 */
function explainTranslateFail(reasons?: Record<string, number>): string {
  const total = Object.values(reasons ?? {}).reduce((a, b) => a + b, 0)
  if (!reasons || !total) return ''
  // 제일 많이 난 사유 하나로 설명한다 — 여러 줄로 늘어놓으면 아무도 안 읽는다.
  const [why] = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]
  if (/일일한도/.test(why)) {
    return '오늘 쓸 수 있는 번역량(일일 한도)을 다 썼습니다. 내일 다시 “다시 번역”을 눌러주세요.'
  }
  if (/분당한도|429/.test(why)) {
    return '번역 서비스의 분당 요청 한도에 걸렸습니다. 잠깐(1~2분) 두었다가 “다시 번역”을 누르면 남은 조각만 이어서 채웁니다. 책이 크면 몇 번 나눠 눌러야 할 수 있어요.'
  }
  if (/출력잘림|모델항목누락|JSON|빈번역|빈응답/.test(why)) {
    return '번역 모델이 일부 조각을 제대로 돌려주지 못했습니다. “다시 번역”을 누르면 그 조각만 다시 시도합니다.'
  }
  if (/서버오류/.test(why)) {
    return '번역 서버가 일시적으로 응답하지 못했습니다. 잠시 후 “다시 번역”을 눌러주세요.'
  }
  return `일부 조각을 번역하지 못했습니다(${why}). “다시 번역”을 누르면 그 조각만 다시 시도합니다.`
}

// ── 이북(전자책) 관리 ──
//   본문 HTML 1개 파일 = 비공개 버킷 'ebooks', 표지 이미지 = 공개 버킷 'ebook-covers'.
//   파일은 클라에서 스토리지로 직접 올리고(관리자 전용 정책), 메타데이터만 admin 함수로 저장한다.
//   ⚠️ 구매/열람 권한은 ebooks 함수가 판정 — 여기선 등록·공개 여부·가격만 다룬다.
//   표지는 따로 올리지 않는다 — 본문 HTML 의 1페이지를 그대로 구워 쓴다(lib/ebookCover.ts).
interface EbookDraft {
  id?: string
  title: string
  author: string
  description: string
  coverUrl: string
  /** 정가 — **달러 센트**(100 = $1.00). DB 컬럼명과 같게 둔다. */
  price_usd_cents: number
  catalog: 'leveltest' | 'caris' // 러닝 라이브러리(/ebooks)의 어느 탭에 서는가
  targetLevel: number | null // 추천 대상 레벨(1~7) — 결과창 추천 정렬에 쓴다. null = 미지정
  targetTier: string | null // 대상 급수(beginner..zenith). null = 미지정
  storagePath: string
  published: boolean
  sortOrder: number
  translations: Record<string, EbookTranslation>
}
function emptyEbookDraft(catalog: EbookCatalog): EbookDraft {
  return { title: '', author: '', description: '', coverUrl: '', price_usd_cents: 0, catalog, targetLevel: null, targetTier: null, storagePath: '', published: false, sortOrder: 0, translations: {} }
}

// ── 이북 관리는 카탈로그마다 **화면이 따로**다(2026-08-11) ──────────────
//   CARIS 이북 = CARIS 시험 탭, LEVELTEST 이북 = WORLD ARENA 탭. 한 화면에서 섞어 다루면
//   목록·순서·등록이 전부 "지금 어느 쪽 얘기인가"를 물고 가야 하고, 등록할 때 카탈로그를 잘못 고르면
//   엉뚱한 스토어에 책이 뜬다. 화면이 갈리면 그 실수 자체가 성립하지 않는다.
type EbookCatalog = 'leveltest' | 'caris'
const EBOOK_CATALOG_LABEL: Record<EbookCatalog, string> = { leveltest: 'LEVELTEST E-BOOK', caris: 'CARIS E-BOOK' }

// 분류 셀렉트 = (레벨 또는 급수) 한 칸. 카탈로그는 화면이 이미 정했으므로 고르지 않는다
//   — 반대쪽 값이 남아 DB CHECK 에 걸리는 조합을 화면에서 만들 수 없다.
type EbookSlot = { value: string; label: string; level: number | null; tier: string | null }
const EBOOK_SLOTS: Record<EbookCatalog, EbookSlot[]> = {
  leveltest: [
    { value: 'any', label: '레벨 무관', level: null, tier: null },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: `lv:${n}`, label: `Lv.${n}`, level: n, tier: null })),
  ],
  // 급수 목록·순서·이름은 caris.ts 가 단일 출처(tierName). 여기 이름을 손으로 적지 않는다.
  caris: [
    { value: 'any', label: '급수 무관', level: null, tier: null },
    ...['beginner', 'pro', 'elite', 'master', 'grandmaster', 'zenith'].map((k) => ({
      value: `tier:${k}`, label: tierName(k), level: null, tier: k,
    })),
  ],
}
const ebookSlotValue = (d: EbookDraft) =>
  d.catalog === 'caris' ? (d.targetTier ? `tier:${d.targetTier}` : 'any') : (d.targetLevel ? `lv:${d.targetLevel}` : 'any')
/** 목록의 '분류' 열 — 화면이 이미 카탈로그를 말하고 있으므로 레벨/급수만 찍는다. */
function ebookSlotLabel(b: AdminEbookRow): string {
  return b.catalog === 'caris'
    ? (b.targetTier ? tierName(b.targetTier) : '')
    : (b.targetLevel ? `Lv.${b.targetLevel}` : '')
}

export function EbooksAdmin({ catalog = 'leveltest' }: { catalog?: EbookCatalog }) {
  const [rows, setRows] = useState<AdminEbookRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<EbookDraft | null>(null)
  const ebookDraft = useDraft({ kind: 'ebook', refId: draft?.id, value: draft, title: draft?.title?.trim() || '새 이북', enabled: !!draft })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false) // 순서 변경 중(↑↓)
  const [uploading, setUploading] = useState<'html' | 'optimize' | 'cover' | 'translate' | null>(null)
  const [trStatus, setTrStatus] = useState('') // 최적화·번역 진행 문구
  // 분당 한도로 **쉬는 중**인지. 진행 문구를 눈에 띄게 바꾼다 — 안 그러면 멈춘 줄 알고 창을 닫는다.
  const [trWaiting, setTrWaiting] = useState(false)
  const [buyersOf, setBuyersOf] = useState<{ book: AdminEbookRow; rows: AdminEbookBuyer[] } | null>(null)
  const [preview, setPreview] = useState<AdminEbookRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      // 서버는 두 카탈로그를 다 준다 — 순서 재부여(move)가 전체 목록을 알아야 하기 때문이다.
      // 화면에 세우는 건 아래 list(이 카탈로그) 뿐.
      const res = await callFunction<AdminEbookListResp>('admin', { action: 'ebookList' })
      setRows(res.ebooks)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '이북을 불러올 수 없습니다.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  // 이 화면이 다루는 책만. catalog 가 없는 옛 응답은 레벨테스트로 읽는다(함수 배포 전 대비).
  const list = rows.filter((r) => (r.catalog ?? 'leveltest') === catalog)

  function patch(p: Partial<EbookDraft>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }

  // 본문 1페이지 → 표지 이미지로 굽고 공개 버킷에 올린다. 반환 = 공개 URL.
  //   이전 표지 파일은 지우지 않는다(교체 도중 실패해도 옛 표지가 살아 있게).
  async function bakeCover(html: string): Promise<string> {
    const { blob, ext } = await renderEbookCover(html)
    const path = `${crypto.randomUUID()}/cover.${ext}`
    const { error } = await supabase.storage.from('ebook-covers').upload(path, blob, { contentType: blob.type, upsert: false })
    if (error) throw error
    return supabase.storage.from('ebook-covers').getPublicUrl(path).data.publicUrl
  }

  // 본문을 5개 언어로 번역 → 언어별 HTML·표지·스토어 메타를 만들어 저장한다.
  //   원문 폴더(<uuid>/) 안에 <lang>.html 로 넣어 삭제 시 함께 정리되게 한다.
  async function runTranslation(html: string, d: EbookDraft): Promise<Record<string, EbookTranslation>> {
    const folder = d.storagePath.split('/')[0]
    const results = await translateEbook(
      html,
      { title: d.title, author: d.author, description: d.description },
      EBOOK_LANGS,
      (p) => {
        if (p.phase === 'translate') {
          setTrWaiting(!!p.waiting)
          setTrStatus(`번역 ${p.done}/${p.total} 조각${p.note ? ` · ${p.note}` : ''}`)
        }
        else if (p.phase === 'build') setTrStatus(`${EBOOK_LANG_LABEL[p.lang!] ?? p.lang} 본문 생성 중…`)
        else if (p.phase === 'fit') setTrStatus(`${EBOOK_LANG_LABEL[p.lang!] ?? p.lang} 페이지 맞추는 중…`)
      },
    )
    const out: Record<string, EbookTranslation> = {}
    for (const r of results) {
      setTrStatus(`${EBOOK_LANG_LABEL[r.lang]} 저장 중…`)
      const path = `${folder}/${r.lang}.html`
      const { error } = await supabase.storage
        .from('ebooks')
        .upload(path, new Blob([r.html], { type: 'text/html' }), { contentType: 'text/html', upsert: true })
      if (error) throw error
      // 표지도 그 언어 1페이지로 굽는다 — 영어본을 읽는 사람에게 한국어 표지를 보이지 않게.
      let coverUrl: string | undefined
      try {
        coverUrl = await bakeCover(r.html)
      } catch {
        // 표지 실패는 번역을 막지 않는다(한국어 표지로 폴백된다).
      }
      out[r.lang] = {
        path,
        coverUrl,
        title: r.meta.title,
        author: r.meta.author,
        description: r.meta.description,
        failed: r.failed,
        failReasons: r.failReasons,
        fittedPages: r.fittedPages,
        overflowPages: r.overflowPages,
        at: new Date().toISOString(),
      }
    }
    return out
  }

  // 이미 등록된 책 다시 번역 — 본문을 비공개 버킷에서 내려받아 파이프라인을 다시 돌린다.
  async function regenTranslations() {
    if (!draft?.storagePath) return
    if (!confirm('5개 언어(영어·일본어·중국어·힌디·베트남어)로 번역합니다. 몇 분 걸릴 수 있습니다. 진행할까요?')) return
    setUploading('translate')
    setTrStatus('본문 내려받는 중…')
    try {
      const { data, error } = await supabase.storage.from('ebooks').download(draft.storagePath)
      if (error) throw error
      patch({ translations: await runTranslation(await data.text(), draft) })
      setTrStatus('')
    } catch (e) {
      alert(e instanceof Error ? e.message : '번역에 실패했습니다.')
      setTrStatus('')
    } finally {
      setUploading(null)
    }
  }

  // 본문 HTML 업로드 — 파일마다 새 폴더(uuid)를 써서 덮어쓰기 사고를 막는다.
  //   업로드 → 표지 자동 생성 → 5개 언어 번역까지 한 흐름으로 이어진다.
  //   각 단계는 앞 단계 결과만 있으면 되므로, 뒤 단계가 실패해도 앞 단계는 유효하게 남긴다
  //   (표지 실패 → 제목 그라데이션 표지 / 번역 실패 → 한국어본만).
  async function uploadHtml(file: File) {
    if (!/\.html?$/i.test(file.name)) {
      alert('HTML 파일(.html)만 업로드할 수 있습니다.')
      return
    }
    if (!draft) return
    setUploading('optimize')
    setTrStatus('파일 최적화 중…')
    try {
      // 다이어트 먼저 — 폰트를 밖으로 빼고 이미지를 WebP 로 바꾼다(→ lib/ebookOptimize.ts 머리말).
      //   ⚠️ 저장·표지·번역 전부 **최적화된 본문**으로 이어져야 한다. 원본 File 을 그대로 올리면
      //      번역본 5벌에도 폰트가 도로 실린다(한 권에 3MB × 6 = 18MB).
      const opt = await optimizeEbookHtml(await file.text(), (p) => {
        setTrStatus(p.phase === 'font' ? '폰트 정리 중…' : `이미지 변환 ${p.done}/${p.total}`)
      })
      const html = opt.html
      setTrStatus(optimizeSummary(opt))
      setUploading('html')
      const path = `${crypto.randomUUID()}/${file.name.replace(/[^\w.-]/g, '_')}`
      const { error } = await supabase.storage
        .from('ebooks')
        .upload(path, new Blob([html], { type: 'text/html' }), { contentType: 'text/html', upsert: false })
      if (error) throw error
      // ⚠️ setState 는 비동기라 이 함수 안에서 draft 를 다시 읽으면 옛 값이다. 갱신본을 직접 들고 간다.
      const next: EbookDraft = { ...draft, storagePath: path }
      patch({ storagePath: path })

      setUploading('cover')
      try {
        patch({ coverUrl: await bakeCover(html) })
      } catch (e) {
        alert(`표지 생성 실패 — 본문은 등록됐습니다.\n${e instanceof Error ? e.message : ''}`)
      }

      setUploading('translate')
      setTrStatus('번역 준비 중…')
      try {
        patch({ translations: await runTranslation(html, next) })
      } catch (e) {
        alert(`번역 실패 — 한국어본은 등록됐습니다. 저장 후 '다시 번역'으로 재시도할 수 있습니다.\n${e instanceof Error ? e.message : ''}`)
      }
      setTrStatus('')
    } catch (e) {
      alert(e instanceof Error ? e.message : '업로드에 실패했습니다.')
    } finally {
      setUploading(null)
      setTrStatus('')
    }
  }

  // 이미 등록된 책의 표지 다시 굽기 — 본문을 비공개 버킷에서 내려받아 1페이지를 다시 렌더한다
  // (관리자는 ebooks 버킷 전체 권한이 있다: storage 정책 ebooks_admin_all).
  async function regenCover() {
    if (!draft?.storagePath) return
    setUploading('cover')
    try {
      const { data, error } = await supabase.storage.from('ebooks').download(draft.storagePath)
      if (error) throw error
      patch({ coverUrl: await bakeCover(await data.text()) })
    } catch (e) {
      alert(e instanceof Error ? e.message : '표지를 만들지 못했습니다.')
    } finally {
      setUploading(null)
    }
  }

  async function save() {
    if (!draft) return
    if (!draft.title.trim()) {
      alert('제목은 필수입니다.')
      return
    }
    if (!draft.storagePath) {
      alert('이북 HTML 파일을 업로드해 주세요.')
      return
    }
    setSaving(true)
    try {
      let d = draft
      // 번역은 사람이 버튼을 눌러야 도는 게 아니라 **저장하면 반드시 있는 상태**가 되게 한다.
      //   (업로드 직후엔 이미 돌았고, 여기 걸리는 건 번역 전에 등록된 옛 책·번역 실패 후 재저장뿐)
      if (!Object.keys(d.translations).length) {
        setUploading('translate')
        setTrStatus('본문 내려받는 중…')
        try {
          const { data, error } = await supabase.storage.from('ebooks').download(d.storagePath)
          if (error) throw error
          d = { ...d, translations: await runTranslation(await data.text(), d) }
          setDraft(d)
        } catch (e) {
          // 번역이 안 되더라도 한국어본 등록 자체는 막지 않는다.
          alert(`번역에 실패해 한국어본만 저장합니다. '다시 번역'으로 재시도할 수 있습니다.\n${e instanceof Error ? e.message : ''}`)
        } finally {
          setUploading(null)
          setTrStatus('')
        }
      }
      await callFunction('admin', { action: 'ebookUpsert', ebook: d })
      ebookDraft.clear()
      setDraft(null)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  // 목록에서 ↑(-1)/↓(+1) 이동 → 전체 순서 재구성해 서버가 sort_order 재부여(FAQ 의 move 와 동일 패턴).
  //   ⚠️ 순서는 **이 카탈로그 안에서만** 바뀌지만, 서버로는 두 카탈로그를 합친 **전체 ids** 를 보내야 한다
  //      (ebookReorder 가 받은 순서대로 sort_order 를 다시 매기므로, 빠진 책은 순서가 뒤엉킨다).
  //      그래서 반대쪽 책들은 원래 자리에 그대로 두고, 이 카탈로그 자리에만 바뀐 순서를 끼워 넣는다.
  async function move(b: AdminEbookRow, dir: -1 | 1) {
    const idx = list.findIndex((r) => r.id === b.id)
    const swap = idx + dir
    if (swap < 0 || swap >= list.length) return
    const g = [...list]
    ;[g[idx], g[swap]] = [g[swap], g[idx]]
    let k = 0
    const ids = rows.map((r) => ((r.catalog ?? 'leveltest') === catalog ? g[k++].id : r.id))
    setBusy(true)
    try {
      await callFunction('admin', { action: 'ebookReorder', ids })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '순서 변경에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(b: AdminEbookRow) {
    if (!confirm(`"${b.title}" 이북을 삭제할까요?\n구매 기록(${b.buyers}명)도 함께 사라집니다.`)) return
    try {
      await callFunction('admin', { action: 'ebookDelete', id: b.id })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제에 실패했습니다.')
    }
  }

  async function showBuyers(b: AdminEbookRow) {
    try {
      const res = await callFunction<AdminEbookBuyersResp>('admin', { action: 'ebookBuyers', id: b.id })
      setBuyersOf({ book: b, rows: res.buyers })
    } catch (e) {
      alert(e instanceof Error ? e.message : '구매자를 불러올 수 없습니다.')
    }
  }

  return (
    <>
      {preview && <EbookPreviewModal book={preview} onClose={() => setPreview(null)} />}
      <div className="admin-head">
        {/* 어느 스토어를 다루는 화면인지 제목이 말한다 — 두 화면이 생김새가 같아서 이게 없으면 헷갈린다. */}
        <h1>이북 관리 · {EBOOK_CATALOG_LABEL[catalog]}</h1>
        <div className="admin-head-actions">
          <span className="admin-count">총 {list.length}권</span>
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
          <button className="admin-mini" onClick={() => setDraft(emptyEbookDraft(catalog))}>
            + 새 이북
          </button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>표지</th>
              <th>제목</th>
              <th>분류</th>
              <th>가격</th>
              <th>구매</th>
              <th>본문</th>
              <th style={{ textAlign: 'center' }}>순서</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((b, i) => (
              <tr key={b.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${b.published ? 'submitted' : 'voided'}`}>{b.published ? '판매중' : '비공개'}</span>
                </td>
                <td>
                  {b.coverUrl ? (
                    <img src={b.coverUrl} alt="" style={{ width: 36, height: 51, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>-</span>
                  )}
                </td>
                <td>
                  <div style={{ fontWeight: 700 }}>{b.title}</div>
                  {b.author && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.author}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {ebookSlotLabel(b) || <span style={{ color: 'var(--muted)' }}>{catalog === 'caris' ? '급수 무관' : '레벨 무관'}</span>}
                </td>
                {/* 정가는 달러 하나다(2026-08-13). 원화는 결제 시점 환율로 계산되는 파생값이라 여기 안 적는다. */}
                <td style={{ whiteSpace: 'nowrap' }}>
                  {b.price_usd_cents > 0 ? (
                    <div style={{ fontWeight: 700 }}>{usdc(b.price_usd_cents, 'ko')}</div>
                  ) : '무료'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" onClick={() => showBuyers(b)}>{b.buyers}명</button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {/* 올린 책이 실제로 어떻게 보이는지 확인할 길이 없었다 — 관리자는 구매를 안 하므로
                      사용자용 뷰어(구매자 전용)로는 못 연다. 전용 미리보기로 연다. */}
                  <button className="admin-mini" disabled={!b.storagePath} onClick={() => setPreview(b)}>
                    미리보기
                  </button>
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                  <button className="admin-mini" disabled={busy || i === 0} onClick={() => move(b, -1)} aria-label="위로" title="위로">
                    ↑
                  </button>
                  <button className="admin-mini" style={{ marginLeft: 4 }} disabled={busy || i === list.length - 1} onClick={() => move(b, 1)} aria-label="아래로" title="아래로">
                    ↓
                  </button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="admin-mini"
                    onClick={() =>
                      setDraft({
                        id: b.id,
                        title: b.title,
                        author: b.author ?? '',
                        description: b.description ?? '',
                        coverUrl: b.coverUrl ?? '',
                        price_usd_cents: b.price_usd_cents,
                        catalog: b.catalog ?? 'leveltest',
                        targetLevel: b.targetLevel ?? null,
                        targetTier: b.targetTier ?? null,
                        storagePath: b.storagePath,
                        published: b.published,
                        sortOrder: b.sortOrder,
                        translations: b.translations ?? {},
                      })
                    }
                  >
                    수정
                  </button>{' '}
                  <button className="admin-mini" onClick={() => remove(b)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  등록된 이북이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="admin-modal-bg">
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setDraft(null)}>
              ✕
            </button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><h2 style={{ margin: 0 }}>{draft.id ? '이북 수정' : '새 이북'}</h2><DraftBar status={ebookDraft.status} savedAt={ebookDraft.savedAt} drafts={ebookDraft.drafts} onRefresh={ebookDraft.refresh} onRestore={(p: EbookDraft) => setDraft(p)} /></div>
            <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
              <label style={fieldStyle}>
                제목
                <input style={inpStyle} value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
              </label>
              <label style={fieldStyle}>
                지은이
                <input style={inpStyle} value={draft.author} onChange={(e) => patch({ author: e.target.value })} />
              </label>
              <label style={fieldStyle}>
                소개
                <textarea style={{ ...inpStyle, minHeight: 80 }} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
              </label>
              {/* 정렬 순서 입력칸은 제거 — 목록의 ↑↓(순서 열)로 관리(FAQ 방식). */}
              {/* 가격은 **달러로 입력**한다(2026-08-11) — 구매자 화면이 달러로만 말하는데 여기만 원이면
                  `2` 를 넣고 "$2 로 팔린다" 고 믿는 사고가 난다(실제로 $0.01 짜리 책이 그렇게 생겼다).
                  저장·결제는 계속 원이라 옆에 환산액을 같이 찍어 통장에 찍힐 값도 보이게 한다. */}
              <label style={{ ...fieldStyle, maxWidth: 260 }}>
                가격($) — 0 이면 무료
                <input
                  style={inpStyle}
                  type="number"
                  min={0}
                  step={0.5}
                  value={centsToUsdInput(draft.price_usd_cents)}
                  onChange={(e) => patch({ price_usd_cents: usdInputToCents(Number(e.target.value) || 0) })}
                />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {draft.price_usd_cents > 0 ? '국내 결제는 결제 시점 환율로 원화 청구됩니다.' : '무료'}
                </span>
              </label>
              {/* 분류 — 러닝 라이브러리(/ebooks)에서 어느 칸에 서는가. **카탈로그는 이 화면이 이미 정했다.**
                  LEVELTEST 쪽 레벨은 레벨테스트 결과창 추천 정렬에도 쓰인다(CARIS 교재는 추천에서 빠진다). */}
              <label style={{ ...fieldStyle, maxWidth: 280 }}>
                {catalog === 'caris' ? '대상 급수' : '대상 레벨'}
                <select
                  style={inpStyle}
                  value={ebookSlotValue(draft)}
                  onChange={(e) => {
                    const s = EBOOK_SLOTS[catalog].find((x) => x.value === e.target.value)
                    if (s) patch({ catalog, targetLevel: s.level, targetTier: s.tier })
                  }}
                >
                  {EBOOK_SLOTS[catalog].map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* 본문 HTML — 브라우저 기본 파일칸("선택된 파일 없음") 대신 버튼+상태로 정리 */}
              <div style={fieldStyle}>
                <span>이북 본문 <em style={{ color: 'var(--error, #d43a3a)', fontStyle: 'normal' }}>(HTML 파일 1개 · 필수)</em></span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label className="admin-mini" style={{ display: 'inline-block', cursor: uploading ? 'default' : 'pointer' }}>
                    {uploading === 'html' ? '업로드 중…' : uploading === 'cover' ? '표지 만드는 중…' : draft.storagePath ? 'HTML 다시 선택' : 'HTML 파일 선택'}
                    <input
                      type="file"
                      accept=".html,.htm,text/html"
                      style={{ display: 'none' }}
                      disabled={!!uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) uploadHtml(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <span style={{ fontSize: 13, color: draft.storagePath ? 'var(--ink)' : 'var(--muted)', wordBreak: 'break-all' }}>
                    {draft.storagePath ? `✓ ${draft.storagePath.split('/').pop()}` : '선택된 파일 없음'}
                  </span>
                </div>
              </div>

              {/* 표지 — 따로 올리지 않는다. 본문 1페이지를 그대로 구워 쓴다. */}
              <div style={fieldStyle}>
                <span>표지 <em style={{ color: 'var(--muted)', fontStyle: 'normal' }}>(본문 1페이지에서 자동 생성)</em></span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {draft.coverUrl ? (
                    <img src={draft.coverUrl} alt="" style={{ width: 43, height: 60, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--line)', display: 'block' }} />
                  ) : (
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {draft.storagePath ? '표지가 없습니다 — 아래 버튼으로 만들 수 있습니다.' : '본문 HTML 을 올리면 자동으로 만들어집니다.'}
                    </span>
                  )}
                  <button type="button" className="admin-mini" disabled={!draft.storagePath || !!uploading} onClick={regenCover}>
                    {uploading === 'cover' ? '표지 만드는 중…' : '표지 다시 만들기'}
                  </button>
                </div>
              </div>

              {/* 다국어 — 본문 업로드/저장 시 자동으로 돈다. 이 버튼은 다시 돌릴 때만 쓴다. */}
              <div style={fieldStyle}>
                <span>다국어 <em style={{ color: 'var(--muted)', fontStyle: 'normal' }}>(업로드·저장 시 자동 번역 · 넘치는 페이지는 자동으로 맞춰 넣음)</em></span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {EBOOK_LANGS.map((lg) => {
                    const t = draft.translations[lg]
                    // ⚠ 는 사람이 손봐야 하는 것에만 — 자동 축소로 해결된 페이지는 경고가 아니다.
                    const warn = !!t && ((t.failed ?? 0) > 0 || (t.overflowPages?.length ?? 0) > 0)
                    const title = !t
                      ? '번역 없음'
                      : [
                          (t.failed ?? 0) > 0 ? `번역 실패 조각 ${t.failed}개(한국어로 남음)` : '',
                          explainTranslateFail(t.failReasons),
                          (t.fittedPages?.length ?? 0) > 0 ? `자동 축소로 맞춘 페이지: ${t.fittedPages!.join(', ')}` : '',
                          (t.overflowPages?.length ?? 0) > 0 ? `축소해도 안 들어간 페이지: ${t.overflowPages!.join(', ')} — 원문 조판을 손봐야 함` : '',
                        ].filter(Boolean).join(' · ') || '이상 없음'
                    return (
                      <span
                        key={lg}
                        title={title}
                        className={`admin-badge st-${!t ? 'expired' : warn ? 'voided' : 'submitted'}`}
                        style={{ cursor: 'help' }}
                      >
                        {EBOOK_LANG_LABEL[lg]}
                        {t ? (warn ? ' ⚠' : ' ✓') : ' –'}
                      </span>
                    )
                  })}
                  <button type="button" className="admin-mini" disabled={!draft.storagePath || !!uploading} onClick={regenTranslations}>
                    {uploading === 'translate' ? '번역 중…' : '다시 번역'}
                  </button>
                </div>
                {(uploading === 'translate' || uploading === 'optimize' || uploading === 'html') && trStatus && (
                  <span
                    style={{
                      fontSize: trWaiting ? 13 : 12.5,
                      fontWeight: trWaiting ? 700 : 400,
                      color: trWaiting ? 'var(--error, #d43a3a)' : 'var(--muted)',
                    }}
                  >
                    {trWaiting ? '⏳ ' : ''}{trStatus}
                  </span>
                )}
                {/* ⚠️ 원인을 안 보여주면 관리자는 "번역이 안 된다" 로만 알고 문의를 넣는다(2026-08-19).
                    실패 조각이 하나라도 있으면 **무엇 때문인지와 무엇을 하면 되는지**를 같이 적는다. */}
                {!uploading && (() => {
                  const hit = EBOOK_LANGS.map((lg) => draft.translations[lg]).find((x) => (x?.failed ?? 0) > 0)
                  const why = explainTranslateFail(hit?.failReasons)
                  if (!hit || !why) return null
                  return (
                    <span style={{ fontSize: 12.5, color: 'var(--error, #d43a3a)', lineHeight: 1.6 }}>
                      ⚠ 번역이 덜 채워졌습니다(원문 그대로 남은 조각 {hit.failed}개) — {why}
                    </span>
                  )
                })()}
                {!uploading && EBOOK_LANGS.some((lg) => (draft.translations[lg]?.overflowPages?.length ?? 0) > 0) && (
                  <span style={{ fontSize: 12.5, color: 'var(--error, #d43a3a)' }}>
                    ⚠ 축소 하한(82%)까지 줄여도 안 들어간 페이지가 있습니다 — 뱃지에 마우스를 올리면 페이지 번호가 보입니다.
                  </span>
                )}
              </div>

              <label style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={draft.published} onChange={(e) => patch({ published: e.target.checked })} />
                스토어에 공개(판매 시작)
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button className="admin-mini" onClick={() => setDraft(null)}>
                  취소
                </button>
                <button className="admin-mini" onClick={save} disabled={saving || !!uploading}>
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {buyersOf && (
        <div className="admin-modal-bg">
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-x" onClick={() => setBuyersOf(null)}>
              ✕
            </button>
            <h2>
              {buyersOf.book.title} — 구매자 {buyersOf.rows.length}명
            </h2>
            <div className="admin-table-wrap" style={{ marginTop: 12 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>이메일</th>
                    <th>결제</th>
                    <th>구매일</th>
                  </tr>
                </thead>
                <tbody>
                  {buyersOf.rows.map((b) => (
                    <tr key={b.userId}>
                      <td>{b.name ?? '-'}</td>
                      <td>{b.email ?? '-'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {b.pricePaid > 0 ? krw(b.pricePaid, 'ko') : '무료'} · {b.source}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(b.createdAt)}</td>
                    </tr>
                  ))}
                  {buyersOf.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                        아직 구매자가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── 주관식 채점 (admin 함수의 gradeQueue/gradeAnswer) ──
//   대기 목록에서 O/X 채점, "채점 완료 포함" 토글로 재채점(수정), 각 항목에서 그 응시의 객관식 답안 참고 조회.
// 이북 미리보기 — 관리자가 올린 책이 실제로 어떻게 보이는지 확인한다.
//   ⚠️ 서명 URL 을 iframe src 에 그대로 물리면 안 된다 — Supabase Storage 는 HTML 을 `text/plain` 으로
//      내려보내 소스코드가 그대로 보인다. 그래서 텍스트로 받아 srcdoc 에 넣는다(사용자 뷰어와 같은 방식).
//   ⚠️ sandbox 에 allow-same-origin 을 주지 않는다 — 책 안 스크립트가 관리자 세션에 닿으면 안 된다.
interface EbookPreviewResp { id: string; title: string; url: string; langs: string[]; lang: string }
function EbookPreviewModal({ book, onClose }: { book: AdminEbookRow; onClose: () => void }) {
  const [html, setHtml] = useState('')
  const [meta, setMeta] = useState<EbookPreviewResp | null>(null)
  const [lang, setLang] = useState('ko')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(''); setHtml('')
    callFunction<EbookPreviewResp>('admin', { action: 'ebookPreview', id: book.id, lang })
      .then(async (r) => {
        if (!alive) return
        setMeta(r)
        const res = await fetch(r.url)
        if (!res.ok) throw new Error(`본문을 받지 못했습니다 (${res.status})`)
        const text = await res.text()
        if (alive) setHtml(text)
      })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : '불러오기 실패') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [book.id, lang])

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div
        className="admin-modal admin-modal-wide"
        style={{ maxWidth: 'min(1180px, 96vw)', height: '92vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2 style={{ marginBottom: 4 }}>{book.title}</h2>
        <p className="admin-modal-meta" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          미리보기 — 구매자가 보는 화면과 같습니다
          {(meta?.langs.length ?? 0) > 1 && (
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ padding: '4px 8px' }}>
              {meta!.langs.map((l) => <option key={l} value={l}>{EBOOK_LANG_LABEL[l] ?? l}</option>)}
            </select>
          )}
          {meta && meta.lang !== lang && <span style={{ color: 'var(--k-amber, #d98a00)' }}>이 언어 번역본이 없어 한국어를 보여줍니다</span>}
        </p>
        {err && <div className="admin-section admin-empty">{err}</div>}
        {loading && <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>}
        {html && (
          <iframe
            title="이북 미리보기"
            srcDoc={html}
            sandbox="allow-scripts"
            style={{ flex: 1, width: '100%', border: '1px solid var(--line2)', borderRadius: 10, background: '#fff' }}
          />
        )}
      </div>
    </div>
  )
}

function fmtDTShort(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function GradingAdmin() {
  const [items, setItems] = useState<GradeQueueItem[]>([])
  const [scope, setScope] = useState<'pending' | 'all'>('pending')
  const [round, setRound] = useState<string>('') // '' = 전체, roundId, 'none' = 상시/미배정
  const [exam, setExam] = useState<string>('') // '' = 전체, examTitle = 그 시험(급수)만 — 회차 안에서 더 좁혀 보기
  const [rounds, setRounds] = useState<GradeRound[]>([])
  const [exams, setExams] = useState<AdminExamItem[]>([]) // 등록시험(회차×급수) — 시험 드롭다운 소스
  const [unassigned, setUnassigned] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 채점 중인 answerId
  const [mcFor, setMcFor] = useState<GradeQueueItem | null>(null) // 객관식 참고 조회 대상
  const [open, setOpen] = useState<Set<string>>(new Set()) // 펼친 응시(attemptId)
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const loadRounds = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        callFunction<GradeRoundsResponse>('admin', { action: 'gradeRounds' }),
        callFunction<AdminExamListResp>('admin', { action: 'examListForAdmin' }),
      ])
      setRounds(r.rounds)
      setUnassigned(r.unassigned)
      setExams(e.exams)
    } catch {
      /* 회차 목록 실패해도 채점은 가능 */
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await callFunction<GradeQueueResponse>('admin', { action: 'gradeQueue', scope, roundId: round || undefined })
      setItems(r.items)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [scope, round])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    loadRounds()
  }, [loadRounds])
  useEffect(() => {
    setOpen(new Set()) // 회차/범위 바뀌면 펼침·시험필터 초기화
    setExam('')
  }, [scope, round])

  async function grade(it: GradeQueueItem, correct: boolean) {
    setBusy(it.answerId)
    try {
      await callFunction('admin', { action: 'gradeAnswer', answerId: it.answerId, correct })
      if (scope === 'pending') {
        // 대기만 보는 중 — 채점하면 목록에서 제거
        setItems((prev) => prev.filter((x) => x.answerId !== it.answerId))
      } else {
        setItems((prev) => prev.map((x) => (x.answerId === it.answerId ? { ...x, isCorrect: correct, reviewStatus: 'graded' } : x)))
      }
      loadRounds() // 회차별 대기 수 갱신
    } catch (e) {
      alert(e instanceof Error ? e.message : '채점 실패')
    } finally {
      setBusy(null)
    }
  }

  const regular = rounds.filter((r) => r.kind === 'regular')
  // 회차 안에서 시험(급수)별로 좁혀 보기 — 그 회차에 등록된 시험(exams)에서 옵션 구성(제출 유무 무관).
  const roundExams = (round && round !== 'none' ? exams.filter((e) => e.round_id === round) : exams)
    .slice().sort((a, b) => tierRank(a.tier) - tierRank(b.tier))
  const shown = exam ? items.filter((i) => (i.examTitle ?? '') === exam) : items
  const pendingN = shown.filter((i) => i.reviewStatus === 'pending').length

  // 응시(attempt)별로 묶는다 — 응시자 한 명이 여러 주관식을 한 카드묶음으로(끝없이 길어지는 문제 해결).
  const groups: { attemptId: string; userName: string | null; userEmail: string | null; examTitle: string | null; submittedAt: string | null; items: GradeQueueItem[] }[] = []
  {
    const byId = new Map<string, (typeof groups)[number]>()
    for (const it of shown) {
      let g = byId.get(it.attemptId)
      if (!g) {
        g = { attemptId: it.attemptId, userName: it.userName, userEmail: it.userEmail, examTitle: it.examTitle, submittedAt: it.submittedAt, items: [] }
        byId.set(it.attemptId, g)
        groups.push(g)
      }
      g.items.push(it)
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1>주관식 채점</h1>
        <div className="admin-head-actions">
          <span className="admin-count">대기 {scope === 'pending' ? shown.length : pendingN}건</span>
          <label className="grade-round">
            <span className="grade-round-lab">회차</span>
            <select value={round} onChange={(e) => setRound(e.target.value)}>
              <option value="">전체</option>
              {regular.map((r) => (
                <option key={r.roundId} value={r.roundId}>{r.title}{r.pending ? ` (${r.pending})` : ''}</option>
              ))}
              <option value="none">상시·미배정{unassigned ? ` (${unassigned})` : ''}</option>
            </select>
          </label>
          <label className="grade-round">
            <span className="grade-round-lab">시험</span>
            <select value={exam} onChange={(e) => setExam(e.target.value)}>
              <option value="">전체 급수</option>
              {roundExams.map((ex) => {
                const n = items.filter((i) => (i.examTitle ?? '') === ex.title && i.reviewStatus === 'pending').length
                return <option key={ex.id} value={ex.title}>{ex.tier ? TIER_LABEL[ex.tier] ?? ex.tier : ex.title}{n ? ` (${n})` : ''}</option>
              })}
            </select>
          </label>
          <div className="admin-tabs" style={{ marginBottom: 0 }}>
            <button className={scope === 'pending' ? 'on' : ''} onClick={() => setScope('pending')}>채점 대기</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>완료 포함(수정)</button>
          </div>
          <button className="admin-mini" onClick={() => { load(); loadRounds() }} disabled={loading}>새로고침</button>
        </div>
      </div>

      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      {loading && <div className="admin-section" style={{ color: 'var(--muted)' }}>불러오는 중…</div>}
      {!loading && !err && groups.length === 0 && (
        <div className="admin-section admin-empty">{scope === 'pending' ? '채점 대기 중인 주관식 답안이 없습니다.' : '주관식 답안이 없습니다.'}</div>
      )}

      {/* 응시자(응시)별로 접힌 목록 → 클릭하면 그 사람 주관식 문항이 펼쳐진다 */}
      <div className="grade-groups">
        {groups.map((g) => {
          const isOpen = open.has(g.attemptId)
          const pend = g.items.filter((x) => x.reviewStatus === 'pending').length
          return (
            <div key={g.attemptId} className={`grade-group ${isOpen ? 'open' : ''}`}>
              <button className="grade-group-head" onClick={() => toggle(g.attemptId)} aria-expanded={isOpen}>
                <span className="material-symbols-outlined ggh-caret">{isOpen ? 'expand_more' : 'chevron_right'}</span>
                <span className="ggh-who">
                  <b>{g.userName || '이름없음'}</b>
                  <span>{g.userEmail}</span>
                </span>
                <span className="ggh-meta">{g.examTitle} · 제출 {fmtDTShort(g.submittedAt)}</span>
                <span className={`ggh-count ${pend ? 'pend' : 'done'}`}>
                  {scope === 'pending'
                    ? `주관식 ${g.items.length}문항`
                    : pend
                      ? `대기 ${pend} · 완료 ${g.items.length - pend}`
                      : `완료 ${g.items.length}`}
                </span>
              </button>
              {isOpen && (
                <div className="grade-group-body">
                  {g.items.map((it) => (
                    <GradeCard key={it.answerId} it={it} busy={busy} onGrade={grade} onMc={setMcFor} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {mcFor && <McReviewModal item={mcFor} onClose={() => setMcFor(null)} />}
    </>
  )
}

// 주관식 답안 1건 카드 — 그룹(응시자) 펼침 안에서 렌더.
function GradeCard({ it, busy, onGrade, onMc }: {
  it: GradeQueueItem
  busy: string | null
  onGrade: (it: GradeQueueItem, correct: boolean) => void
  onMc: (it: GradeQueueItem) => void
}) {
  const done = it.reviewStatus === 'graded'
  return (
    <div className={`grade-card ${done ? (it.isCorrect ? 'ok' : 'no') : ''}`}>
      <div className="grade-top">
        <div className="grade-meta">
          {it.number}번 · {it.subject}
          {done && (
            <span className={`grade-badge ${it.isCorrect ? 'ok' : 'no'}`}>{it.isCorrect ? '정답 처리' : '오답 처리'}</span>
          )}
        </div>
      </div>

      <div className="grade-q">
        <p className="grade-q-prompt">{it.prompt}</p>
      </div>

      {it.answerKey && (
        <div className="grade-key">
          <span className="grade-label">모범답안 / 채점 기준</span>
          <p>{it.answerKey}</p>
        </div>
      )}

      <div className="grade-ans">
        <span className="grade-label">응시자 답안</span>
        <p>{it.answerText?.trim() ? it.answerText : <em className="grade-empty">(무응답)</em>}</p>
      </div>

      <div className="grade-actions">
        <button className={`grade-btn ok ${done && it.isCorrect ? 'active' : ''}`} disabled={busy === it.answerId} onClick={() => onGrade(it, true)}>
          <span className="material-symbols-outlined">check_circle</span>
          {done ? '정답으로 수정' : '정답'}
        </button>
        <button className={`grade-btn no ${done && !it.isCorrect ? 'active' : ''}`} disabled={busy === it.answerId} onClick={() => onGrade(it, false)}>
          <span className="material-symbols-outlined">cancel</span>
          {done ? '오답으로 수정' : '오답'}
        </button>
        <button className="admin-mini" style={{ marginLeft: 'auto' }} onClick={() => onMc(it)}>
          이 응시 객관식 보기
        </button>
      </div>
    </div>
  )
}

// 채점 참고용 — 해당 응시의 객관식 답안(정오답)을 조회해 보여준다.
function McReviewModal({ item, onClose }: { item: GradeQueueItem; onClose: () => void }) {
  const [answers, setAnswers] = useState<AdminAnswerRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    callFunction<AdminDetailResponse>('admin', { action: 'detail', attemptId: item.attemptId })
      .then((r) => setAnswers(r.answers.filter((a) => a.kind !== 'short')))
      .catch((e) => setErr(e instanceof Error ? e.message : '불러오기 실패'))
  }, [item.attemptId])

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2>{item.userName || '-'} <span className="admin-modal-email">{item.userEmail}</span></h2>
        <p className="admin-modal-meta">{item.examTitle} · 객관식 답안(참고)</p>
        {err && <div className="admin-empty">{err}</div>}
        {!answers && !err && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>}
        {answers && (
          <div className="admin-ans-list">
            {answers.map((a) => (
              <div key={a.answerId} className={`admin-ans ${a.isCorrect ? 'ok' : 'no'}`}>
                <span className="admin-ans-no">{a.number}</span>
                <span className="admin-ans-q">{a.prompt}</span>
                <span className="admin-ans-pick">
                  {a.selectedIndex === null ? '미응답' : `${a.selectedIndex + 1}번`} / 정답 {a.correctIndex + 1}번
                </span>
              </div>
            ))}
            {!answers.length && <div className="admin-empty">객관식 문항이 없습니다.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 대시보드 (운영 분석) — admin.css(CARIS ARENA) 클래스 그대로 사용 ──
function MiniBars({ days, map, color }: { days: string[]; map: Record<string, number>; color: string }) {
  const vals = days.map((d) => map[d] ?? 0)
  const max = Math.max(1, ...vals)
  const sum = vals.reduce((x, y) => x + y, 0)
  return (
    <>
      <div className="mini-bars">
        {days.map((d, i) => (
          <div key={d} className="mini-bar">
            <div className="fill" style={{ height: `${(vals[i] / max) * 100}%`, background: color }} />
            <div className="mini-tip"><span>{d.slice(5)}</span><b>{vals[i]}</b></div>
          </div>
        ))}
      </div>
      <div className="mini-foot">{days[0]?.slice(5)} ~ {days[days.length - 1]?.slice(5)} · 합계 {sum}</div>
    </>
  )
}

function HBar({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  return (
    <div className="hbar">
      <span className="hbar-l" title={label}>{label}</span>
      <div className="hbar-track"><div className="hbar-fill" style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%` }} /></div>
      <span className="hbar-v">{value}{sub ?? ''}</span>
    </div>
  )
}

// 기간 선택(7/30/90 + 사용자지정 날짜). 추이·결제 차트 공용.
type DayRange = { preset: number; from: string; to: string } // preset 0 = 사용자지정
function useDayRange(days: string[], def = 30): [DayRange, (r: DayRange) => void, string[]] {
  const last = days[days.length - 1] ?? ''
  const [r, setR] = useState<DayRange>({ preset: def, from: days[Math.max(0, days.length - def)] ?? days[0] ?? '', to: last })
  const view = r.preset ? days.slice(-r.preset) : days.filter((d) => (!r.from || d >= r.from) && (!r.to || d <= r.to))
  return [r, setR, view]
}
function RangeControl({ value, onChange, days }: { value: DayRange; onChange: (r: DayRange) => void; days: string[] }) {
  const first = days[0] ?? ''
  const last = days[days.length - 1] ?? ''
  return (
    <div className="rng">
      {[7, 30, 90].map((p) => (
        <button key={p} className={value.preset === p ? 'on' : ''} onClick={() => onChange({ preset: p, from: days[Math.max(0, days.length - p)] ?? first, to: last })}>{p}일</button>
      ))}
      <input type="date" className="rng-date" min={first} max={last} value={value.from} onChange={(e) => onChange({ preset: 0, from: e.target.value, to: value.to || last })} />
      <span className="rng-tilde">~</span>
      <input type="date" className="rng-date" min={first} max={last} value={value.to} onChange={(e) => onChange({ preset: 0, from: value.from || first, to: e.target.value })} />
    </div>
  )
}
function TrendChart({ title, days, map, color }: { title: string; days: string[]; map: Record<string, number>; color: string }) {
  const [range, setRange, view] = useDayRange(days, 30)
  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <h3>{title}</h3>
        <RangeControl value={range} onChange={setRange} days={days} />
      </div>
      <MiniBars days={view} map={map} color={color} />
    </div>
  )
}

function DiffRows({ rows, empty }: { rows: CbtQDiff[]; empty: string }) {
  if (!rows.length) return <div className="admin-empty">{empty}</div>
  return (
    <div className="diff-list">
      {rows.map((r) => (
        <div key={r.id} className={`diff-item ${r.rate < 35 ? 'hard' : ''} ${!r.active ? 'off' : ''}`}>
          <div className="diff-head" style={{ cursor: 'default' }}>
            <span className={`diff-rate ${r.rate < 35 ? 'low' : r.rate > 90 ? 'high' : ''}`}>{r.rate}%</span>
            <span className="diff-q">{r.number}. {r.prompt}</span>
            <span className="diff-meta">{r.subject}{r.exam ? ` · ${r.exam}` : ''} · 응시 {r.n}{!r.active ? ' · 비활성' : ''}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// 결제 원장 응답 — 대시보드와 접수·응시권 탭이 같이 쓴다(로컬 타입, 위 TicketsAdmin 주석 참고).
interface PaymentAdminRow {
  id: string
  userId: string
  name: string | null
  email: string | null
  orderId: string
  orderName: string
  productType: string
  productRef: string
  amount: number
  status: string
  method: string | null
  confirmedAt: string | null
  fulfilledAt: string | null
  failCode: string | null
  failMessage: string | null
  createdAt: string
}
interface PaymentListResp {
  payments: PaymentAdminRow[]
  total: number
  stats30d: { paidN: number; paidAmount: number; refundN: number; refundAmount: number }
  queues: { unfulfilled: number; revoked: number }
}

function DashboardAdmin({ go }: { go: AdminGo }) {
  const [a, setA] = useState<CbtAnalytics | null>(null)
  const [pay, setPay] = useState<PaymentListResp | null>(null)
  const [sold, setSold] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      // 결제·접수 집계는 실패해도 대시보드 전체를 막지 않는다(응시권 마이그레이션 전이면 그냥 빈 상태).
      const [an, p, s] = await Promise.all([
        callFunction<CbtAnalytics>('admin', { action: 'cbtAnalytics' }),
        callFunction<PaymentListResp>('admin', { action: 'paymentList', limit: 5 }).catch(() => null),
        callFunction<TicketSummaryResp>('admin', { action: 'examTicketSummary' }).catch(() => null),
      ])
      setA(an)
      setPay(p)
      // 회차 접수 수는 examTicketSummary 한 곳에서만 가져온다 — 퍼널과 접수·응시권 탭이 같은 값을 봐야 한다.
      setSold(Object.fromEntries((s?.rounds ?? []).map((r) => [r.roundId, r.sold])))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <div className="admin-head">
        <h1>대시보드</h1>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      {loading && !a && <div className="admin-section" style={{ color: 'var(--muted)' }}>불러오는 중…</div>}
      {a && <DashboardBody a={a} pay={pay} sold={sold} go={go} />}
    </>
  )
}

// ⚠️ 관리자 화면 금액은 **원화(krw)** 다. 구매자 화면은 $1 = 1,500원 고정 환산으로 달러를 보여주지만,
//    관리자는 실제 청구·정산 금액을 봐야 한다. 예전엔 여기가 원화 값에 `$` 를 붙이고 있었다.
function DashboardBody({ a, pay, sold, go }: {
  a: CbtAnalytics
  pay: PaymentListResp | null
  sold: Record<string, number>
  go: AdminGo
}) {
  const o = a.overview
  // 전부 admin.cbtAnalytics 실집계(값 없으면 0). 결제·접수는 paymentList / examTicketSummary 실데이터.
  const signups7d = o.signups7d ?? 0
  const certIssued = o.certIssued ?? 0
  const certPending = o.certPending ?? 0
  const resultPending = o.resultPending ?? 0
  const inProgress = o.inProgress ?? 0
  const pendingGrading = o.pendingGrading ?? 0
  const avgScore = a.avgScore ?? 0
  const rounds = a.rounds ?? []

  const actions = [
    // 제출답안 화면의 빠른필터는 URL(`?f=`)로 넘긴다 — 이제 서로 다른 메뉴라 state 로 못 넘긴다.
    { ico: 'rate_review', label: '주관식 채점 대기', n: pendingGrading, tone: 'amber', go: () => go('caris', 'subs', 'grading') },
    { ico: 'workspace_premium', label: '인증서 미발급(합격)', n: certPending, tone: 'blue', go: () => go('caris', 'cert') },
    { ico: 'schedule', label: '결과 공개 대기', n: resultPending, tone: 'muted', go: () => go('caris', 'subs', 'list', { f: 'result_pending' }) },
    { ico: 'timelapse', label: '응시 진행 중', n: inProgress, tone: 'muted', go: () => go('caris', 'subs', 'list', { f: 'in_progress' }) },
  ]
  const kpis = [
    { ico: 'group', k: '누적 유저', v: o.users.toLocaleString(), sub: `이번주 신규 +${signups7d}명`, accent: 'blue', delta: signups7d > 0 ? `+${signups7d}` : undefined },
    { ico: 'assignment_turned_in', k: '응시 제출', v: o.attemptsAll.toLocaleString(), sub: `최근 7일 ${o.attempts7d}건`, accent: 'violet' },
    { ico: 'verified', k: '합격률', v: `${a.passRate}%`, sub: `채점 ${a.scoredN}건 · 평균 ${avgScore}점`, accent: 'green' },
    { ico: 'workspace_premium', k: '인증서 발급', v: certIssued.toLocaleString(), sub: `미발급 ${certPending}건`, accent: 'amber' },
    {
      ico: 'payments',
      k: '매출(30일)',
      v: krw(pay?.stats30d.paidAmount ?? 0),
      sub: pay ? `결제 ${pay.stats30d.paidN}건 · 환불 ${pay.stats30d.refundN}건` : '결제 데이터 없음',
      accent: 'green',
    },
  ]

  return (
    <div className="admin-dash">
      {/* KPI */}
      <div className="kpi-grid">
        {kpis.map((c) => <Kpi key={c.k} {...c} />)}
      </div>

      {/* 처리 대기(액션) */}
      <div className="admin-section-head" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>처리 대기</h3>
        <span className="admin-hint">클릭하면 해당 화면(필터 적용)으로 이동</span>
      </div>
      <div className="act-grid">
        {actions.map((x) => (
          <button key={x.label} className={`act ${x.n > 0 ? `t-${x.tone}` : 'done'}`} onClick={x.go}>
            <span className="material-symbols-outlined act-ico">{x.n > 0 ? x.ico : 'check_circle'}</span>
            <span className="act-n">{x.n}</span>
            <span className="act-l">{x.label}</span>
          </button>
        ))}
      </div>

      {/* 결제 현황 — payments 원장 실데이터(30일) */}
      <PaymentSection data={pay} />

      {/* 추이 */}
      <div className="admin-grid2">
        <TrendChart title="가입 추이" days={a.days} map={a.signupByDay} color="var(--k-blue)" />
        <TrendChart title="응시(제출) 추이" days={a.days} map={a.submitByDay} color="var(--k-violet)" />
      </div>
      {a.certByDay && <TrendChart title="인증서 발급 추이" days={a.days} map={a.certByDay} color="var(--k-green)" />}

      {/* 급수별 분석 (/guide 자격 체계 기준 · 서버 실집계) */}
      <TierAnalysis tiers={a.tiers ?? []} />

      {/* 회차별 현황 퍼널 */}
      <div className="admin-section">
        <h3>회차별 현황 <span className="admin-hint">접수 → 응시 → 합격 → 인증서 발급</span></h3>
        <RoundFunnel rows={rounds} sold={sold} />
      </div>
    </div>
  )
}

// KPI 카드 — 아이콘 칩 + 값 + 증감 배지 + 색상 액센트.
function Kpi({ ico, k, v, sub, accent, delta }: {
  ico: string; k: string; v: string; sub: string; accent: string; delta?: string
}) {
  return (
    <div className={`kpi k-${accent}`}>
      <div className="kpi-top">
        <span className="material-symbols-outlined kpi-ico">{ico}</span>
        {delta ? <span className="kpi-delta">▲ {delta}</span> : null}
      </div>
      <div className="kpi-k">{k}</div>
      <div className="kpi-v">{v}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

// 급수(티어)별 분석 — 백엔드 급수별 실집계(admin.cbtAnalytics.tiers) 매칭. 막대·상세 패널은 항상 표시(값 없으면 0/빈).
// 급수 목록·라벨·과목은 /guide(getTracks) 단일 출처, 수치는 서버 실집계에서 tier key로 매칭.
function TierAnalysis({ tiers }: { tiers: CbtTierStat[] }) {
  const catalog = getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => ({ track: tr.name, key: ti.key, name: ti.name, subjects: ti.subjects })))
  const statOf = (key: string) => tiers.find((t) => t.tier === key)
  const [sel, setSel] = useState(catalog[1]?.key ?? catalog[0]?.key ?? '')
  const cur = catalog.find((t) => t.key === sel) ?? catalog[0]
  if (!cur) return null
  const dist = catalog.map((t) => ({ ...t, n: statOf(t.key)?.attempts ?? 0 }))
  const distMax = Math.max(1, ...dist.map((d) => d.n))
  const st = statOf(cur.key)
  const bands = ['0-59', '60-69', '70-79', '80-89', '90-100']
  const histMax = Math.max(1, ...(st?.scoreHist ?? []))
  const DLEVELS = ['상', '중', '하']

  return (
    <div className="admin-section">
      <div className="admin-section-head">
        <h3>급수별 분석 <span className="admin-hint">/guide 자격 체계 기준 · 서버 실집계</span></h3>
      </div>

      {/* 급수 분포 = 응시 수 막대 + 클릭 선택 (0이어도 항상 표시·선택 가능) */}
      <div className="admin-sub">급수 분포 · 응시 수 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>(막대 클릭 → 아래 상세 전환)</span></div>
      <div className="tier-dist">
        {dist.map((d) => (
          <button key={d.key} className={`tdist ${d.key === sel ? 'on' : ''}`} onClick={() => setSel(d.key)} title={`${d.name} · 응시 ${d.n}`}>
            {/* 트랙 뱃지(Ⅰ/Ⅱ)는 제거 — 이제 두 트랙 모두 'CARIS' 라 구분 정보가 없다. */}
            <span className="tdist-col"><span className="tdist-bar" style={{ height: `${(d.n / distMax) * 100}%` }} /></span>
            <span className="tdist-n">{d.n}</span>
            <span className="tdist-l">{d.name}</span>
          </button>
        ))}
      </div>

      {/* 선택 급수 상세 — 데이터 없어도 칸은 항상 표시, 값만 0/빈 */}
      <div className="tier-detail">
        <div className="tier-detail-head">
          <b>{cur.name}</b>
          <span>응시 <b>{st?.attempts ?? 0}</b> · 합격 <b>{st?.pass ?? 0}</b> ({st?.passRate ?? 0}%)</span>
        </div>
        <div className="tier-panel">
          <div className="admin-sub">점수 분포</div>
          {bands.map((lb, i) => <HBar key={lb} label={`${lb}점`} value={st?.scoreHist[i] ?? 0} max={histMax} sub="명" />)}
        </div>
        <div className="admin-grid2" style={{ marginTop: 14 }}>
          <div className="tier-panel">
            <div className="admin-sub">과목별 정답률</div>
            {cur.subjects.map((subj) => {
              const s = st?.subjects.find((x) => x.subject === subj)
              return <HBar key={subj} label={subj} value={s?.rate ?? 0} max={100} sub={`% (${s?.n ?? 0})`} />
            })}
          </div>
          <div className="tier-panel">
            <div className="admin-sub">난이도별 정답률</div>
            {DLEVELS.map((lv) => {
              const d = st?.difficulty.find((x) => x.level === lv)
              return <HBar key={lv} label={lv} value={d?.rate ?? 0} max={100} sub={`% (${d?.n ?? 0})`} />
            })}
          </div>
        </div>
        <div className="tier-panel" style={{ marginTop: 14 }}>
          <div className="admin-sub">⚠ 어려운 문항 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>정답률 낮은 순 · 응시 3회 이상</span></div>
          <DiffRows rows={st?.hard ?? []} empty="집계할 문항이 없습니다(문항당 응시 3회 이상 필요)." />
        </div>
        <div className="tier-panel" style={{ marginTop: 14 }}>
          <div className="admin-sub">쉬운 문항 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>정답률 높은 순</span></div>
          <DiffRows rows={st?.easy ?? []} empty="집계할 문항이 없습니다(문항당 응시 3회 이상 필요)." />
        </div>
      </div>
    </div>
  )
}

// 회차별 접수→응시→합격→발급 퍼널 표 (페이징 5행/쪽).
// ⚠️ '접수' 숫자는 examTicketSummary 에서만 온다(sold). 같은 지표를 여기서 따로 세면
//    접수·응시권 탭과 값이 어긋나고, 어긋나는 순간 둘 다 못 믿게 된다.
// ⚠️ 행 자체는 cbtAnalytics 기준이라 **응시가 0건인 회차는 여기 안 뜬다** —
//    "팔렸는데 아무도 안 봤다" 를 보려면 접수·응시권 탭을 봐야 한다.
function RoundFunnel({ rows, sold }: { rows: CbtRoundStat[]; sold: Record<string, number> }) {
  const [page, setPage] = useState(0)
  const PER = 5
  if (!rows.length) return <div className="admin-empty">회차 응시 데이터가 없습니다.</div>
  const pageMax = Math.max(1, Math.ceil(rows.length / PER))
  const shown = rows.slice(page * PER, page * PER + PER)
  return (
    <>
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>회차</th>
            <th>시험일</th>
            <th style={{ textAlign: 'right' }}>접수</th>
            <th style={{ textAlign: 'right' }}>응시</th>
            <th style={{ textAlign: 'right' }}>합격</th>
            <th style={{ textAlign: 'right' }}>합격률</th>
            <th style={{ textAlign: 'right' }}>발급</th>
            <th style={{ minWidth: 130 }}>진행</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const passRate = r.attempts ? Math.round((r.pass / r.attempts) * 100) : 0
            const certRate = r.attempts ? Math.round((r.cert / r.attempts) * 100) : 0
            return (
              <tr key={r.id}>
                <td><b>{r.title}</b></td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.kind === 'rolling' ? '상시' : r.examDate ?? '-'}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{sold[r.id] ?? 0}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.attempts}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.pass}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{passRate}%</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.cert}</td>
                <td>
                  <div className="fn-bar" title={`합격 ${passRate}% · 발급 ${certRate}%`}>
                    <div className="fn-pass" style={{ width: `${passRate}%` }} />
                    <div className="fn-cert" style={{ width: `${certRate}%` }} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    {pageMax > 1 && (
      <div className="admin-pager" style={{ marginTop: 12 }}>
        <button className="admin-mini" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ 이전</button>
        <span>{page + 1} / {pageMax}</span>
        <button className="admin-mini" disabled={page + 1 >= pageMax} onClick={() => setPage((p) => p + 1)}>다음 ›</button>
      </div>
    )}
    </>
  )
}

// 결제 현황 — payments 원장 30일 집계 + 최근 결제 + '돈이 새는' 두 큐.
// ⚠️ 환불은 매출에서 빼지 않고 옆에 세운다 — 결제일과 환불일이 다른 달에 걸리면 상계한 값이 정산과 안 맞는다.
// ⚠️ 두 큐(미지급·환불 후 지급 잔존)는 자동 회수를 안 하기로 한 방침의 **유일한 뒷정리 장치**다.
//    목록이 사람 눈에 안 닿으면 방어 장치가 아니므로 0 이 아닐 때 눈에 띄게 띄운다.
function PaymentSection({ data }: { data: PaymentListResp | null }) {
  const s = data?.stats30d
  const avg = s && s.paidN > 0 ? Math.round(s.paidAmount / s.paidN) : 0
  const unfulfilled = data?.queues.unfulfilled ?? 0
  const revoked = data?.queues.revoked ?? 0
  return (
    <div className="admin-section pay-sec">
      <div className="admin-section-head">
        <h3><span className="material-symbols-outlined pay-ico">credit_card</span>결제 현황 <span className="admin-hint">최근 30일 · 원화</span></h3>
        {!data && <span className="admin-badge-demo">데이터 없음</span>}
      </div>
      <div className="pay-kpis">
        <div><span className="pk-k">매출</span><span className="pk-v">{krw(s?.paidAmount ?? 0)}</span></div>
        <div><span className="pk-k">결제 건수</span><span className="pk-v">{s?.paidN ?? 0}건</span></div>
        <div><span className="pk-k">환불</span><span className="pk-v">{s?.refundN ?? 0}건 · {krw(s?.refundAmount ?? 0)}</span></div>
        <div><span className="pk-k">객단가</span><span className="pk-v">{krw(avg)}</span></div>
      </div>

      {(unfulfilled > 0 || revoked > 0) && (
        <div className="admin-empty" style={{ marginTop: 4, color: 'var(--k-amber, #d98a00)', lineHeight: 1.7 }}>
          {unfulfilled > 0 && <div>⚠ <b>승인됐는데 지급 안 된 결제 {unfulfilled}건</b> — 돈은 받았는데 응시권/이북이 안 나갔습니다. 확인이 필요합니다.</div>}
          {revoked > 0 && <div>⚠ <b>환불·취소인데 지급이 살아있는 결제 {revoked}건</b> — 응시권/열람권을 손으로 회수해야 합니다.</div>}
        </div>
      )}

      {data && data.payments.length > 0 ? (
        <div className="admin-table-wrap" style={{ marginTop: 10 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>일시</th>
                <th>구매자</th>
                <th>상품</th>
                <th style={{ textAlign: 'right' }}>금액</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 14, color: 'var(--muted)' }}>{fmtDT(p.createdAt)}</td>
                  <td style={{ fontSize: 14 }}>{p.name || p.email || '-'}</td>
                  <td style={{ fontSize: 14 }}>
                    {p.orderName}
                    <span style={{ color: 'var(--muted)' }}> · {p.productType === 'exam' ? '응시료' : '이북'}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{krw(p.amount)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 14 }}>
                    {p.status}
                    {p.status === 'paid' && !p.fulfilledAt && <b style={{ color: 'var(--k-amber, #d98a00)' }}> · 미지급</b>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty" style={{ marginTop: 4 }}>
          아직 결제 내역이 없습니다. 결제가 쌓이면 매출·최근 결제 내역이 여기에 표시됩니다.
        </div>
      )}
    </div>
  )
}

// ── 회원 관리 (목록 · 상세) ────────────────────────────────────────
// 합격한 시험명 목록 → 취득 급수 칩(중복 제거). 급수 파싱은 certNo.ts 가 단일 출처.
function gradeChips(titles: string[] | undefined) {
  const grades = [...new Set((titles ?? []).map((t) => gradeDisplay(t)))]
  if (!grades.length) return <span style={{ color: 'var(--dim)' }}>–</span>
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {grades.map((g) => <span key={g} className="badge ok">{g.replace(/^CARIS /, '')}</span>)}
    </span>
  )
}

// GARA 가입 회원 **전체** 한 벌 (2026-08-11 통합).
//   옛 구조엔 같은 사람을 보는 목록이 두 개였다 — `CARIS 시험 > 회원`(응시·취득급수)과
//   `WORLD ARENA > 유저`(등급·레벨테스트 응시). 사람은 하나인데 화면이 둘이라 "이 회원 뭐 했지"에
//   두 군데를 오가야 했다. 목록을 합치고, 갈리는 정보는 **상세 모달의 탭**으로 내렸다.
// ⚠️ 두 서버 함수의 응답을 **사람(id) 기준으로 겹쳐 쓴다.** 한쪽이 실패해도 다른 쪽 정보는 보여야 하므로
//    각각 catch 해서 빈 배열로 접는다 — 통짜 Promise.all 로 묶으면 아레나 함수 하나 때문에 회원 목록이 통째로 빈다.
interface MemberRow {
  id: string
  name: string | null
  email: string | null
  anon: boolean
  created: string
  carisAttempts: number
  passedTitles: string[]
  arenaRank: number | null
  arenaAttempts: number
  lastActive: string | null
}

function MembersAdmin() {
  const [rows, setRows] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | 'google' | 'guest'>('google')
  const [sort, setSort] = useState<'created' | 'caris' | 'arena'>('created')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<MemberRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const [cbt, arena] = await Promise.all([
      callFunction<CbtUsersResp>('admin', { action: 'cbtUsers' }).catch(() => null),
      callFunction<{ users: ArenaUserRow[] }>('admin-test', { action: 'users' }).catch(() => null),
    ])
    if (!cbt && !arena) {
      setErr('유저 목록을 불러올 수 없습니다.')
      setLoading(false)
      return
    }
    const merged = new Map<string, MemberRow>()
    for (const u of cbt?.users ?? []) {
      merged.set(u.id, {
        id: u.id, name: u.name, email: u.email, anon: u.anon, created: u.created,
        carisAttempts: u.attempts, passedTitles: u.passedTitles ?? [],
        arenaRank: null, arenaAttempts: 0, lastActive: u.lastActive,
      })
    }
    for (const a of arena?.users ?? []) {
      const prev = merged.get(a.id)
      if (prev) {
        prev.arenaRank = a.rank
        prev.arenaAttempts = a.attempts
        // 마지막 활동은 둘 중 **늦은 쪽**. CARIS 는 '마지막 제출', 아레나는 '마지막 활동' 이라 기준이 다르다.
        if (a.lastActive && (!prev.lastActive || a.lastActive > prev.lastActive)) prev.lastActive = a.lastActive
        prev.name ??= a.name
        prev.email ??= a.email
      } else {
        // CARIS 목록엔 없는 사람 = 게스트(익명). cbtUsers 가 익명을 빼고 주기 때문이다.
        merged.set(a.id, {
          id: a.id, name: a.name, email: a.email, anon: a.anon, created: a.created,
          carisAttempts: 0, passedTitles: [],
          arenaRank: a.rank, arenaAttempts: a.attempts, lastActive: a.lastActive,
        })
      }
    }
    setRows([...merged.values()])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [q, type, sort])

  const filtered = rows
    .filter((u) => {
      if (type === 'google' && u.anon) return false
      if (type === 'guest' && !u.anon) return false
      if (q) {
        const s = q.toLowerCase()
        if (!(u.name || '').toLowerCase().includes(s) && !(u.email || '').toLowerCase().includes(s)) return false
      }
      return true
    })
    .sort((x, y) =>
      sort === 'caris' ? y.carisAttempts - x.carisAttempts
        : sort === 'arena' ? (y.arenaRank ?? 0) - (x.arenaRank ?? 0)
          : (y.created || '').localeCompare(x.created || ''))
  const PER = 50
  const pageMax = Math.max(1, Math.ceil(filtered.length / PER))
  const shown = filtered.slice(page * PER, page * PER + PER)
  const googleN = rows.filter((u) => !u.anon).length

  return (
    <>
      <div className="admin-head">
        <h1>유저 관리</h1>
        <div className="admin-head-actions">
          <span className="admin-count">가입 {googleN}명 · 게스트 {rows.length - googleN}명</span>
          <button className="admin-mini" onClick={load} disabled={loading}>새로고침</button>
        </div>
      </div>
      {err && <div className="admin-section admin-empty">{err}</div>}

      {/* 지역 오배정 정정 — 옛 아레나 유저 탭에 있던 것. 회원 하나를 CS 로 손보는 일이라 여기 자리가 맞다. */}
      <RegionFixForm />

      <div className="admin-toolbar">
        <input className="admin-search" placeholder="이름·이메일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="google">가입 유저</option>
          <option value="guest">게스트</option>
          <option value="all">전체(게스트 포함)</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="created">가입 최신순</option>
          <option value="caris">CARIS 응시 많은순</option>
          <option value="arena">ARENA 등급순</option>
        </select>
        <span className="admin-hint">{filtered.length}명{loading ? ' · 불러오는 중…' : ''}</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>이메일</th>
              <th>유형</th>
              <th>가입</th>
              <th style={{ textAlign: 'right' }}>CARIS 응시</th>
              <th>취득 급수</th>
              <th style={{ textAlign: 'right' }}>ARENA</th>
              <th>마지막 활동</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td>{u.name || '-'}</td>
                <td style={{ color: 'var(--muted)' }}>{u.email || '-'}</td>
                <td>{u.anon ? '게스트' : '가입'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(u.created)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.carisAttempts}</td>
                {/* 합격 "횟수" 는 급수마다 시험이 갈리는 구조에서 뜻이 흐리다 —
                    3건이 "세 번 붙었다" 가 아니라 "Pro·Elite·Master 를 각각 땄다" 일 수 있다.
                    그래서 숫자 대신 취득 급수를 칩으로 보여준다(중복 제거). */}
                <td>{gradeChips(u.passedTitles)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {u.arenaRank == null ? <span style={{ color: 'var(--dim)' }}>–</span> : `Lv.${u.arenaRank} · ${u.arenaAttempts}회`}
                </td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(u.lastActive)}</td>
                <td><button className="admin-mini" onClick={() => setOpen(u)}>상세</button></td>
              </tr>
            ))}
            {!shown.length && !loading && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  조건에 맞는 유저가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pageMax > 1 && (
        <div className="admin-pager">
          <button className="admin-mini" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ 이전</button>
          <span>{page + 1} / {pageMax}</span>
          <button className="admin-mini" disabled={page + 1 >= pageMax} onClick={() => setPage((p) => p + 1)}>다음 ›</button>
        </div>
      )}
      {open && <MemberDetailModal user={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// ── 지역 오배정 정정 (T9) — 락된 회원의 지역을 어드민 CS 로 강제 정정 ──
// ⚠️ 화면 위치는 WORLD ARENA 백오피스(AdminLevelTest 의 유저 탭)다. 정의만 여기 두고 export 한다
//    — 지역(country_code/region_code)은 아레나 랭킹·월드맵 전용이고 자격검정은 이 값을 읽지 않는다.
//    ChatModAdmin·EbooksAdmin 과 같은 재사용 방식(서버는 계속 admin 함수를 부른다).
export function RegionFixForm() {
  const [uid, setUid] = useState('')
  const [region, setRegion] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function submit() {
    const id = uid.trim()
    if (!id || !region) { setMsg('유저 UID·지역을 입력하세요.'); return }
    setBusy(true)
    setMsg('')
    try {
      await callFunction('admin', { action: 'setRegion', uid: id, region, country: region.slice(0, 2) })
      setMsg(`✅ ${id} → ${region} 정정됨`)
      setUid('')
      setRegion('')
    } catch (e) {
      setMsg(`⚠ ${e instanceof Error ? e.message : '정정 실패'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-section">
      <h3>지역 오배정 정정</h3>
      <p className="admin-hint">락된 유저의 지역을 강제로 바로잡습니다(어드민 CS 전용).</p>
      <div className="admin-toolbar">
        <input
          className="admin-search"
          placeholder="유저 UID"
          value={uid}
          onChange={(e) => setUid(e.target.value)}
        />
        <select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">지역 선택…</option>
          {REGIONS.map((r) => (
            <option key={r.code} value={r.code}>{r.code}</option>
          ))}
        </select>
        <button className="admin-mini" onClick={submit} disabled={busy || !uid.trim() || !region}>
          {busy ? '정정 중…' : '정정'}
        </button>
      </div>
      {msg && <span className="admin-hint">{msg}</span>}
    </div>
  )
}

// 보유 자격증 — 합격 + 결과공개 경과인 응시에서 급수·취득일·만료일을 계산한다.
// 같은 급수를 여러 번 땄으면 가장 최근 것만 남긴다(자격증은 급수당 하나다).
function EarnedCerts({ attempts }: { attempts: CbtUserAttempt[] }) {
  const earned = attempts
    .filter((a) => a.passed === true && a.released && a.submittedAt)
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
  const byGrade = new Map<string, CbtUserAttempt>()
  for (const a of earned) {
    const g = gradeDisplay(a.examTitle)
    if (!byGrade.has(g)) byGrade.set(g, a)
  }
  if (!byGrade.size) {
    return <p className="admin-modal-meta" style={{ color: 'var(--dim)' }}>보유 자격증 없음</p>
  }
  return (
    <div className="cert-own">
      {[...byGrade.entries()].map(([g, a]) => {
        const at = new Date(a.submittedAt as string)
        const exp = certExpiryDate(a.examTitle, at)
        return (
          <div key={g} className="cert-own-item">
            <b>{g}</b>
            <span>취득 {fmtCertDate(at)}</span>
            <span>{exp ? `유효 ~${exp}` : '무기한'}</span>
          </div>
        )
      })}
    </div>
  )
}

// 회원 상세 — 한 사람을 세 관점으로 본다. 목록을 합친 대신 여기서 갈랐다.
//   ⚠️ 탭마다 자기 데이터를 자기가 부른다(열어야 부른다). 셋을 한 번에 부르면 CARIS 만 볼 사람도
//      아레나·결제까지 기다린다.
function MemberDetailModal({ user, onClose }: { user: MemberRow; onClose: () => void }) {
  const [tab, setTab] = useState<'caris' | 'arena' | 'pay'>('caris')
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  // 첫 진입 상태로 되돌리기 — 신규 가입 흐름(닉네임 → 국가·지역·연령대)을 실제 경로 그대로 다시 태운다.
  //   ⚠️ 게스트(익명)에게는 안 쓴다 — 게이트가 정식 회원에게만 도는 구조라 눌러도 아무 화면도 안 뜬다.
  //   ⚠️ 서버가 루트 전용으로 막는다(지역 1회 변경 잠금을 푸는 조작이라). 여기선 버튼을 숨기지 않고
  //      눌렀을 때 서버 문구를 그대로 보여준다 — 숨기면 왜 없는지 아무도 모른다.
  async function resetOnboarding() {
    if (!confirm(
      [
        `${user.name || user.email || '이 회원'} 을 첫 진입 상태로 되돌릴까요?`,
        '',
        '· 닉네임·국가·지역·연령대를 비웁니다 → 다음 접속에서 그 화면들을 다시 만납니다',
        '· 국가·지역 1회 변경권도 되돌아갑니다',
        '· 코인·아바타·응시 이력·자격증은 그대로입니다',
      ].join(String.fromCharCode(10)),
    )) return
    setResetting(true)
    try {
      await callFunction('admin', { action: 'resetOnboarding', uid: user.id })
      setResetDone(true)
    } catch (e) {
      alert(e instanceof Error ? e.message : '초기화에 실패했습니다.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="admin-modal-bg" onClick={onClose}>
      {/* 안에 표가 셋(응시 이력·레벨테스트 이력·결제 내역) 들어가므로 넓게 쓴다 — 기본 폭이면 가로 스크롤이 생긴다. */}
      <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <h2>
          {user.name || '-'} <span className="admin-modal-email">{user.email}</span>
        </h2>
        <p className="admin-modal-meta">
          가입 {fmtDT(user.created)} · {user.anon ? '게스트' : '가입 유저'}
          {user.arenaRank != null ? ` · ARENA Lv.${user.arenaRank}` : ''}
        </p>
        {!user.anon && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 12px' }}>
            <button className="admin-mini" onClick={resetOnboarding} disabled={resetting || resetDone}>
              {resetting ? '초기화 중…' : resetDone ? '초기화됨' : '첫 진입 상태로 초기화'}
            </button>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {resetDone
                ? '이 회원이 다음에 접속하면 닉네임 → 국가·지역 화면을 다시 만납니다.'
                : '신규 가입 흐름(닉네임·국가·지역·연령대)을 다시 태웁니다. 이력·자격증은 그대로.'}
            </span>
          </div>
        )}
        <div className="admin-tabs" style={{ marginBottom: 14 }}>
          <button className={tab === 'caris' ? 'on' : ''} onClick={() => setTab('caris')}>CARIS</button>
          <button className={tab === 'arena' ? 'on' : ''} onClick={() => setTab('arena')}>WORLD ARENA</button>
          <button className={tab === 'pay' ? 'on' : ''} onClick={() => setTab('pay')}>결제·구매</button>
        </div>
        {tab === 'caris' ? <MemberCarisPanel userId={user.id} /> : null}
        {tab === 'arena' ? <ArenaUserPanel userId={user.id} initialRank={user.arenaRank ?? 1} /> : null}
        {tab === 'pay' ? <MemberPayPanel userId={user.id} /> : null}
      </div>
    </div>
  )
}

function MemberCarisPanel({ userId }: { userId: string }) {
  const [detail, setDetail] = useState<CbtUserDetailResp | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    callFunction<CbtUserDetailResp>('admin', { action: 'cbtUserDetail', userId })
      .then(setDetail)
      .catch(() => setDetail({ attempts: [] }))
      .finally(() => setLoading(false))
  }, [userId])
  return (
    <>
      {/* 보유 자격증 — 응시 이력 줄마다 배지를 훑지 않아도 되게 맨 위에 모아둔다.
          (30번 떨어지고 1번 붙은 사람을 표에서 찾아내는 건 한눈이 아니다)
          자격증 테이블이 없어 "합격 + 결과공개일 경과" 인 응시에서 계산한다.
          ⚠️ 자격번호는 아직 안 띄운다 — 발급한 건만 진짜 번호(exam_attempts.cert_no)가 있고
             미발급 건은 번호 자체가 없어서(발급 시 DB 채번), 한 열에 섞으면 빈칸이 더 많아진다. */}
      {!loading ? <EarnedCerts attempts={detail?.attempts ?? []} /> : null}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>시험</th>
                <th>상태</th>
                <th>점수</th>
                <th>결과</th>
                <th>자격증</th>
                <th>제출</th>
              </tr>
            </thead>
            <tbody>
              {(detail?.attempts ?? []).map((at) => (
                <tr key={at.id}>
                  <td>{at.examTitle || '-'}</td>
                  <td>
                    <span className={`admin-badge st-${at.status}`}>{STATUS_LABEL[at.status] ?? at.status}</span>
                  </td>
                  <td>{at.totalCorrect != null ? `${at.totalCorrect} / ${at.totalQuestions}` : '-'}</td>
                  {/* 합격선 60%(서버 CBT_PASS_RATIO). 미제출·미채점은 판정 자체가 없다. */}
                  <td>{at.passed == null ? <span style={{ color: 'var(--dim)' }}>–</span>
                    : at.passed ? <span className="badge ok">합격</span> : <span className="badge low">불합격</span>}</td>
                  {/* 자격증 테이블이 따로 없다 — 합격 + 결과공개일 경과 = 발급 가능. */}
                  <td>{at.passed !== true ? <span style={{ color: 'var(--dim)' }}>–</span>
                    : at.released ? <span className="badge ok">발급 가능</span> : <span className="badge low">공개 대기</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(at.submittedAt)}</td>
                </tr>
              ))}
              {!(detail?.attempts ?? []).length && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                    응시 이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// 결제·구매 — 이 사람 결제 내역. `paymentList` 에 userId 필터를 얹어 쓴다.
//   ⚠️ 목록 화면(회원관리 > 결제관리)은 아직 없다(3단계). 여기는 "이 회원이 뭘 샀나" 만 본다.
function MemberPayPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<PaymentListResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => {
    setLoading(true)
    callFunction<PaymentListResp>('admin', { action: 'paymentList', userId, limit: 100 })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : '불러오기 실패'))
      .finally(() => setLoading(false))
  }, [userId])
  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>불러오는 중…</div>
  if (err) return <div className="admin-empty">{err}</div>
  // ⚠️ 클라에서 한 번 더 거른다. `userId` 필터는 admin 함수를 **배포해야** 먹는데, 배포 전 응답은
  //    전체 결제를 그대로 돌려준다 — 그러면 남의 결제가 이 회원 것으로 보인다. 돈 얘기라 서버만 믿지 않는다.
  const rows = (data?.payments ?? []).filter((p) => p.userId === userId)
  if (!rows.length) return <div className="admin-empty">결제 내역이 없습니다.</div>
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>일시</th><th>상품</th><th style={{ textAlign: 'right' }}>금액</th><th>상태</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtDT(p.createdAt)}</td>
              <td>
                {p.orderName}
                <span style={{ color: 'var(--muted)' }}> · {productLabel(p.productType)}</span>
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{krw(p.amount)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {/* ⚠️ 영문 코드(paid·pending)를 그대로 내보내지 않는다 — 이 화면은 사무 담당자가 본다. */}
                <span className="badge">{payStatusLabel(p.status)}</span>
                {/* 돈은 받았는데 물건이 안 나간 건 — 대사에서 잡히는 그 신호다. */}
                {p.status === 'paid' && !p.fulfilledAt && <b style={{ color: 'var(--k-amber, #d98a00)' }}> · 미지급</b>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 문항 관리 (목록 · 이력 · 엑셀 업로드) ──────────────────────────
// ── 문항 급수(티어)→과목 필터 (CARIS ARENA ListTab 의 레벨→영역 패턴) — 목록·이력 공용 ──
function useTierSubjectFilter() {
  // 은행(급수)이 이미 상단에서 선택됨 → 급수 필터는 두지 않는다. 과목(실제 문항 과목)·난이도·유형·검색만.
  const [subject, setSubject] = useState('all')
  const [difficulty, setDifficulty] = useState<'all' | '상' | '중' | '하' | 'none'>('all')
  const [kind, setKind] = useState<'all' | 'mc' | 'short'>('all')
  const [q, setQ] = useState('')
  const matchTS = (subjectVal: string | null | undefined) => subject === 'all' || (subjectVal ?? '') === subject
  const matchDiff = (d: string | null | undefined) =>
    difficulty === 'all' || (difficulty === 'none' ? !d : d === difficulty)
  const matchKind = (k: string | null | undefined) => kind === 'all' || (k ?? 'mc') === kind
  const matchQ = (text: string) => { const qq = q.trim().toLowerCase(); return !qq || text.toLowerCase().includes(qq) }
  return { subject, setSubject, difficulty, setDifficulty, kind, setKind, q, setQ, matchTS, matchDiff, matchKind, matchQ }
}
type TierSubjectFilter = ReturnType<typeof useTierSubjectFilter>

// 과목 옵션은 실제 문항의 과목에서(subjects prop). 난이도·유형(mc/short)은 목록에서만(showDiff·showKind).
function TierSubjectBar({ f, count, loading, actions, subjects, showKind = true, showDiff = true }: { f: TierSubjectFilter; count: number; loading?: boolean; actions?: ReactNode; subjects: string[]; showKind?: boolean; showDiff?: boolean }) {
  return (
    <div className="admin-toolbar">
      <label>과목 <select value={f.subject} onChange={(e) => f.setSubject(e.target.value)}>
        <option value="all">전체 과목</option>
        {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
      </select></label>
      {showDiff && (
        <label>난이도 <select value={f.difficulty} onChange={(e) => f.setDifficulty(e.target.value as typeof f.difficulty)}>
          <option value="all">전체 난이도</option>
          <option value="상">상</option>
          <option value="중">중</option>
          <option value="하">하</option>
          <option value="none">미지정</option>
        </select></label>
      )}
      {showKind && (
        <label>유형 <select value={f.kind} onChange={(e) => f.setKind(e.target.value as 'all' | 'mc' | 'short')}>
          <option value="all">전체 유형</option>
          <option value="mc">객관식</option>
          <option value="short">주관식</option>
        </select></label>
      )}
      <input className="admin-search" placeholder="번호·지문 검색" value={f.q} onChange={(e) => f.setQ(e.target.value)} />
      {actions}
      <span className="admin-hint">{count}건{loading ? ' · 불러오는 중…' : ''}</span>
    </div>
  )
}

// ── CBT 엑셀 스마트 파싱 (CARIS ARENA import 기법 이식: 헤더 이름 자동인식 + 머리글 행 자동탐지) ──
function qNormKey(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[·.,/()[\]{}・:|~\-]/g, '').replace(/및/g, '')
}
const CBT_HEAD = {
  num: ['번호', 'no', '순번', '문항번호', '문번'],
  subject: ['과목', '영역', '분류', '카테고리', '과목명'],
  difficulty: ['난이도', '난도', '상중하', 'difficulty', 'level', '레벨'],
  prompt: ['지문', '문제', '문항', '질문', 'question'],
  answer: ['정답', '정답번호', 'answer', '정답인덱스'],
  kind: ['유형', '형식', '타입', 'type', '구분'],
  answerKey: ['모범답안', '답안', '채점기준', '모범', '기준'],
  simAnswer: ['유사정답', '허용답안', '유사답안', '동의어'],
  explanation: ['해설', '풀이', '설명', 'explanation', 'commentary'],
  option: ['보기', '선택지', 'option'],
}
function qFindCol(header: string[], aliases: string[]): number {
  const h = header.map(qNormKey)
  for (const a of aliases) { const i = h.indexOf(qNormKey(a)); if (i >= 0) return i }
  for (let i = 0; i < h.length; i++) if (h[i] && aliases.some((a) => h[i].includes(qNormKey(a)))) return i
  return -1
}

// 급수(티어) key → 그 급수의 정규 검정과목(가이드=getTracks 단일 출처). 미지정/미확정이면 빈 배열.
// 문항 목록 과목 드롭다운·업로드 과목 매핑이 "실제 문항"이 아니라 이 정규 과목을 기준으로 삼는다.
function tierSubjectsOf(tier?: string): string[] {
  if (!tier) return []
  return getTracks('ko').flatMap((tr) => tr.tiers).find((ti) => ti.key === tier)?.subjects ?? []
}
// 엑셀 과목 → 정규 과목 매핑(CARIS ARENA 카테고리 매핑 이식). qNormKey 정규화(소문자·공백/기호 제거) 후
// 정확일치를 우선하고, 없으면 Dice bigram 유사도로 최근접(≥0.5)을 자동 제안. 대소문자("AI"↔"ai")·
// 띄어쓰기·기호 차이는 정규화가 흡수하므로 그런 near-miss는 정확일치로 잡힌다.
function qBigrams(s: string): string[] {
  const t = qNormKey(s)
  if (t.length < 2) return t ? [t] : []
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}
function qSim(a: string, b: string): number {
  const A = qBigrams(a), B = qBigrams(b)
  if (!A.length || !B.length) return qNormKey(a) !== '' && qNormKey(a) === qNormKey(b) ? 1 : 0
  const cnt = new Map<string, number>()
  for (const x of B) cnt.set(x, (cnt.get(x) ?? 0) + 1)
  let inter = 0
  for (const x of A) { const c = cnt.get(x); if (c) { inter++; cnt.set(x, c - 1) } }
  return (2 * inter) / (A.length + B.length)
}
// 엑셀에 등장한 distinct 과목들 → 정규 과목 자동 매핑 제안(정확일치 없으면 유사도 최고 ≥0.5).
function suggestSubjectMap(excelSubjects: string[], guide: string[]): Record<string, string> {
  const m: Record<string, string> = {}
  if (!guide.length) return m
  for (const c of excelSubjects) {
    const exact = guide.find((g) => qNormKey(g) === qNormKey(c))
    if (exact) { m[c] = exact; continue }
    let best = { subj: '', score: 0 }
    for (const g of guide) { const s = qSim(c, g); if (s > best.score) best = { subj: g, score: s } }
    if (best.score >= 0.5) m[c] = best.subj
  }
  return m
}
// 엑셀 난이도 셀 → '상'|'중'|'하'(그 외/빈값은 '' = 미지정). 흔한 동의어도 수용.
function qNormDiff(v: unknown): '' | '상' | '중' | '하' {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return ''
  if (s === '상' || /상급|어려움|어렵|high|hard/.test(s)) return '상'
  if (s === '중' || /중급|보통|normal|mid|medium/.test(s)) return '중'
  if (s === '하' || /하급|쉬움|쉬운|low|easy/.test(s)) return '하'
  return ''
}
interface QColCfg { cNum: number; cSubject: number; cDifficulty: number; cPrompt: number; cOptions: number[]; cAnswer: number; cKind: number; cAnswerKey: number; cAnswerKeyExtra: number[]; cExplanation: number }
function qDetectColumns(header: string[], ncol: number): { cfg: QColCfg; hasHeader: boolean } {
  const h = header.map(qNormKey)
  const optCols = h.map((x, i) => ({ x, i })).filter((o) => CBT_HEAD.option.some((a) => o.x.includes(qNormKey(a)))).map((o) => o.i)
  const cNum = qFindCol(header, CBT_HEAD.num)
  const cSubject = qFindCol(header, CBT_HEAD.subject)
  const cDifficulty = qFindCol(header, CBT_HEAD.difficulty)
  const cPrompt = qFindCol(header, CBT_HEAD.prompt)
  const cAnswer = qFindCol(header, CBT_HEAD.answer)
  const cKind = qFindCol(header, CBT_HEAD.kind)
  const cAnswerKey = qFindCol(header, CBT_HEAD.answerKey)
  const cAnswerKeyExtra = h.map((x, i) => ({ x, i })).filter((o) => o.i !== cAnswerKey && CBT_HEAD.simAnswer.some((a) => o.x.includes(qNormKey(a)))).map((o) => o.i)
  const cExplanation = qFindCol(header, CBT_HEAD.explanation)
  const hasHeader = cPrompt >= 0 || cAnswer >= 0 || cSubject >= 0
  return {
    cfg: {
      cNum: cNum >= 0 ? cNum : 0,
      cSubject: cSubject >= 0 ? cSubject : 1,
      cDifficulty, // 난이도는 선택 컬럼 — 없으면 -1(미지정), 머리글 없는 파일에선 기본열 배정 안 함
      cPrompt: cPrompt >= 0 ? cPrompt : 2,
      cOptions: optCols.length ? optCols.slice(0, 4) : [3, 4, 5, 6].filter((c) => c < ncol),
      cAnswer: cAnswer >= 0 ? cAnswer : 7,
      cKind: cKind >= 0 ? cKind : 8,
      cAnswerKey: cAnswerKey >= 0 ? cAnswerKey : 9,
      cAnswerKeyExtra,
      cExplanation: cExplanation >= 0 ? cExplanation : 10,
    },
    hasHeader,
  }
}
function qRowHeaderScore(row: string[]): number {
  const cells = (row ?? []).map(qNormKey).filter(Boolean)
  const groups = [CBT_HEAD.prompt, CBT_HEAD.answer, CBT_HEAD.subject, CBT_HEAD.difficulty, CBT_HEAD.num, CBT_HEAD.kind, CBT_HEAD.option, CBT_HEAD.answerKey, CBT_HEAD.explanation]
  let hits = 0
  for (const g of groups) if (cells.some((c) => g.some((a) => c === qNormKey(a) || c.includes(qNormKey(a))))) hits++
  return hits
}
function qFindHeaderRow(aoa: string[][], maxScan = 15): { idx: number; score: number } {
  let best = { idx: 0, score: 0 }
  const lim = Math.min(maxScan, aoa.length)
  for (let i = 0; i < lim; i++) { const s = qRowHeaderScore(aoa[i]); if (s > best.score) best = { idx: i, score: s } }
  return best
}

// 목록 다운로드 — 서버에 다시 묻지 않고 "화면에 보이는 그대로"(과목·난이도·유형·검색 필터 적용분) 엑셀로.
// 열 구성은 업로드 템플릿(downloadTemplate)과 동일 + 상태(활성/비활성). 주관식이 섞였을 때만 모범답안 열 추가.
// ⚠️ 재업로드는 번호 upsert 가 아니라 은행 뒤에 이어붙이므로(questionsImport) 이 파일은 백업·검토용.
function qTodayKST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '') // YYYYMMDD
}
function exportCbtQuestionsXlsx(rows: AdminQuestionRow[], tier: string | undefined, subject: string) {
  const hasShort = rows.some((q) => q.kind === 'short')
  const header = [
    '번호', '과목', '난이도(상/중/하)', '지문', '보기1', '보기2', '보기3', '보기4', '정답(1~4)', '유형(객관식/주관식)',
    ...(hasShort ? ['모범답안(주관식)'] : []), '해설', '상태',
  ]
  const body = rows.map((q) => [
    q.number,
    q.subject,
    q.difficulty ?? '',
    q.prompt,
    ...Array.from({ length: 4 }, (_, i) => (q.kind === 'mc' ? q.choices?.[i] ?? '' : '')),
    q.kind === 'mc' && q.correct_index != null ? q.correct_index + 1 : '',
    q.kind === 'short' ? '주관식' : '객관식',
    ...(hasShort ? [q.answer_key ?? ''] : []), // 허용답안 여러 개는 줄바꿈으로 한 칸에(업로드 때와 같은 형태)
    q.explanation ?? '',
    q.active ? '활성' : '비활성',
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), '문항')
  const tierName = getTracks('ko').flatMap((tr) => tr.tiers).find((ti) => ti.key === tier)?.name ?? tier ?? '전체'
  const name = `CBT문항_${tierName}_${subject === 'all' ? '전체과목' : subject}_${qTodayKST()}.xlsx`
  XLSX.writeFile(wb, name.replace(/[\\/:*?"<>|]/g, '_'))
}

// 난이도(상/중/하) 배지 — 관리자 목록·미리보기 공용. 미지정은 흐린 '—'.
const DIFF_STYLE: Record<string, { bg: string; fg: string }> = {
  '상': { bg: 'rgba(212,58,58,.14)', fg: '#c0392b' },
  '중': { bg: 'rgba(214,158,46,.16)', fg: '#b7791f' },
  '하': { bg: 'rgba(56,161,105,.14)', fg: '#2f855a' },
}
function DiffTag({ value }: { value: string | null | undefined }) {
  if (!value || !DIFF_STYLE[value]) return <span style={{ color: 'var(--dim)' }}>—</span>
  const s = DIFF_STYLE[value]
  return <span style={{ background: s.bg, color: s.fg, padding: '2px 9px', borderRadius: 999, fontSize: 12.5, fontWeight: 700 }}>{value}</span>
}

// 문항 풀 현황 — 문항 관리 최상단 독립 섹션. 급수·검정과목은 /guide(getTracks) 단일 출처.
// 급수 탭 선택 → 그 급수의 과목(가이드 정의 전부, 0개=미출제도 노출) + 난이도별 문항 수를 얹어 보여줌.
// 급수→문제은행 매핑(bank.tier)으로 문항만 불러오고, 과목 목록 자체는 문항에서 뽑지 않는다.
function PoolOverview({ banks, tierKey, onTierKey, refreshKey }: { banks: QuestionBankItem[]; tierKey: string; onTierKey: (k: string) => void; refreshKey?: number }) {
  const tiers = getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => ({ track: tr.name, key: ti.key, name: ti.name, subjects: ti.subjects })))
  const [rows, setRows] = useState<AdminQuestionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0) // 수동 새로고침
  const [poolKind, setPoolKind] = useState<'mc' | 'short'>('mc') // 유형별 풀(주관식 있는 급수는 토글)

  const cur = tiers.find((t) => t.key === tierKey) ?? tiers[0]
  const bank = banks.find((b) => b.tier === tierKey)
  const bankId = bank?.id

  // 급수 변경·부모의 문항 변경(refreshKey)·수동 새로고침 때마다 재조회
  useEffect(() => {
    if (!bankId) { setRows([]); return }
    let alive = true
    setLoading(true)
    callFunction<AdminQuestionListResp>('admin', { action: 'questionList', bankId })
      .then((r) => { if (alive) setRows(r.rows) })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [bankId, refreshKey, reloadTick])

  // 기준 = 출제 배분표 × 3배수. 유형(mc/short)별로 따로 판정. 확보 = 활성 문항 수(해당 유형).
  const draw = TIER_DRAW_CELLS[tierKey]
  const hasShort = !!draw?.short
  const kind: 'mc' | 'short' = hasShort ? poolKind : 'mc'
  const matrix = draw ? (kind === 'short' ? draw.short : draw.mc) : null
  const kindLabel = kind === 'short' ? '주관식' : '객관식'
  const subjects = cur?.subjects ?? []
  const DIFFS: Array<'하' | '중' | '상'> = ['하', '중', '상']
  const got = (subj: string, diff: string) => rows.reduce((n, q) => n + (q.active && (q.kind ?? 'mc') === kind && q.subject === subj && q.difficulty === diff ? 1 : 0), 0)
  const unassigned = rows.reduce((n, q) => n + (q.active && (q.kind ?? 'mc') === kind && !q.difficulty ? 1 : 0), 0)
  let shortCells = 0
  const grid = subjects.map((subj, i) => {
    const cells = DIFFS.map((d, di) => {
      const g = got(subj, d)
      const need = (matrix?.[i]?.[di] ?? 0) * POOL_MULTIPLIER
      const ok = g >= need
      if (!ok) shortCells++
      return { d, g, need, ok }
    })
    const rowGot = cells.reduce((s, c) => s + c.g, 0)
    const rowNeed = cells.reduce((s, c) => s + c.need, 0)
    return { subj, cells, rowGot, rowNeed, met: cells.every((c) => c.ok) }
  })
  const totGot = grid.reduce((s, r) => s + r.rowGot, 0)
  const totNeed = grid.reduce((s, r) => s + r.rowNeed, 0)
  const sumDiff = (d: string, k: 'g' | 'need') => grid.reduce((s, r) => s + (r.cells.find((c) => c.d === d)?.[k] ?? 0), 0)

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div className="admin-sub" style={{ marginTop: 0 }}>문항 풀 현황 <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>출제 배분표 × 3배수 대비 확보(활성) · 셀 = 확보/목표</span></div>
        <button className="admin-mini" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>{loading ? '불러오는 중…' : '새로고침'}</button>
      </div>
      <div className="admin-tabs" style={{ marginBottom: hasShort ? 8 : 14, flexWrap: 'wrap' }}>
        {tiers.map((t) => (
          <button key={t.key} className={t.key === tierKey ? 'on' : ''} onClick={() => onTierKey(t.key)}>
            {t.name}
          </button>
        ))}
      </div>
      {hasShort && (
        <div className="admin-tabs" style={{ marginBottom: 14 }}>
          <button className={kind === 'mc' ? 'on' : ''} onClick={() => setPoolKind('mc')}>객관식</button>
          <button className={kind === 'short' ? 'on' : ''} onClick={() => setPoolKind('short')}>주관식</button>
        </div>
      )}
      {!bank && <div className="admin-warn">이 급수의 문제은행이 아직 없습니다 — 확보 0으로 표시됩니다.</div>}
      {!draw ? (
        <div className="admin-section admin-empty">이 급수는 출제 기준(문제은행 구축)이 아직 미확정입니다.</div>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            {shortCells === 0
              ? <span className="badge ok">{kindLabel} 기준 충족 — 전 과목·난이도 제출 완료 ({totGot}/{totNeed})</span>
              : <span className="badge low">{kindLabel} 미달 — {shortCells}개 칸 부족 · 확보 {totGot}/{totNeed}</span>}
          </div>
          {unassigned > 0 && <div className="admin-warn">{kindLabel} 난이도 미지정 활성 {unassigned}개 — 상/중/하로 분류해야 기준에 반영됩니다.</div>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>과목</th><th>하</th><th>중</th><th>상</th><th>합계</th><th>상태</th></tr>
              </thead>
              <tbody>
                {grid.map((r) => (
                  <tr key={r.subj} className={r.met ? '' : 'prob'}>
                    <td>{r.subj}</td>
                    {r.cells.map((c) => (
                      <td key={c.d} style={{ whiteSpace: 'nowrap', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.ok ? '#2f855a' : '#c0392b' }}>
                        {c.g}/{c.need}{c.ok ? ' ✓' : ''}
                      </td>
                    ))}
                    <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.rowGot}/{r.rowNeed}</td>
                    <td>{r.met ? <span className="badge ok">충족</span> : <span className="badge low">미달</span>}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800 }}>
                  <td>합계</td>
                  {DIFFS.map((d) => {
                    const g = sumDiff(d, 'g'), need = sumDiff(d, 'need')
                    return <td key={d} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: g >= need ? '#2f855a' : '#c0392b' }}>{g}/{need}</td>
                  })}
                  <td style={{ whiteSpace: 'nowrap' }}>{totGot}/{totNeed}</td>
                  <td style={{ color: 'var(--muted)', fontWeight: 400 }}>{loading ? '불러오는 중…' : ''}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// 2층: 문항 목록/이력/업로드 = 급수별 문제은행(bank), 시험문항 = 등록시험(회차×급수)의 뽑힌 세트.
// isRoot = 서버('admin' me 액션)가 판정한 루트 관리자 여부. 문항 엑셀 다운로드는 루트 전용이라 목록까지 내려보낸다.
function QuestionsAdmin({ isRoot }: { isRoot: boolean }) {
  const [banks, setBanks] = useState<QuestionBankItem[]>([])
  const [tierKey, setTierKey] = useState<string>(() => getTracks('ko').flatMap((tr) => tr.tiers)[0]?.key ?? '') // 단일 급수 선택 — 풀 현황·문항 목록·이력·업로드 공용
  const [exams, setExams] = useState<AdminExamItem[]>([])
  const [examId, setExamId] = useState<string>('')
  const [view, setView] = useState<'list' | 'events' | 'examset' | 'import'>('list')
  const [tick, setTick] = useState(0) // 문항 변경(추가·수정·삭제·업로드) 시 증가 → 풀 매트릭스 갱신 신호

  const load = useCallback(async () => {
    try {
      const [b, e] = await Promise.all([
        callFunction<AdminBankListResp>('admin', { action: 'bankListForAdmin' }),
        callFunction<AdminExamListResp>('admin', { action: 'examListForAdmin' }),
      ])
      setBanks([...b.banks].sort((x, y) => tierRank(x.tier) - tierRank(y.tier)))
      setExams([...e.exams].sort((x, y) => tierRank(x.tier) - tierRank(y.tier)))
    } catch {
      /* 무시 */
    }
  }, [])
  // 문항 변경 시: 은행 카운트 새로고침 + 풀 매트릭스 재조회 신호
  const bump = useCallback(() => { load(); setTick((t) => t + 1) }, [load])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    setExamId((c) => (exams.some((e) => e.id === c) ? c : exams[0]?.id ?? ''))
  }, [exams])

  const isSet = view === 'examset'
  const bank = banks.find((b) => b.tier === tierKey)
  const bankId = bank?.id ?? ''
  const curBankTier = bank?.tier // 선택된 은행의 급수 → 정규 과목 기준
  return (
    <>
      <div className="admin-head">
        <h1>문항 관리</h1>
      </div>

      <PoolOverview banks={banks} tierKey={tierKey} onTierKey={setTierKey} refreshKey={tick} />

      {isSet && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>등록시험</span>
          <select style={{ minWidth: 220 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
            {exams.length === 0 && <option value="">등록시험 없음</option>}
            {exams.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.title} ({ex.questionCount})</option>
            ))}
          </select>
        </div>
      )}

      <div className="admin-tabs" style={{ marginBottom: 16 }}>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>문항 목록</button>
        <button className={view === 'events' ? 'on' : ''} onClick={() => setView('events')}>문항 이력</button>
        <button className={view === 'examset' ? 'on' : ''} onClick={() => setView('examset')}>시험문항</button>
        <button className={view === 'import' ? 'on' : ''} onClick={() => setView('import')}>엑셀 업로드</button>
      </div>

      {isSet ? (
        !examId ? (
          <div className="admin-section admin-empty">등록시험이 없습니다. <b>시험등록</b> 탭에서 회차에 급수를 추가하세요.</div>
        ) : (
          <ExamSetView examId={examId} exams={exams} onChanged={bump} />
        )
      ) : !bankId ? (
        <div className="admin-section admin-empty">문제은행이 없습니다.</div>
      ) : view === 'list' ? (
        <QuestionListView bankId={bankId} tier={curBankTier} onChanged={bump} isRoot={isRoot} />
      ) : view === 'events' ? (
        <QuestionEventsView bankId={bankId} onChanged={bump} />
      ) : (
        <QuestionImportView bankId={bankId} tier={curBankTier} onImported={bump} />
      )}
    </>
  )
}

// 시험문항 — 등록시험(회차×급수)이 자기 급수 은행에서 뽑아 저장한 세트. 추출/재추출.
function ExamSetView({ examId, exams, onChanged }: { examId: string; exams: AdminExamItem[]; onChanged: () => void }) {
  const [rows, setRows] = useState<ExamSetRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const ex = exams.find((e) => e.id === examId)
  const spec = ex?.tier ? TIER_EXAM_SPEC[ex.tier] : undefined

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await callFunction<AdminExamSetResp>('admin', { action: 'examSetList', examId })
      setRows(r.rows)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [examId])
  useEffect(() => {
    load()
  }, [load])

  async function draw(replace: boolean) {
    if (!spec || spec.mc + spec.short === 0) {
      alert('이 급수는 아직 시험 구성이 정의되지 않았습니다.')
      return
    }
    // 과목×난이도 배분표(3:4:3) — getTracks 과목 순서 그대로. 서버가 이 표대로 (과목·난이도·유형) 버킷에서 뽑는다.
    const tierSubjects = getTracks('ko').flatMap((tr) => tr.tiers).find((ti) => ti.key === ex?.tier)?.subjects ?? []
    const cells = ex?.tier ? buildDrawCells(ex.tier, tierSubjects) : null
    setBusy(true)
    try {
      await callFunction('admin', { action: 'examDraw', examId, mc: spec.mc, short: spec.short, cells, replace })
      await load()
      onChanged()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '추출 실패'
      if (/응시 기록/.test(msg) && !replace) {
        setBusy(false)
        if (confirm('이미 응시 기록이 있습니다. 다시 뽑으면 기존 세트가 교체됩니다. 계속할까요?')) return draw(true)
        return
      }
      alert(msg)
    } finally {
      setBusy(false)
    }
  }

  const mcN = rows.filter((r) => r.kind === 'mc').length
  const shN = rows.filter((r) => r.kind === 'short').length
  return (
    <>
      <div className="admin-head" style={{ marginTop: 0 }}>
        <span className="admin-count">
          세트 {rows.length}문항{rows.length ? ` (객 ${mcN} · 주 ${shN})` : ''}
          {spec ? <span style={{ color: 'var(--muted)', marginLeft: 8 }}>· 구성 객 {spec.mc} + 주 {spec.short}</span> : null}
        </span>
        <div className="admin-head-actions">
          <button className="grade-btn ok active" disabled={busy} onClick={() => draw(false)}>
            {busy ? '추출 중…' : rows.length ? '다시 추출' : '문항 추출'}
          </button>
          <button
            className="admin-mini"
            disabled={!rows.length}
            title={rows.length ? '등록된 문항을 실제 응시 화면으로 검수' : '먼저 문항을 추출하세요'}
            onClick={() => window.open(`/exam/run/preview?examId=${examId}`, '_blank', 'noopener')}
          >
            시험화면 미리보기
          </button>
          <button className="admin-mini" onClick={load} disabled={loading}>새로고침</button>
        </div>
      </div>
      <p className="admin-hint" style={{ marginBottom: 10 }}>
        이 등록시험의 급수 <b>문제은행</b>에서 구성(객 {spec?.mc ?? 0} + 주 {spec?.short ?? 0})만큼 랜덤 추출해 저장합니다.
        추출 후 <b>시험화면 미리보기</b>로 실제 응시 화면 그대로(정답·해설 비노출·SEB 불필요) 검수할 수 있습니다.
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>#</th><th>유형</th><th>과목</th><th>난이도</th><th>지문</th><th>은행번호</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.questionId} style={{ opacity: r.active ? 1 : 0.5 }}>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.number}</td>
                <td><span className={`admin-badge st-${r.kind === 'short' ? 'short' : 'submitted'}`}>{r.kind === 'short' ? '주관식' : '객관식'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.subject}</td>
                <td style={{ whiteSpace: 'nowrap' }}><DiffTag value={r.difficulty} /></td>
                <td style={{ maxWidth: 360, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.prompt}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{r.bankNumber ?? '-'}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>아직 추출된 문항이 없습니다. “문항 추출”을 누르세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function QuestionListView({ bankId, tier, onChanged, isRoot }: { bankId: string; tier?: string; onChanged: () => void; isRoot: boolean }) {
  const [rows, setRows] = useState<AdminQuestionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<AdminQuestionRow | 'new' | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set()) // 체크박스 선택(엑셀 다운로드 대상)
  const [page, setPage] = useState(0) // 클라 페이징(아래 PER) — 검색·필터는 전체 기준 그대로다

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const r = await callFunction<AdminQuestionListResp>('admin', { action: 'questionList', bankId })
      setRows(r.rows)
      setSel(new Set())
    } catch (e) {
      setErr(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [bankId])
  useEffect(() => {
    load()
  }, [load])

  async function act(action: string, id: string, extra?: object) {
    setBusy(true)
    try {
      await callFunction('admin', { action, id, ...extra })
      await load()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 실패')
    } finally {
      setBusy(false)
    }
  }

  const nextNumber = rows.reduce((m, q) => Math.max(m, q.number), 0) + 1
  const f = useTierSubjectFilter()
  // 과목 옵션 = 이 급수의 정규 과목(가이드) 먼저 + 실제 문항에만 있는 비정규 과목(교정 필요분)을 뒤에.
  // 이렇게 해야 아직 업로드 전인 PRO·ELITE 도 정해진 과목이 그대로 뜨고(비어있지 않음),
  // 정규명과 어긋난 과목도 함께 보여 교정 대상을 드러낸다.
  const guideSubjects = tierSubjectsOf(tier)
  const extraSubjects = [...new Set(rows.map((r) => r.subject).filter(Boolean))].filter((s) => !guideSubjects.includes(s)).sort()
  const subjects = [...guideSubjects, ...extraSubjects]
  const filtered = rows.filter((q) => f.matchTS(q.subject) && f.matchDiff(q.difficulty) && f.matchKind(q.kind) && f.matchQ(`${q.number} ${q.subject} ${q.prompt}`))

  // ⚠️ 페이징은 **클라이언트 전용**이다 — 검색·필터·전체선택·다운로드는 전부 `filtered`(전체) 기준으로 돌고,
  //    `shown` 은 화면에 그릴 줄만 잘라낸 것이다. 서버 페이징으로 바꾸면 검색이 현재 페이지만 뒤지게 되니 주의.
  //    (회원 탭과 같은 패턴. 서버는 questionList 가 은행 문항을 한 번에 내려준다 — .limit(2000) 상한 있음)
  const PER = 50
  const pageMax = Math.max(1, Math.ceil(filtered.length / PER))
  const pageSafe = Math.min(page, pageMax - 1) // 필터가 좁아져 페이지 수가 줄면 빈 화면이 되는 걸 막는다
  const shown = filtered.slice(pageSafe * PER, pageSafe * PER + PER)

  // 다운로드는 체크한 문항만. 화면 필터가 바뀌어 안 보이게 된 선택은 대상에서 빠진다(보이는 것만 받는다).
  const selRows = filtered.filter((q) => sel.has(q.id))
  const allChecked = filtered.length > 0 && selRows.length === filtered.length
  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSel((s) => {
      const n = new Set(s)
      if (allChecked) filtered.forEach((q) => n.delete(q.id))
      else filtered.forEach((q) => n.add(q.id))
      return n
    })
  }

  return (
    <>
      <div className="admin-head" style={{ marginTop: 0 }}>
        <span className="admin-count">{filtered.length} / {rows.length}문항{isRoot && selRows.length ? ` · ${selRows.length}개 선택됨` : ''}</span>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={() => setEdit('new')}>+ 문항 추가</button>
          {/* 문항 반출은 루트 관리자 전용 — 일반 관리자에겐 체크박스 열도 버튼도 없다. */}
          {isRoot && (
            <button
              className="admin-mini"
              disabled={!selRows.length}
              title={selRows.length ? '' : '다운로드할 문항을 체크하세요(머리글 체크박스 = 전체 선택)'}
              onClick={() => exportCbtQuestionsXlsx(selRows, tier, f.subject)}
            >
              엑셀 다운로드{selRows.length ? ` (${selRows.length})` : ''}
            </button>
          )}
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      <TierSubjectBar f={f} count={filtered.length} loading={loading} subjects={subjects} />
      {err && <div className="admin-section admin-empty">불러오기 실패 — {err}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {isRoot && <th style={{ width: 34 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="전체 선택" /></th>}
              <th>#</th>
              <th>유형</th>
              <th>과목</th>
              <th>난이도</th>
              <th>지문</th>
              <th>정답</th>
              <th>상태</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((q) => (
              <tr key={q.id} style={{ opacity: q.active ? 1 : 0.55 }}>
                {isRoot && <td><input type="checkbox" checked={sel.has(q.id)} onChange={() => toggle(q.id)} /></td>}
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{q.number}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`admin-badge st-${q.kind === 'short' ? 'short' : 'submitted'}`}>{q.kind === 'short' ? '주관식' : '객관식'}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <b>{q.subject}</b>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}><DiffTag value={q.difficulty} /></td>
                <td style={{ maxWidth: 340, whiteSpace: 'normal', wordBreak: 'break-word' }}>{q.prompt}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{q.kind === 'short' ? <span style={{ color: 'var(--muted)' }}>검수 채점</span> : `${(q.correct_index ?? 0) + 1}번`}</td>
                <td>
                  <span className={`admin-badge st-${q.active ? 'submitted' : 'voided'}`}>{q.active ? '활성' : '비활성'}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="admin-mini" disabled={busy} onClick={() => setEdit(q)}>수정</button>
                  <button className="admin-mini" style={{ marginLeft: 6 }} disabled={busy} onClick={() => act('questionSetActive', q.id, { active: !q.active })}>
                    {q.active ? '비활성' : '활성'}
                  </button>
                  <button
                    className="admin-mini"
                    style={{ marginLeft: 6 }}
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`${q.number}번 문항을 삭제할까요? (이력에서 복구 가능)`)) act('questionDelete', q.id)
                    }}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {!filtered.length && !loading && (
              <tr>
                <td colSpan={isRoot ? 9 : 8} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {rows.length ? '이 급수·과목에 해당하는 문항이 없습니다.' : '문항이 없습니다. “+ 문항 추가” 또는 “엑셀 업로드”로 추가하세요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageMax > 1 && (
        <div className="admin-pager">
          {/* ⚠️ page 가 아니라 pageSafe 기준으로 움직인다 — 필터를 좁혀 페이지 수가 줄면 page 는 범위 밖에 남아
              있는데, 그 값으로 +1 하면 화면은 그대로인 채 버튼만 눌리는 것처럼 보인다. */}
          <button className="admin-mini" disabled={pageSafe === 0} onClick={() => setPage(Math.max(0, pageSafe - 1))}>‹ 이전</button>
          <span>{pageSafe + 1} / {pageMax}</span>
          <button className="admin-mini" disabled={pageSafe + 1 >= pageMax} onClick={() => setPage(pageSafe + 1)}>다음 ›</button>
        </div>
      )}

      {edit && (
        <QuestionEditModal
          bankId={bankId}
          tier={tier}
          row={edit === 'new' ? null : edit}
          defaultNumber={nextNumber}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); load(); onChanged() }}
        />
      )}
    </>
  )
}

// 문항 편집 폼 인라인 스타일(전역 .admin label 규칙에 밀리지 않도록 div+인라인으로 고정)
const QE: Record<string, CSSProperties> = {
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, textAlign: 'left', minWidth: 0 },
  lab: { fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--muted)' },
}

// 개별 문항 추가/편집 — 유형(객관식/주관식) 선택 → 객관식은 보기4·정답, 주관식은 모범답안.
function QuestionEditModal({ bankId, tier, row, defaultNumber, onClose, onSaved }: {
  bankId: string; tier?: string; row: AdminQuestionRow | null; defaultNumber: number; onClose: () => void; onSaved: () => void
}) {
  const [number] = useState<number>(row?.number ?? defaultNumber) // 자동 부여(수정 불가)
  const [kind, setKind] = useState<'mc' | 'short'>(row?.kind ?? 'mc')
  // /guide 급수(티어) → 과목 종속 드롭박스. 티어 목록은 getTracks(=/guide) 단일 출처.
  const tiers = getTracks('ko').flatMap((tr) => tr.tiers.map((ti) => ({ track: tr.name, key: ti.key, name: ti.name, subjects: ti.subjects })))
  // 기본 급수: 기존 문항이면 그 과목이 속한 급수, 신규면 지금 보고 있는 은행의 급수(tier). 둘 다 없으면 첫 급수.
  const [tierKey, setTierKey] = useState(
    (row?.subject ? tiers.find((t) => t.subjects.includes(row.subject)) : undefined)?.key ?? tier ?? tiers[0]?.key ?? '',
  )
  const curTier = tiers.find((t) => t.key === tierKey) ?? tiers[0]
  const allowShort = (TIER_EXAM_SPEC[tierKey]?.short ?? 0) > 0 // 주관식은 출제 스펙에 short 있는 급수(현재 elite)만
  const [subject, setSubject] = useState(row?.subject ?? curTier?.subjects[0] ?? '')
  const baseSubjects = curTier?.subjects ?? []
  // 편집 중 기존 과목이 현재 급수 목록에 없으면(레거시 자유입력) 옵션에 그대로 유지
  const subjectOptions = subject && !baseSubjects.includes(subject) ? [subject, ...baseSubjects] : baseSubjects
  // 난이도(과목 하위분류·관리자 전용). 신규는 '중' 기본, 기존 미지정(null)은 '' 유지(무심코 값 부여 방지).
  const [difficulty, setDifficulty] = useState<'' | '상' | '중' | '하'>(row ? row.difficulty ?? '' : '중')
  const [prompt, setPrompt] = useState(row?.prompt ?? '')
  const [choices, setChoices] = useState<string[]>(() => {
    const c = row?.choices ?? []
    return [c[0] ?? '', c[1] ?? '', c[2] ?? '', c[3] ?? '']
  })
  const [correctIndex, setCorrectIndex] = useState<number>(row?.correct_index ?? 0)
  const [answerKey, setAnswerKey] = useState(row?.answer_key ?? '')
  const [explanation, setExplanation] = useState(row?.explanation ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // 임시저장 — 문제·보기 4개·해설을 다 쓴 뒤 날리면 되돌릴 방법이 없다.
  const draft = useDraft({
    kind: 'cbt-question',
    refId: row?.id,
    value: { kind, tierKey, subject, difficulty, prompt, choices, correctIndex, answerKey, explanation },
    title: prompt.trim().slice(0, 40) || (row ? `${row.number}번 문항` : '새 문항'),
  })

  async function save() {
    setErr('')
    setSaving(true)
    try {
      await callFunction('admin', {
        action: 'questionUpsert',
        question: { id: row?.id, bankId, number, kind, subject, difficulty, prompt, choices, correctIndex, answerKey, explanation, active: row ? row.active : true },
      })
      draft.clear()
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장 실패')
      setSaving(false)
    }
  }

  return (
    <div className="admin-modal-bg">
    {/* ⚠️ 바깥을 눌러도 닫지 않는다 — 입력하던 내용이 통째로 날아간다(닫기는 ✕·취소 버튼으로). */}
      <div className="admin-modal" style={{ textAlign: 'left' }} onClick={(e) => e.stopPropagation()}>
        <button className="admin-modal-x" onClick={onClose}>✕</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{row ? `${row.number}번 문항 수정` : '문항 추가'}</h2>
          <DraftBar
            status={draft.status}
            savedAt={draft.savedAt}
            drafts={draft.drafts}
            onRefresh={draft.refresh}
            onRestore={(p: {
              kind: 'mc' | 'short'; tierKey: string; subject: string
              difficulty: '' | '상' | '중' | '하'; prompt: string; choices: string[]
              correctIndex: number; answerKey: string; explanation: string
            }) => {
              setKind(p.kind); setTierKey(p.tierKey); setSubject(p.subject)
              setDifficulty(p.difficulty); setPrompt(p.prompt); setChoices(p.choices)
              setCorrectIndex(p.correctIndex); setAnswerKey(p.answerKey); setExplanation(p.explanation)
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12, textAlign: 'left' }}>
          <div style={QE.row}>
            <div style={{ ...QE.field, width: 110, flex: 'none' }}>
              <span style={QE.lab}>번호</span>
              <input className="admin-in" value={number} readOnly disabled title="번호는 자동 부여됩니다" style={{ opacity: 0.6, cursor: 'not-allowed' }} />
            </div>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>유형{!allowShort && kind !== 'short' && <span style={{ color: 'var(--dim)', fontWeight: 400 }}> (이 급수는 객관식만)</span>}</span>
              <select className="admin-in" value={kind} onChange={(e) => setKind(e.target.value as 'mc' | 'short')}>
                <option value="mc">객관식</option>
                {(allowShort || kind === 'short') && <option value="short">주관식</option>}
              </select>
            </div>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>난이도 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(응시자 비노출)</span></span>
              <select className="admin-in" value={difficulty} onChange={(e) => setDifficulty(e.target.value as '' | '상' | '중' | '하')}>
                <option value="">미지정</option>
                <option value="상">상</option>
                <option value="중">중</option>
                <option value="하">하</option>
              </select>
            </div>
          </div>
          <div style={QE.row}>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>급수 <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(/guide)</span></span>
              <select
                className="admin-in"
                value={tierKey}
                onChange={(e) => {
                  const k = e.target.value
                  setTierKey(k)
                  const t = tiers.find((x) => x.key === k)
                  if (t) setSubject(t.subjects[0] ?? '')
                  if ((TIER_EXAM_SPEC[k]?.short ?? 0) === 0) setKind('mc') // 주관식 없는 급수로 바꾸면 유형 강제 객관식
                }}
              >
                {tiers.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
            </div>
            <div style={{ ...QE.field, flex: 1 }}>
              <span style={QE.lab}>과목</span>
              <select className="admin-in" value={subject} onChange={(e) => setSubject(e.target.value)}>
                {!subject && <option value="">과목 선택</option>}
                {subjectOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={QE.field}>
            <span style={QE.lab}>지문</span>
            <textarea className="admin-ta" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="문항 지문" />
          </div>

          {kind === 'mc' ? (
            <div style={QE.field}>
              <span style={QE.lab}>보기 · 정답 선택</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {choices.map((c, i) => (
                  <div key={i} className={`qedit-choice ${correctIndex === i ? 'correct' : ''}`}>
                    <input type="radio" name="correct" checked={correctIndex === i} onChange={() => setCorrectIndex(i)} title="정답" />
                    <span className="qedit-choice-no">{i + 1}</span>
                    <input className="admin-in" style={{ flex: 1 }} value={c} onChange={(e) => setChoices((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`보기 ${i + 1}`} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={QE.field}>
              <span style={QE.lab}>정답 · 허용답안 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(한 줄에 하나 · 유사정답 포함 · 대소문자·띄어쓰기 자동 무시 · 응시자 비노출)</span></span>
              <textarea className="admin-ta" rows={4} value={answerKey} onChange={(e) => setAnswerKey(e.target.value)} placeholder={'엣지 컴퓨팅\nedge computing\nedgecomputing'} />
              {kind === 'short' && !answerKey.trim() && <span style={{ fontSize: 12, color: 'var(--muted)' }}>비우면 자동채점되지 않고 관리자 수동검수로 넘어갑니다.</span>}
            </div>
          )}

          {/* 해설 — 객관식/주관식 공통. 응시·결과 화면 어디에도 노출되지 않는 관리자 전용 필드. */}
          <div style={QE.field}>
            <span style={QE.lab}>해설 <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(선택 · 정답 풀이 · 응시자·결과 비노출)</span></span>
            <textarea className="admin-ta" rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="정답 풀이·근거·출제 의도 등" />
          </div>
        </div>

        {err && <p className="admin-warn" style={{ marginTop: 12 }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="admin-mini" onClick={onClose} disabled={saving}>취소</button>
          <button className="grade-btn ok active" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

const CBT_EVENT_LABEL: Record<string, string> = {
  import: '가져오기',
  edit: '수정',
  activate: '활성화',
  deactivate: '비활성화',
  delete: '삭제',
  restore: '복구',
}

function QuestionEventsView({ bankId, onChanged }: { bankId: string; onChanged: () => void }) {
  const [events, setEvents] = useState<AdminQuestionEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await callFunction<AdminQuestionEventsResp>('admin', { action: 'questionEvents', bankId })
      setEvents(r.events)
    } catch {
      /* 무시 */
    } finally {
      setLoading(false)
    }
  }, [bankId])
  useEffect(() => {
    load()
  }, [load])

  async function restore(id: string) {
    setBusy(true)
    try {
      await callFunction('admin', { action: 'questionRestore', id })
      await load()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : '복구 실패')
    } finally {
      setBusy(false)
    }
  }

  const f = useTierSubjectFilter()
  const subjects = [...new Set(events.map((e) => e.subject ?? '').filter(Boolean))].sort()
  const filtered = events.filter((e) => f.matchTS(e.subject) && f.matchQ(`${e.number ?? ''} ${e.subject ?? ''} ${CBT_EVENT_LABEL[e.action] ?? e.action}`))

  return (
    <>
      <div className="admin-head" style={{ marginTop: 0 }}>
        <span className="admin-count">{filtered.length} / {events.length}건</span>
        <div className="admin-head-actions">
          <button className="admin-mini" onClick={load} disabled={loading}>
            새로고침
          </button>
        </div>
      </div>
      <TierSubjectBar f={f} count={filtered.length} loading={loading} subjects={subjects} showKind={false} showDiff={false} />
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>일시</th>
              <th>작업</th>
              <th>문항</th>
              <th>과목</th>
              <th>담당</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDT(e.created_at)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {CBT_EVENT_LABEL[e.action] ?? e.action}
                  {e.action === 'import' && e.detail ? ` (${(e.detail as { count?: number }).count ?? ''})` : ''}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{e.number != null ? `${e.number}번` : '-'}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{e.subject || '-'}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{e.actor ?? '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {e.restorable && e.question_id ? (
                    <button className="admin-mini" disabled={busy} onClick={() => restore(e.question_id as string)}>
                      복구
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!filtered.length && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--muted)' }}>
                  {events.length ? '이 급수·과목에 해당하는 이력이 없습니다.' : '변경 이력이 없습니다.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function QuestionImportView({ bankId, tier, onImported }: { bankId: string; tier?: string; onImported: () => void }) {
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<QuestionImportRow[]>([])
  const [subjMap, setSubjMap] = useState<Record<string, string>>({}) // 엑셀 과목 → 정규 과목 매핑
  const [parseErr, setParseErr] = useState('')
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')

  const guideSubjects = tierSubjectsOf(tier) // 이 은행 급수의 정규 검정과목(가이드)
  // 엑셀에 등장한 distinct 과목, 그리고 매핑을 적용한 최종 행(정규 과목명으로 치환). 매핑 없으면 원문 유지.
  const distinctSubjects = [...new Set(rows.map((r) => r.subject).filter(Boolean))]
  const mappedRows = rows.map((r) => ({ ...r, subject: subjMap[r.subject] || r.subject }))
  const unmappedSubjects = guideSubjects.length ? distinctSubjects.filter((s) => !subjMap[s]) : []

  function parseCorrect(v: unknown, choices: string[]): number {
    const s = String(v ?? '').trim()
    const n = Number(s)
    if (Number.isFinite(n) && n >= 1 && n <= 4) return n - 1
    const idx = choices.findIndex((c) => c && c === s)
    return idx // 못 찾으면 -1
  }

  function handleFile(file: File) {
    setFileName(file.name)
    setMsg('')
    setParseErr('')
    setRows([])
    setSubjMap({})
    const r = new FileReader()
    r.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils
          .sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false })
          .filter((row) => row.some((c) => String(c).trim() !== ''))
        if (!aoa.length) { setParseErr('빈 시트입니다.'); return }
        // 머리글 행 자동 탐지 → 열 이름 자동 인식(순서 달라도·위에 안내줄 있어도 대응, CARIS ARENA와 동일 기법)
        const ncol = Math.max(...aoa.map((row) => row.length))
        const hdr = qFindHeaderRow(aoa)
        const header = aoa[hdr.idx] ?? []
        const { cfg, hasHeader } = qDetectColumns(header, ncol)
        const dataRows = aoa.slice(hasHeader ? hdr.idx + 1 : 0)
        if (!dataRows.length) { setParseErr('데이터 행이 없습니다.'); return }
        const cell = (row: string[], i: number) => String(row[i] ?? '').trim()
        const out: QuestionImportRow[] = dataRows.map((row, i) => {
          const choices = cfg.cOptions.map((c) => cell(row, c))
          while (choices.length < 4) choices.push('')
          const four = choices.slice(0, 4)
          const kind: 'mc' | 'short' = /주관식|short/i.test(cell(row, cfg.cKind)) ? 'short' : 'mc'
          const difficulty = qNormDiff(cfg.cDifficulty >= 0 ? cell(row, cfg.cDifficulty) : '')
          return {
            number: Math.floor(Number(cell(row, cfg.cNum))) || i + 1,
            subject: cell(row, cfg.cSubject),
            difficulty: difficulty || undefined, // 난이도 — 선택(상/중/하 아니면 미지정)
            prompt: cell(row, cfg.cPrompt),
            kind,
            choices: four,
            correctIndex: kind === 'short' ? -1 : parseCorrect(row[cfg.cAnswer], four),
            answerKey: kind === 'short' ? [cell(row, cfg.cAnswerKey), ...cfg.cAnswerKeyExtra.map((c) => cell(row, c))].filter(Boolean).join('\n') : undefined,
            explanation: cell(row, cfg.cExplanation) || undefined, // 해설 — 유형 무관 선택 입력
          }
        })
        setRows(out)
        // 엑셀 과목 → 이 급수의 정규 과목 자동 매핑 제안(정규화 정확일치 + 퍼지). 관리자가 확인/수정.
        const gs = tierSubjectsOf(tier)
        const distinct = [...new Set(out.map((o) => o.subject).filter(Boolean))]
        setSubjMap(suggestSubjectMap(distinct, gs))
      } catch (err) {
        setParseErr(err instanceof Error ? err.message : '엑셀을 읽지 못했습니다.')
      }
    }
    r.readAsArrayBuffer(file)
  }

  function downloadTemplate() {
    const hasShort = (TIER_EXAM_SPEC[tier ?? '']?.short ?? 0) > 0
    const base = ['번호', '과목', '난이도(상/중/하)', '지문', '보기1', '보기2', '보기3', '보기4', '정답(1~4)', '유형(객관식/주관식)']
    const mcHead = [1, 'AI 리터러시', '중', '다음 중 옳은 것은?', '보기 A', '보기 B', '보기 C', '보기 D', 2, '객관식']
    const header = hasShort
      ? [...base, '모범답안(주관식)', '유사정답1', '유사정답2', '유사정답3', '유사정답4', '유사정답5', '해설']
      : [...base, '해설']
    const rows: (string | number)[][] = hasShort
      ? [
          [...mcHead, '', '', '', '', '', '', '2번이 정답인 이유: …(응시자에게 노출되지 않음)'],
          [2, '피지컬 AI 및 데이터 처리', '중', '데이터를 발생 지점 근처에서 처리하는 방식을 무엇이라 하는가?', '', '', '', '', '', '주관식', '엣지 컴퓨팅', 'edge computing', 'edgecomputing', '엣지컴퓨팅', '', '', '대소문자·띄어쓰기 차이는 자동 무시 · 허용답안은 여러 개 입력'],
        ]
      : [
          [...mcHead, '2번이 정답인 이유: …(응시자에게 노출되지 않음)'],
          [2, 'AI 리터러시', '하', '다음 중 옳지 않은 것은?', '보기 A', '보기 B', '보기 C', '보기 D', 3, '객관식', ''],
        ]
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '문항')
    XLSX.writeFile(wb, 'cbt_문항_템플릿.xlsx')
  }

  // 검증·미리보기·반영은 매핑을 적용한 mappedRows 기준(정규 과목명으로 치환된 상태).
  const problems = mappedRows
    .map((r, i) => {
      if (!r.subject || !r.prompt) return `${i + 2}행: 과목/지문 비어있음`
      if (r.kind === 'short') return (TIER_EXAM_SPEC[tier ?? '']?.short ?? 0) > 0 ? '' : `${i + 2}행(번호 ${r.number}): 이 급수는 주관식이 없습니다 — 유형을 객관식으로 바꾸세요`
      if (r.choices.length !== 4 || r.choices.some((c) => !c)) return `${i + 2}행(번호 ${r.number}): 보기 4개 필요`
      if (r.correctIndex < 0 || r.correctIndex > 3) return `${i + 2}행(번호 ${r.number}): 정답(1~4) 확인`
      return ''
    })
    .filter(Boolean)

  async function doImport() {
    if (!mappedRows.length) return
    if (problems.length) {
      setMsg('오류를 먼저 해결하세요: ' + problems[0])
      return
    }
    setImporting(true)
    setMsg('')
    try {
      const res = await callFunction<{ count: number }>('admin', { action: 'questionsImport', bankId, rows: mappedRows })
      setMsg(`✅ ${res.count}문항 반영됨`)
      setRows([])
      setSubjMap({})
      setFileName('')
      onImported()
    } catch (e) {
      setMsg('실패: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 14px', lineHeight: 1.6 }}>
        <b>머리글의 열 이름을 자동 인식</b>합니다 — 컬럼 순서가 달라도, 위에 안내줄이 있어도 OK. 인식 열: <b>과목 · 난이도(상/중/하) · 지문 · 보기1~4 · 정답(1~4) · 유형(객관식/주관식) · 모범답안·유사정답1~5(주관식) · 해설</b>. 유형이 비면 객관식. <b>주관식·유사정답 열은 주관식이 있는 급수에서만</b> 쓰이며(이 급수에 주관식이 없으면 주관식 행은 업로드 거부), 주관식은 <b>모범답안+유사정답을 정규화 정확일치로 자동채점</b>합니다(대소문자·띄어쓰기 무시). <b>난이도·해설은 선택</b>이며 <b>응시·결과 화면에 노출되지 않습니다</b>(관리자 전용). 엑셀 <b>과목명은 아래 “과목 매핑”에서 이 급수의 정규 검정과목으로 치환</b>됩니다. 업로드하면 <b>항상 이 은행 뒤에 새 문항으로 추가</b>됩니다(번호 자동 부여).
      </p>
      <div className="admin-section" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <label className="admin-mini" style={{ cursor: 'pointer' }}>
          엑셀 선택
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </label>
        <button className="admin-mini" onClick={downloadTemplate}>
          템플릿 다운로드
        </button>
        {fileName && (
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {fileName} · {rows.length}행
          </span>
        )}
        {rows.length > 0 && (
          <button className="btn-ink" onClick={doImport} disabled={importing || problems.length > 0}>
            {importing ? '반영 중…' : `${rows.length}문항 반영`}
          </button>
        )}
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
      {/* 과목 매핑 — 엑셀 과목명을 이 급수의 정규 검정과목으로 치환. 비슷한 걸 자동 선택해두고 확인/수정만.
          정규 과목으로 맞춰야 문항 풀 현황 집계·실제 출제 추출(둘 다 과목명 완전일치)에 잡힌다. */}
      {guideSubjects.length > 0 && distinctSubjects.length > 0 && (
        <div className="admin-section" style={{ marginBottom: 14 }}>
          <div className="admin-sub" style={{ marginTop: 0 }}>
            과목 매핑{' '}
            <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--dim)' }}>
              엑셀 과목 → 이 급수의 정규 검정과목 · 비슷한 걸 미리 골라뒀어요(대소문자·띄어쓰기 차이는 자동 교정)
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {distinctSubjects.map((c) => {
              const mapped = subjMap[c] ?? ''
              const changed = mapped && qNormKey(mapped) !== qNormKey(c)
              const n = rows.reduce((a, r) => a + (r.subject === c ? 1 : 0), 0)
              return (
                <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 0, fontWeight: 600 }}>{c}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>({n})</span>
                  <span style={{ color: 'var(--dim)' }}>→</span>
                  <select className="admin-in" style={{ maxWidth: 340 }} value={mapped} onChange={(e) => setSubjMap((m) => ({ ...m, [c]: e.target.value }))}>
                    <option value="">그대로 유지(정규 과목 아님)</option>
                    {guideSubjects.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  {!mapped ? (
                    <span className="admin-hint" style={{ color: 'var(--error,#d43a3a)' }}>미매핑 — 풀 현황·출제에서 제외됨</span>
                  ) : changed ? (
                    <span className="admin-hint" style={{ color: '#2f855a' }}>교정됨</span>
                  ) : (
                    <span className="admin-hint">일치</span>
                  )}
                </div>
              )
            })}
          </div>
          {unmappedSubjects.length > 0 && (
            <div className="admin-hint" style={{ marginTop: 8 }}>
              ⚠️ 미매핑 {unmappedSubjects.length}개는 이대로 올리면 문항 풀 현황·실제 출제에서 빠집니다. 정규 과목에 맞춰 주세요.
            </div>
          )}
        </div>
      )}
      {parseErr && <div className="admin-section admin-empty">엑셀 오류 — {parseErr}</div>}
      {problems.length > 0 && (
        <div className="admin-section admin-empty" style={{ marginBottom: 14 }}>
          ⚠️ {problems.length}개 행에 문제: {problems.slice(0, 5).join(' / ')}
          {problems.length > 5 ? ' …' : ''}
        </div>
      )}
      {rows.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>유형</th>
                <th>과목</th>
                <th>난이도</th>
                <th>지문</th>
                <th>보기 / 허용답안</th>
                <th>정답</th>
                <th>해설</th>
              </tr>
            </thead>
            <tbody>
              {mappedRows.slice(0, 100).map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.number}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`admin-badge st-${r.kind === 'short' ? 'short' : 'submitted'}`}>{r.kind === 'short' ? '주관식' : '객관식'}</span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <b>{r.subject}</b>
                    {rows[i] && rows[i].subject !== r.subject && (
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dim)', textDecoration: 'line-through' }}>{rows[i].subject}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><DiffTag value={r.difficulty} /></td>
                  <td style={{ maxWidth: 320, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r.prompt}</td>
                  <td style={{ maxWidth: 260, whiteSpace: 'normal', wordBreak: 'break-word', fontSize: 12.5, color: 'var(--muted)' }}>{r.kind === 'short' ? (r.answerKey ? r.answerKey.split(/\r?\n/).filter(Boolean).join(' / ') : '—') : r.choices.join(' / ')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {r.kind === 'short' ? <span style={{ color: 'var(--muted)' }}>{r.answerKey ? '자동' : '검수'}</span> : r.correctIndex >= 0 ? `${r.correctIndex + 1}번` : <span style={{ color: 'var(--error,#d43a3a)' }}>?</span>}
                  </td>
                  <td style={{ maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word', fontSize: 12.5, color: 'var(--muted)' }}>{r.explanation || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 100 && (
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              미리보기는 100행까지 · 실제로는 {rows.length}행 모두 반영됩니다.
            </p>
          )}
        </div>
      )}
    </>
  )
}


// ---------- 홈페이지 관리 > 환율 관리 ----------
// 정가는 달러 하나이고(2026-08-13), 국내 결제만 이 환율로 원화 환산해 청구한다.
// ⚠️ 여기서 바꾼 값은 **다음 주문부터** 적용된다. 이미 만들어진 주문은 생성 시점 환율이 박혀 있고
//    그걸 나중에 바꾸면 화면에 뜬 금액과 청구액이 갈려 결제가 통째로 막힌다(payments.fx_rate).
interface FxRow { currency: string; rate: number; source: string; fetched_at: string; updated_at: string }

function FxAdmin() {
  const [rows, setRows] = useState<FxRow[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    const r = await callFunction<{ rates: FxRow[] }>('admin', { action: 'fxGet' })
    setRows(r.rates ?? [])
    setDraft(String(r.rates?.[0]?.rate ?? ''))
  }
  // 첫 로딩 — 화면을 떠난 뒤 응답이 와서 없는 컴포넌트에 쓰지 않도록 alive 로 막는다.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = await callFunction<{ rates: FxRow[] }>('admin', { action: 'fxGet' })
      if (!alive) return
      setRows(r.rates ?? [])
      setDraft(String(r.rates?.[0]?.rate ?? ''))
    })()
    return () => { alive = false }
  }, [])

  const krwRow = rows.find((r) => r.currency === 'KRW')
  const manual = krwRow?.source === 'manual'

  async function save(mode: 'manual' | 'auto') {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      await callFunction('admin', mode === 'auto'
        ? { action: 'fxSave', currency: 'KRW', mode: 'auto' }
        : { action: 'fxSave', currency: 'KRW', rate: Number(draft) })
      await load()
      setMsg(mode === 'auto' ? '자동 수집값으로 되돌렸습니다.' : '저장했습니다. 다음 주문부터 적용됩니다.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '실패했습니다.')
    } finally { setBusy(false) }
  }

  // 지금 환율이면 정가가 원화로 얼마가 되는지 — 관리자가 체감할 수 있어야 값이 낡은 걸 알아챈다.
  const preview = (cents: number) => krwRow ? Math.ceil((cents / 100) * Number(krwRow.rate)) : 0

  return (
    <section className="ad-card">
      <h2 className="ad-h2">환율 관리</h2>
      <p style={{ color: 'var(--muted)', marginBottom: 16 }}>
        정가는 달러 하나입니다. <b>국내(한국) 결제만</b> 이 환율로 원화 환산해 청구합니다 — 해외 결제는 달러 그대로입니다.
      </p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>$1 당 원화</span>
          <input
            style={{ ...inpStyle, width: 160, fontSize: 18, fontWeight: 700 }}
            type="number" min={100} max={100000} step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button className="ad-btn ad-btn-primary" disabled={busy} onClick={() => void save('manual')}>
          이 값으로 고정
        </button>
        <button className="ad-btn" disabled={busy} onClick={() => void save('auto')}>
          지금 환율 다시 받기
        </button>
      </div>

      <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.7 }}>
        <div>
          현재 적용값 <b style={{ color: 'var(--fg)' }}>{krwRow ? Number(krwRow.rate).toLocaleString('ko') : '-'}원</b>
          {' · '}{manual ? '수동 고정' : '자동 수집'}
          {krwRow?.fetched_at ? ` · ${fmtDT(krwRow.fetched_at)} 기준` : ''}
        </div>
        <div>
          {manual
            ? '수동으로 고정돼 있어 자동 수집이 덮어쓰지 않습니다. 자동으로 돌리려면 “지금 환율 다시 받기”를 누르세요.'
            : '주 1회 자동으로 갱신됩니다. 수집이 실패하면 마지막 값을 계속 씁니다 — 환율 때문에 결제가 멈추지는 않습니다.'}
        </div>
        <div style={{ marginTop: 10 }}>
          지금 값 기준 청구액 — $1 = {preview(100).toLocaleString('ko')}원 · $2 = {preview(200).toLocaleString('ko')}원 · $3 = {preview(300).toLocaleString('ko')}원
        </div>
        <div style={{ marginTop: 10, color: 'var(--warn, #c77)' }}>
          ⚠️ 바꾼 값은 <b>다음 주문부터</b> 적용됩니다. 이미 결제 중인 주문은 만들 때의 환율로 청구됩니다.
        </div>
      </div>

      {msg && <p style={{ marginTop: 14 }}>{msg}</p>}
    </section>
  )
}
