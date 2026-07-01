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
  me: boolean
}
interface HofResponse {
  top: HofUser[]
  total: number
  me: HofUser | null
}

function avatarUrlOf(u: { image: string | null; color: string | null }): string | null {
  if (u.image) return `img:${u.image}`
  if (u.color) return `gem:${u.color}`
  return null // Avatar 가 seed 로 젬색 생성
}

// 미리보기용 더미 TOP 10 (실데이터 비었을 때만 표시) — 다국어 사용자 섞음
const DUMMY_HOF: HofResponse = {
  total: 1284,
  top: [
    { rank: 1, name: '민서', level: 7, rating: 9310, color: '#e0863f', image: null, me: false },
    { rank: 2, name: 'आरव', level: 7, rating: 8420, color: '#c2843a', image: null, me: false },
    { rank: 3, name: 'Olivia', level: 6, rating: 7980, color: '#5aa9a0', image: null, me: false },
    { rank: 4, name: '蓮', level: 6, rating: 7540, color: null, image: null, me: false },
    { rank: 5, name: 'प्रिया', level: 5, rating: 7120, color: '#b9743a', image: null, me: false },
    { rank: 6, name: '伟轩', level: 5, rating: 6890, color: null, image: null, me: false },
    { rank: 7, name: 'Minh', level: 4, rating: 6540, color: '#5a99cc', image: null, me: false },
    { rank: 8, name: 'さくら', level: 4, rating: 6210, color: '#cc7777', image: null, me: false },
    { rank: 9, name: 'Liam', level: 4, rating: 5980, color: null, image: null, me: false },
    { rank: 10, name: '芳', level: 3, rating: 5640, color: '#7a99aa', image: null, me: false },
  ],
  me: { rank: 42, name: '나', level: 3, rating: 4120, color: null, image: null, me: true },
}

export default function Ranking() {
  const { isFullUser, loading, loginWithGoogle } = useAuth()
  const { t } = useT()
  const [data, setData] = useState<HofResponse | null>(DUMMY_HOF) // 미리보기용 더미로 시작
  const [err, setErr] = useState(false)

  // 랭킹은 공개 — 비로그인도 보드 조회(서버가 me 만 비움). 로그인 상태 바뀌면 재조회.
  useEffect(() => {
    if (loading) return
    callFunction<HofResponse>('leaderboard', {})
      .then((d) => setData(d.top.length ? d : DUMMY_HOF)) // 실데이터 비면 더미 유지
      .catch(() => setErr(true))
  }, [isFullUser, loading])

  const top = data?.top ?? []
  const podium = [top[1], top[0], top[2]] // 2 · 1 · 3
  const podClass = ['p2', 'p1', 'p3']
  const rest = top.slice(3)
  const me = data?.me ?? null
  const total = data?.total ?? 0
  const mePct = me && total > 0 ? Math.max(1, Math.round((me.rank / total) * 100)) : 0

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
        <p className="hof-sub">{t('rank.hall_sub')}</p>
      </header>

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
