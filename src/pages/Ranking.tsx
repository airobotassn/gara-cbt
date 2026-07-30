import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { levelColor, tierColor, type Tier } from '../lib/scoring'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { countryName } from '../lib/regions'
import { useT, type TFunc } from '../lib/i18n'
import TopBar from '../components/TopBar'
import TierBadge from '../components/TierBadge'
import { Avatar } from '../components/GemAvatar'

interface HofUser {
  rank: number
  name: string
  level: number
  rating: number // 시즌 총점(season_total) — 서버 leaderboard 응답 필드명은 하위호환상 rating 유지
  color: string | null
  image: string | null
  mascot: string | null
  me: boolean
  tier: Tier | null
  percentile: number | null // 0~1, 낮을수록 상위 (해당 보드 범위 안 기준)
}
interface HofResponse {
  top: HofUser[]
  total: number
  me: (HofUser & { pointsToPass?: number | null }) | null
  code?: string | null // 적용된 국가/지역 코드(전세계는 null)
  needsAuth?: boolean // 비로그인이라 국가·지역 보드를 만들 수 없음
  needsRegion?: boolean // 로그인했지만 국가·지역 미설정(온보딩 전)
}

// 랭킹 범위 — 셋 다 **개인** 리더보드고 모수만 다르다(전체 / 내 국가 / 내 지역).
// 옛 '지역·국가 집계 버킷' 탭(평균·참여율 카드)은 여기서 제거됐다 — 그 뷰는 /arena 지도가 계속 쓴다.
// 탭 순서는 좁은 쪽 → 넓은 쪽(내 지역 → 내 국가 → 전세계). 오른쪽으로 갈수록 모수가 커지는 사다리.
type Scope = 'global' | 'my-country' | 'my-region'
const SCOPES: Scope[] = ['my-region', 'my-country', 'global']

function avatarUrlOf(u: { image: string | null; color: string | null; mascot?: string | null }): string | null {
  if (u.mascot) return `mascot:${u.mascot}`
  if (u.image) return `img:${u.image}`
  if (u.color) return `gem:${u.color}`
  return null // Avatar 가 seed 로 젬색 생성
}

// (더미 리더보드 제거 — 실데이터 또는 빈 상태만 표시)

export default function Ranking() {
  const { user, isFullUser, loading, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  // 사용자가 탭을 직접 고르기 전엔 null — 그동안은 아래 defaultScope 가 적용된다.
  const [picked, setPicked] = useState<Scope | null>(null)
  // 범위별 응답 캐시 — 탭을 오갈 때 재조회하지 않는다. 캐시 키에 로그인 여부를 섞어서,
  // 로그인/로그아웃하면 키가 어긋나 자동으로 다시 받는다(응답의 me 가 달라지므로).
  const [boards, setBoards] = useState<Record<string, HofResponse>>({})
  const [errs, setErrs] = useState<Record<string, boolean>>({})
  // 탭 라벨용 내 국가·지역 코드(데이터 도착 전에도 '대한민국·서울'로 보여야 하므로 프로필에서 먼저 읽는다).
  //   uid 를 같이 들고 있다가 렌더에서 대조 — 계정이 바뀌면 이전 사용자 코드가 남지 않는다.
  const [profile, setProfile] = useState<{ uid: string; country: string | null; region: string | null } | null>(null)
  const uid = user?.id ?? null
  const myCode = uid && isFullUser && profile?.uid === uid ? profile : { country: null, region: null }
  // 프로필(국가·지역)이 확정됐나 — 확정 전에 조회하면 기본 탭이 뒤늦게 바뀌며 헛조회가 난다.
  const profileReady = !isFullUser || !uid || profile?.uid === uid
  // 기본 탭 = 내 지역. 단 비로그인·지역 미설정이면 안내문만 뜨는 탭이 첫 화면이 되므로 전세계로.
  const defaultScope: Scope = myCode.region ? 'my-region' : 'global'
  const scope = picked ?? defaultScope

  useEffect(() => {
    if (!uid || !isFullUser) return
    let alive = true
    supabase
      .from('profiles')
      .select('country_code,region_code')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setProfile({ uid, country: data?.country_code ?? null, region: data?.region_code ?? null })
      })
    return () => {
      alive = false
    }
  }, [uid, isFullUser])

  // 보드 조회 — 랭킹은 공개라 비로그인도 전세계 탭은 본다(서버가 me 만 비움).
  const cacheKey = `${isFullUser ? 'u' : 'g'}:${scope}`
  useEffect(() => {
    if (loading || !profileReady) return
    if (boards[cacheKey] || errs[cacheKey]) return
    let alive = true
    callFunction<HofResponse>('leaderboard', { scope })
      .then((d) => {
        if (alive) setBoards((prev) => ({ ...prev, [cacheKey]: d }))
      })
      .catch(() => {
        if (alive) setErrs((prev) => ({ ...prev, [cacheKey]: true }))
      })
    return () => {
      alive = false
    }
  }, [scope, cacheKey, loading, profileReady, boards, errs])

  // 탭 라벨: 전세계는 고정, 국가·지역은 **실제 이름**(대한민국 · 서울). 코드가 없으면 일반 라벨로 폴백.
  const labelOf = (s: Scope): string => {
    if (s === 'global') return t('rank.tab_world')
    if (s === 'my-country') return myCode.country ? countryName(myCode.country, lang) : t('rank.tab_country')
    if (!myCode.region) return t('rank.tab_region')
    const nm = t(`region.${myCode.region}`)
    return nm === `region.${myCode.region}` ? myCode.region : nm
  }

  const data = boards[cacheKey] ?? null
  const err = !!errs[cacheKey]

  return (
    <div className="wrap hof-wrap">
      {/* 랭킹 진입점이 허브(CARI) 도크 CTA 라 뒤로가기도 허브로 */}
      <TopBar to="/hub" label={t('common.cari')} />

      <header className="hof-head">
        <div className="hof-badge">
          <span className="hof-badge-disc">
            <span className="hof-badge-ico">🏆</span>
          </span>
        </div>
        <h1 className="hof-title">{t('rank.hall')}</h1>
        <p className="hof-sub">
          {scope === 'global' ? t('rank.hall_sub') : t('rank.scope_sub', { name: labelOf(scope) })}
        </p>
      </header>

      {/* === 탭바: 전세계 / 내 국가 / 내 지역 === */}
      <div className="hof-tabs" role="tablist">
        {SCOPES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={scope === s}
            className={`hof-tab ${scope === s ? 'on' : ''}`}
            onClick={() => setPicked(s)}
          >
            {labelOf(s)}
          </button>
        ))}
      </div>

      {data?.needsAuth ? (
        <div className="panel-card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.scope_guest')}</p>
          <button
            className="btn-ink"
            onClick={() => loginWithGoogle(`${window.location.origin}/ranking`)}
            style={{ marginTop: 12, border: 'none', cursor: 'pointer' }}
          >
            {t('rank.guest_login')}
          </button>
        </div>
      ) : data?.needsRegion ? (
        <div className="panel-card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.scope_no_region')}</p>
          <Link to="/onboarding" className="btn-ink" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
            {t('rank.scope_set_region')}
          </Link>
        </div>
      ) : (
        <PersonalBoard
          t={t}
          data={data}
          err={err}
          isFullUser={isFullUser}
          loginWithGoogle={loginWithGoogle}
        />
      )}
    </div>
  )
}

// ===== 개인 리더보드(시상대 + 4~10위 + 내 순위 바) — 세 범위가 같은 뷰를 공유한다 =====
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
  const mePct = me?.percentile != null ? Math.max(1, Math.round(me.percentile * 100)) : me && total > 0 ? Math.max(1, Math.round((me.rank / total) * 100)) : 0

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
                  <div className="hof-ped" style={{ ['--lc' as string]: u.tier ? tierColor(u.tier) : levelColor(u.level) }}>{u.rank}</div>
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
                {me.tier ? <TierBadge tier={me.tier} size={44} alt={t(`rank.tier_${me.tier}`)} /> : null}
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

function HofRow({ u, t }: { u: HofUser; t: TFunc }) {
  return (
    <div className={`hof-row ${u.me ? 'me' : ''}`}>
      <span className="rk">{u.rank}</span>
      <Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={36} />
      <span className="nm">
        {u.name}
        {u.me ? <span className="meflag">{t('rank.you')}</span> : null}
      </span>
      {u.tier ? <TierBadge tier={u.tier} size={44} alt={t(`rank.tier_${u.tier}`)} /> : <span style={{ width: 44 }} />}
      <span className="pt">{t('rank.pt', { n: u.rating })}</span>
    </div>
  )
}
