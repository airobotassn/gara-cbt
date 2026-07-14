import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { levelColor, emblemKeyForLevel } from '../lib/scoring'
import { useAuth } from '../context/AuthProvider'
import { callFunction } from '../lib/supabase'
import { useT, type TFunc } from '../lib/i18n'
import TopBar from '../components/TopBar'
import TierEmblem from '../components/TierEmblem'
import { Avatar } from '../components/GemAvatar'

interface HofUser {
  rank: number
  name: string
  level: number
  rating: number
  color: string | null
  image: string | null
  mascot: string | null
  me: boolean
}
interface HofResponse {
  top: HofUser[]
  total: number
  me: HofUser | null
}

// 집계 버킷(지역·국가·학교) — 개인 식별 필드 없이 집계값만. member_count<5 는 서버가 이미 제외.
interface Bucket {
  code: string
  label?: string | null // 학교 이름(학교 탭에만 존재)
  member_count: number
  avg_level: number
  active_today: number
  participation: number // 0..1
  score: number
}
interface BucketResponse {
  buckets: Bucket[]
  scope: string
  window: string
}

type Tab = 'personal' | 'region' | 'country' | 'school'
type Win = 'daily' | 'season'


function avatarUrlOf(u: { image: string | null; color: string | null; mascot?: string | null }): string | null {
  if (u.mascot) return `mascot:${u.mascot}`
  if (u.image) return `img:${u.image}`
  if (u.color) return `gem:${u.color}`
  return null // Avatar 가 seed 로 젬색 생성
}

// (더미 리더보드 제거 — 실데이터 또는 빈 상태만 표시)

export default function Ranking() {
  const { isFullUser, loading, loginWithGoogle } = useAuth()
  const { t } = useT()
  const [tab, setTab] = useState<Tab>('personal')
  const [win, setWin] = useState<Win>('daily')
  const [data, setData] = useState<HofResponse | null>(null)
  const [err, setErr] = useState(false)
  const [agg, setAgg] = useState<BucketResponse | null>(null)
  const [aggErr, setAggErr] = useState(false)

  // 개인(명예의 전당)은 공개 — 비로그인도 보드 조회(서버가 me 만 비움). 로그인 상태 바뀌면 재조회.
  useEffect(() => {
    if (loading) return
    callFunction<HofResponse>('leaderboard', { scope: 'global' })
      .then((d) => setData(d)) // 실데이터만 (비면 빈 상태 UI)
      .catch(() => setErr(true))
  }, [isFullUser, loading])

  // 집계 탭(지역·국가·학교) + 오늘/시즌 토글 — 탭/윈도우가 바뀔 때만 조회.
  useEffect(() => {
    if (tab === 'personal') return
    setAgg(null)
    setAggErr(false)
    callFunction<BucketResponse>('leaderboard', { scope: tab, window: win, country: 'KR' })
      .then((d) => setAgg(d))
      .catch(() => setAggErr(true))
  }, [tab, win])

  return (
    <div className="wrap hof-wrap">
      <TopBar />

      <header className="hof-head">
        <div className="hof-badge">
          <span className="hof-badge-disc">
            <span className="hof-badge-ico">🏆</span>
          </span>
        </div>
        <h1 className="hof-title">{t('rank.hall')}</h1>
        <p className="hof-sub">{tab === 'personal' ? t('rank.hall_sub') : t('rank.coop_header')}</p>
      </header>

      {/* === 탭바: 개인 / 지역 / 국가 / 학교 === */}
      <div className="hof-tabs" role="tablist">
        {(['personal', 'region', 'country', 'school'] as Tab[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`hof-tab ${tab === k ? 'on' : ''}`}
            onClick={() => setTab(k)}
          >
            {t(`rank.tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === 'personal' ? (
        <PersonalBoard
          t={t}
          data={data}
          err={err}
          isFullUser={isFullUser}
          loginWithGoogle={loginWithGoogle}
        />
      ) : (
        <AggregateBoard t={t} tab={tab} win={win} setWin={setWin} agg={agg} err={aggErr} />
      )}
    </div>
  )
}

// ===== 개인(명예의 전당) — 기존 뷰 유지 =====
function PersonalBoard({
  t,
  data,
  err,
  isFullUser,
  loginWithGoogle,
}: {
  t: TFunc
  data: HofResponse | null
  err: boolean
  isFullUser: boolean
  loginWithGoogle: (redirect: string) => void
}) {
  const top = data?.top ?? []
  const podium = [top[1], top[0], top[2]] // 2 · 1 · 3
  const podClass = ['p2', 'p1', 'p3']
  const rest = top.slice(3)
  const me = data?.me ?? null
  const total = data?.total ?? 0
  const mePct = me && total > 0 ? Math.max(1, Math.round((me.rank / total) * 100)) : 0

  return (
    <>
      {err ? (
        <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          {t('result.load_failed')}
        </div>
      ) : !data ? (
        <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
      ) : top.length === 0 ? (
        <div className="panel-card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.no_record')}</p>
          <Link to="/test/select" className="btn-ink" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
            {t('rank.cta_test')}
          </Link>
        </div>
      ) : (
        <>
          {/* === 시상대 TOP 3 === */}
          <div className="hof-podium">
            {podium.map((u, i) =>
              u ? (
                <div key={u.rank} className={`hof-pp ${podClass[i]}`}>
                  {u.rank === 1 ? <div className="hof-crown">👑</div> : null}
                  <div className="hof-ring">
                    <span className="hof-ring-in">
                      <Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={u.rank === 1 ? 72 : 58} />
                    </span>
                  </div>
                  <div className="hof-pp-nm">{u.name}</div>
                  <div className="hof-pp-pt">{t('rank.pt', { n: u.rating })}</div>
                  <div className="hof-ped" style={{ ['--lc' as string]: levelColor(u.level) }}>{u.rank}</div>
                </div>
              ) : (
                <div key={i} className={`hof-pp ${podClass[i]}`} />
              ),
            )}
          </div>

          {/* === 4 ~ 10 === */}
          <div className="hof-list">
            {rest.map((u) => (
              <HofRow key={u.rank} u={u} t={t} />
            ))}
          </div>
        </>
      )}

      {/* === 내 순위 고정 바 === */}
      {data ? (
        <div className={`hof-mebar ${me && isFullUser ? '' : 'unranked'}`}>
          {!isFullUser ? (
            <>
              <div className="nm unr">{t('rank.guest_bar')}</div>
              <button
                className="hof-mebar-cta"
                onClick={() => loginWithGoogle(`${window.location.origin}/ranking`)}
                style={{ border: 'none', background: 'none', cursor: 'pointer' }}
              >
                {t('rank.guest_login')}
              </button>
            </>
          ) : me ? (
            <>
              <div className="rk">{me.rank}</div>
              <Avatar avatarUrl={avatarUrlOf(me)} seed={me.name} size={38} />
              <div className="nm">
                {me.name}
                <small>{t('rank.top_label')} {mePct}%</small>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                <TierEmblem tierKey={emblemKeyForLevel(me.level)} size={44} />
                <div className="pt">{t('rank.pt', { n: me.rating })}</div>
              </div>
            </>
          ) : (
            <>
              <div className="nm unr">{t('rank.unplaced')}</div>
              <Link to="/test/select" className="hof-mebar-cta">{t('rank.cta_test')}</Link>
            </>
          )}
        </div>
      ) : null}
    </>
  )
}

// ===== 집계(지역·국가·학교) — 협력 서사 버킷 카드 =====
function AggregateBoard({
  t,
  tab,
  win,
  setWin,
  agg,
  err,
}: {
  t: TFunc
  tab: Tab
  win: Win
  setWin: (w: Win) => void
  agg: BucketResponse | null
  err: boolean
}) {
  // 버킷 라벨: 지역=region.<code>, 국가=country.<code>(폴백 코드), 학교=버킷 label
  const labelOf = (b: Bucket): string => {
    if (tab === 'region') return t(`region.${b.code}`)
    if (tab === 'country') {
      const nm = t(`country.${b.code}`)
      return nm === `country.${b.code}` ? b.code : nm
    }
    return b.label || t('rank.aggregating')
  }
  const buckets = agg?.buckets ?? []

  return (
    <>
      {/* 오늘/시즌 토글 */}
      <div className="hof-wintoggle" role="tablist" aria-label="window">
        {(['daily', 'season'] as Win[]).map((w) => (
          <button
            key={w}
            role="tab"
            aria-selected={win === w}
            className={`hof-winbtn ${win === w ? 'on' : ''}`}
            onClick={() => setWin(w)}
          >
            {t(`rank.win_${w}`)}
          </button>
        ))}
      </div>

      {err ? (
        <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
          {t('result.load_failed')}
        </div>
      ) : !agg ? (
        <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
      ) : buckets.length === 0 ? (
        // 집계 대상 버킷 없음(모두 프라이버시 floor 아래) → 협력적 '집계중'
        <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('rank.aggregating')}</div>
      ) : (
        <div className="hof-buckets">
          {buckets.map((b, i) => (
            <BucketCard key={b.code} b={b} rank={i + 1} label={labelOf(b)} t={t} />
          ))}
        </div>
      )}
    </>
  )
}

function BucketCard({ b, rank, label, t }: { b: Bucket; rank: number; label: string; t: TFunc }) {
  // 서버가 floor 를 제외하지만, 방어적으로 집계 미완 버킷은 '집계중' 표기(레벨 유출 방지).
  const floored = !b.member_count || b.member_count < 5 || b.avg_level == null
  const avg = Math.round((b.avg_level ?? 0) * 10) / 10
  const pct = Math.round((b.participation ?? 0) * 100)
  return (
    <div className="hof-bkt">
      <span className="hof-bkt-rk">{rank}</span>
      <div className="hof-bkt-main">
        <div className="hof-bkt-nm">{label}</div>
        <div className="hof-bkt-meta">
          {floored ? (
            <span className="hof-bkt-agg">{t('rank.aggregating')}</span>
          ) : (
            <>
              <span>{t('rank.avg')} {avg}</span>
              <span className="dot">·</span>
              <span>{t('rank.active_today')} {pct}%</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function HofRow({ u, t }: { u: HofUser; t: TFunc }) {
  return (
    <div className={`hof-row ${u.me ? 'me' : ''}`}>
      <span className="rk">{u.rank}</span>
      <Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={36} />
      <span className="nm">
        {u.name}
        {u.me ? <span className="meflag">{t('rank.you')}</span> : null}
      </span>
      <TierEmblem tierKey={emblemKeyForLevel(u.level)} size={44} />
      <span className="pt">{t('rank.pt', { n: u.rating })}</span>
    </div>
  )
}
