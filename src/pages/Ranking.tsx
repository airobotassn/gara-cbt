import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, supabase } from '../lib/supabase'
import { countryName } from '../lib/regions'
import { showPercentile } from '../lib/scoring'
import { useT, type TFunc } from '../lib/i18n'
import TopBar from '../components/TopBar'
import { Avatar } from '../components/GemAvatar'
import ShareCardModal from '../components/ShareCardModal'
import type { ShareCardData } from '../lib/shareCard'

interface HofUser {
  rank: number
  name: string
  level: number
  rating: number // 시즌 총점(season_total) — 서버 leaderboard 응답 필드명은 하위호환상 rating 유지
  color: string | null
  image: string | null
  mascot: string | null
  me: boolean
  // ⚠️ 서버는 아직 tier 를 내려주지만(DB ranking_tier) 티어 표시는 2026-08-04 제거돼 읽지 않는다.
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
// 탭 순서는 넓은 쪽 → 좁은 쪽(전세계 → 내 국가 → 내 지역). 오른쪽으로 갈수록 모수가 좁혀지는 사다리.
type Scope = 'global' | 'my-country' | 'my-region'
const SCOPES: Scope[] = ['global', 'my-country', 'my-region']

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

  // 제목 블록 — 시상대가 보일 땐 시상대 그림의 '날개 사이'에 얹히고(PersonalBoard),
  // 로딩·빈 보드·안내 화면에선 평범한 헤더로 그린다. 어느 상태에서도 제목이 사라지지 않게.
  // 부제('전체 TOP 10' / '경기도 TOP 10')는 제거했다 — 어느 보드인지는 위 탭바가 이미 말해준다.
  const titleNode = <h1 className="hof-title">{t('rank.hall')}</h1>

  // 4~10위 창 안에서 내 행으로 스크롤 — 하단 '내 순위' 바를 탭했을 때(게임 리더보드 관습).
  const listRef = useRef<HTMLDivElement>(null)
  const jumpToMe = () => {
    listRef.current?.querySelector('[data-me-anchor]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const gated = !!(data?.needsAuth || data?.needsRegion)

  // 보드에서 사람을 누르면 그 사람 카드(PNG)를 **그때그때** 만들어 보여준다.
  //   · 저장하지 않는다 — TOP10 은 계속 바뀌어서 저장하는 순간 낡는다.
  //   · 추가 조회도 없다 — 카드에 쓰는 값이 전부 leaderboard 응답의 그 행에 이미 들어 있다.
  //   · publicOnly=true → 랭킹 화면에 없던 정보(국가·지역 순위·가입일·지역)는 아예 안 그린다.
  const [cardOf, setCardOf] = useState<HofUser | null>(null)
  const cardData: ShareCardData | null = cardOf
    ? {
        name: cardOf.name,
        avatarUrl: avatarUrlOf(cardOf),
        seed: cardOf.name,
        percentile: cardOf.percentile,
        rank: cardOf.rank,
        rankTotal: data?.total ?? null,
        countryRank: null, countryTotal: null, regionRank: null, regionTotal: null,
        seasonTotal: cardOf.rating,
        joinedAt: null, country: null, region: null,
        publicOnly: true,
      }
    : null

  // 레이아웃 = 한 화면 고정 틀.
  //   고정: 뒤로가기 → 탭바 → 엠블럼 → 제목 → 시상대   (제목은 시상대 그림에 박혀 있어 분리 불가)
  //   스크롤: 4~10위 리스트 하나 (.hof-listwin — 눌린 홈 모양의 '창')
  //   고정: 내 순위 바 (창 밖이라 순위 행과 겹칠 수 없다)
  return (
    <div className="wrap hof-wrap">
      {/* 랭킹 진입점이 허브(CARI) 도크 CTA 라 뒤로가기도 허브로 */}
      <TopBar to="/hub" label={t('common.cari')} />

      {/* 제목은 페이지 전체의 제목이라 탭바 **위**, 전체 폭 가운데다.
          (한때 본문 안에 있었는데, 2단이 되면서 왼쪽 칸 안에 갇혀 화면 기준으로 왼쪽에 치우쳐 보였다.
           위계도 이쪽이 맞다 — 제목 → 보드 고르는 탭 → 내용) */}
      <header className="hof-head">{titleNode}</header>

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

      {/* 방패 엠블럼은 뺐다 — 시상대 1등 링에 이미 왕관이 얹혀 있어 중복이고,
          한 화면 고정 틀에서 110px 을 먹어 4~10위 창이 1줄밖에 안 남았다(2026-08-03). */}

      {/* 본문 래퍼 — 폰에서는 display:contents 라 아무것도 안 하고(지금까지의 세로 흐름 그대로),
          데스크톱에서만 2단 그리드가 된다: 왼쪽 제목+시상대 / 오른쪽 4~10위+내 순위 바.
          래퍼가 필요한 이유 = 두 칸에 들어갈 요소(head·podium·listwin·mebar)가 조건부 분기 세 갈래에
          흩어져 있어서, 공통 부모 없이는 그리드 영역을 지정할 수가 없다. */}
      <div className="hof-body">
      {data?.needsAuth ? (
        <>
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
        </>
      ) : data?.needsRegion ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.scope_no_region')}</p>
            <Link to="/onboarding" className="btn-ink" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
              {t('rank.scope_set_region')}
            </Link>
          </div>
        </>
      ) : (
        <PersonalBoard t={t} data={data} err={err} listRef={listRef} onPick={setCardOf} />
      )}

      {data && !gated ? (
        <MeBar t={t} data={data} isFullUser={isFullUser} loginWithGoogle={loginWithGoogle} onJumpToMe={jumpToMe} />
      ) : null}
      </div>

      {cardData ? (
        <ShareCardModal data={cardData} title={`${cardOf?.name} 카드`} readOnly onClose={() => setCardOf(null)} />
      ) : null}
    </div>
  )
}

// ===== 하단 고정 '내 순위' 바 — 스크롤 영역 바깥이라 순위 행과 겹치지 않는다 =====
function MeBar({
  t,
  data,
  isFullUser,
  loginWithGoogle,
  onJumpToMe,
}: {
  t: TFunc
  data: HofResponse
  isFullUser: boolean
  loginWithGoogle: (redirect: string) => void
  onJumpToMe: () => void
}) {
  const me = data.me
  const total = data.total ?? 0
  const mePct = me?.percentile != null ? Math.max(1, Math.round(me.percentile * 100)) : me && total > 0 ? Math.max(1, Math.round((me.rank / total) * 100)) : 0
  // '눌러서 내 행으로'는 내가 **창 안(4~10위)** 에 있을 때만 성립한다.
  // TOP 3 는 시상대에 고정 노출이라 이동할 게 없고, 10위 밖이면 애초에 보드에 없다.
  const inList = data.top.slice(3).some((u) => u.me)

  if (!isFullUser) {
    return (
      <div className="hof-mebar unranked">
        <div className="nm unr">{t('rank.guest_bar')}</div>
        <button
          className="hof-mebar-cta"
          onClick={() => loginWithGoogle(`${window.location.origin}/ranking`)}
          style={{ border: 'none', background: 'none', cursor: 'pointer' }}
        >
          {t('rank.guest_login')}
        </button>
      </div>
    )
  }
  if (!me) {
    return (
      <div className="hof-mebar unranked">
        <div className="nm unr">{t('rank.unplaced')}</div>
        <Link to="/test/select" className="hof-mebar-cta">{t('rank.cta_test')}</Link>
      </div>
    )
  }
  return (
    <div className="hof-mebar">
      <div
        className={`hof-bar ${inList ? 'jump' : ''}`}
        {...(inList
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: onJumpToMe,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onJumpToMe()
                }
              },
            }
          : {})}
      >
        <img src="/ranking/tierbar.png" alt="" className="bar-frame" />
        <span className="bar-rk">{me.rank}</span>
        <span className="bar-ava"><Avatar avatarUrl={avatarUrlOf(me)} seed={me.name} size={48} /></span>
        <span className="bar-nm">
          {me.name}
          {/* 모수가 적으면 백분위 자체를 감춘다 — 3명뿐인데 1등이 '상위 33%' 로 찍히면 오히려 못한 것처럼 읽힌다.
              대체 문구("N명 중 M위")도 넣지 않는다: 사람이 모이면 그때 조용히 나타나는 게 낫다(scoring.ts 참고). */}
          {showPercentile(total) && <small>{t('rank.top_label')} {mePct}%</small>}
        </span>
        <span className="bar-pt">{t('rank.pt', { n: me.rating })}</span>
      </div>
    </div>
  )
}

// ===== 개인 리더보드 본문(시상대 + 4~10위) — 세 범위가 같은 뷰를 공유한다.
//       '내 순위' 바는 스크롤 영역 밖이라 여기 없다(MeBar).
//       제목도 여기 없다 — 탭바 위 페이지 헤더로 올라갔다(Ranking 본체). =====
function PersonalBoard({
  t,
  data,
  err,
  listRef,
  onPick,
}: {
  t: TFunc
  data: HofResponse | null
  err: boolean
  listRef: React.RefObject<HTMLDivElement | null>
  onPick: (u: HofUser) => void
}) {
  const top = data?.top ?? []
  const podium = [top[1], top[0], top[2]] // 2 · 1 · 3
  const podClass = ['p2', 'p1', 'p3']
  const rest = top.slice(3)

  return (
    <>
      {err ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>
            {t('result.load_failed')}
          </div>
        </>
      ) : !data ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center', color: 'var(--muted)' }}>{t('common.loading')}</div>
        </>
      ) : top.length === 0 ? (
        <>
          <div className="panel-card" style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>{t('rank.no_record')}</p>
            <Link to="/test/select" className="btn-ink" style={{ display: 'inline-block', marginTop: 12, textDecoration: 'none' }}>
              {t('rank.cta_test')}
            </Link>
          </div>
        </>
      ) : (
        <>
          {/* === 시상대 TOP 3 ===
              그림 = public/ranking/podium.png. 아바타는 링 위에, 이름·점수·티어는 그림의 크림 명판 안에.
              둘 다 그림 기준 %좌표(실측값은 ranking.css 주석). 글자 크기는 cqw 라 그림과 같이 줄어든다. */}
          <div className="hof-podium">
            <div className="hof-podium-art">
              <img src="/ranking/podium.png" alt="" className="hof-podium-img" />
              {podium.map((u, i) =>
                u ? (
                  <button
                    key={u.rank}
                    type="button"
                    className={`hof-slot ${podClass[i]}`}
                    onClick={() => onPick(u)}
                    aria-label={`${u.name} 카드 보기`}
                    {...(u.me ? { 'data-me-anchor': '1' } : {})}
                  >
                    <Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={120} />
                  </button>
                ) : null,
              )}
              {/* 이름·점수·티어 = 그림 안 크림 명판 위. 명판은 1등이 크고 2·3등이 작아서
                  1등만 두 줄(이름/점수)로, 2·3등은 한 줄로 그린다. */}
              {podium.map((u, i) =>
                u ? (
                  <div key={`pl${u.rank}`} className={`hof-plate ${podClass[i]}`}>
                    <span className="hof-plate-txt">
                      <b>{u.name}</b>
                      <span>{t('rank.pt', { n: u.rating })}</span>
                    </span>
                  </div>
                ) : null,
              )}
            </div>
          </div>

          {/* === 4 ~ 10 — 화면에서 유일하게 스크롤되는 '창' ===
              4위 이하가 아예 없으면(지역 보드처럼 인원이 3명 이하) 창을 아예 그리지 않는다.
              빈 창은 큰 빈 상자(세로 고정 시절) 아니면 얇은 선(2단 이후)이라 둘 다 사고처럼 보인다. */}
          {rest.length > 0 ? (
            <div className="hof-listwin" ref={listRef}>
              <div className="hof-list">
                {rest.map((u) => (
                  <HofRow key={u.rank} u={u} t={t} onPick={onPick} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

// 4~10위 한 행 = 티어리스트 바 프레임 하나.
// 그림의 소켓 배치대로: 큰 원=순위 · 작은 원=아바타 · 가운데 빈칸=이름·점수 · 방패=티어 엠블렘.
function HofRow({ u, t, onPick }: { u: HofUser; t: TFunc; onPick: (u: HofUser) => void }) {
  return (
    <div className={`hof-row ${u.me ? 'me' : ''}`} {...(u.me ? { 'data-me-anchor': '1' } : {})}>
      <div
        className="hof-bar jump"
        role="button"
        tabIndex={0}
        aria-label={`${u.name} 카드 보기`}
        onClick={() => onPick(u)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(u) } }}
      >
        <img src="/ranking/tierbar.png" alt="" className="bar-frame" />
        <span className="bar-rk">{u.rank}</span>
        <span className="bar-ava"><Avatar avatarUrl={avatarUrlOf(u)} seed={u.name} size={48} /></span>
        <span className="bar-nm">
          {u.name}
          {u.me ? <span className="meflag">{t('rank.you')}</span> : null}
        </span>
        <span className="bar-pt">{t('rank.pt', { n: u.rating })}</span>
      </div>
    </div>
  )
}
