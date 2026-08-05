import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { ChangeEvent, ReactNode } from 'react'
import { useAuth } from '../context/AuthProvider'
import { supabase, callFunction } from '../lib/supabase'
import GemAvatar, { Avatar } from './GemAvatar'
import { GEM_COLORS, ADMIN_MASCOT_COUNT, parseAvatar, uploadAvatar } from '../lib/avatar'
import { isSEB } from '../lib/seb'
import { useT, LANGS } from '../lib/i18n'
import { makePracticeExam } from '../lib/practice'
import {
  HomeIcon,
  BookIcon,
  InfoIcon,
  UserIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
  EarthIcon,
  ToolIcon,
  MoreIcon,
  PencilIcon,
  CameraIcon,
  ChevronUpIcon,
} from './FabIcons'

export default function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useT()
  const { user, isFullUser, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<{
    display_name: string | null
    avatar_url: string | null
  } | null>(null)
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // 다크/라이트 모드 (html.dark 토글 + localStorage 저장, index.html 에서 초기 적용)
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      /* 무시 */
    }
  }
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // FAB 숨김: 응시 화면(/exam/run/:id · /test/:attemptId)·보안 브라우저(SEB)는 시험 중 이탈 차단,
  //   /games/* 는 게임 UI(하단 선택지)와 FAB 겹침 방지.
  //   이북 뷰어(/ebooks/read/:id)도 전체화면 iframe 이라 FAB 이 본문 위를 덮는다 → 숨김(스토어 /ebooks 는 유지).
  // 그 외 모든 페이지는 헤더 없이 FAB이 네비 역할을 한다.
  //   ⚠️ 레벨테스트 응시는 폰에서 실제로 쓰는 시험 화면이고(CBT 응시는 데스크톱 전용), 하단 문항 점프 패드가
  //      FAB·'맨 위로' 버튼에 가려 문항 1·2·11·12·9·10·19·20 을 못 누른다 → 여기서 같이 숨긴다.
  //      /test/select(레벨 선택)·/test/result/:id(결과)는 응시 화면이 아니므로 제외.
  const inLevelTestRun = /^\/test\/(?!select$|result\/)[^/]+$/.test(pathname)
  const inTest =
    pathname.startsWith('/exam/run/') ||
    inLevelTestRun ||
    pathname.startsWith('/games/') ||
    pathname.startsWith('/ebooks/read/') ||
    isSEB()

  // 관리자 여부 — 서버(admin 'me')로 확인. 관리자면 FAB에 관리자 페이지 링크 노출.
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    if (!isFullUser) {
      setIsAdmin(false)
      return
    }
    callFunction('admin', { action: 'me' })
      .then(() => setIsAdmin(true))
      .catch(() => setIsAdmin(false))
  }, [isFullUser, user])

  useEffect(() => {
    if (!isFullUser || !user) {
      setProfile(null)
      return
    }
    supabase
      .from('profiles')
      .select('display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data ?? null))
  }, [isFullUser, user])

  // 패널 외부 클릭 시 닫기 + '더보기' 팝오버는 자기 밖을 누르면 항상 접기(모바일에서 계속 떠 방해)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null
      // 더보기 팝오버/토글 밖을 누르면 팝오버만 닫는다(패널 내부 다른 항목 클릭 포함)
      if (!el?.closest('.pf-more-pop, .pf-more')) setMoreOpen(false)
      if (el?.closest('.panel, .fab, .pf-more-pop')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const name = isFullUser ? profile?.display_name || user?.email || t('fab.account') : t('fab.guest')

  const seedBase = user?.id ?? 'guest'
  const spec = parseAvatar(profile?.avatar_url, seedBase)
  const gemColor = spec.kind === 'gem' ? spec.color : null
  // 관리자 마스코트: 고정이 아니라 선택 — 아직 안 고른 관리자는 1번을 기본으로 표시.
  const activeMascot = spec.kind === 'mascot' ? spec.n : isAdmin ? 1 : null
  const headerAvatarUrl = isAdmin ? `mascot:${activeMascot ?? 1}` : profile?.avatar_url

  async function saveAvatar(val: string) {
    if (!user) return
    await supabase.from('profiles').update({ avatar_url: val }).eq('id', user.id)
    setProfile((p) => ({ display_name: p?.display_name ?? null, avatar_url: val }))
  }

  async function pickColor(c: string) {
    await saveAvatar(`gem:${c}`)
    setUploadErr('')
    setPicking(false)
  }

  async function pickMascot(n: number) {
    await saveAvatar(`mascot:${n}`)
    setUploadErr('')
    setPicking(false)
  }

  async function pickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    setUploadErr('')
    setUploading(true)
    try {
      const val = await uploadAvatar(user.id, file)
      await saveAvatar(val)
      setPicking(false)
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : t('fab.uploadFail'))
    } finally {
      setUploading(false)
    }
  }


  function go(path: string) {
    setOpen(false)
    setMoreOpen(false)
    navigate(path)
  }

  // 응시 화면(연습 데이터) 바로 진입 — 디자인 확인용. SEB·로그인 없이 열림.
  function goExamPreview() {
    setOpen(false)
    setMoreOpen(false)
    navigate('/exam/run/practice', { state: makePracticeExam() })
  }

  // WORLD ARENA(글로벌 응시 현황) 지도로 이동
  function goArena() {
    setOpen(false)
    setMoreOpen(false)
    navigate('/arena')
  }

  return (
    <>
      {children}

      {!inTest && (
        <>
          <div className={`panel ${open ? 'open' : ''}`}>
            <div className="pf-head">
              <button
                className="pf-ava-btn"
                onClick={() => setPicking((p) => !p)}
                title={t('fab.changeChar')}
              >
                <Avatar avatarUrl={headerAvatarUrl} seed={seedBase} size={52} />
                <span className="pf-ava-badge"><PencilIcon size={11} /></span>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* 닉네임은 여기서 못 고친다 — 변경권이 평생 1회뿐이라 진입점을 마이페이지 하나로 모았다.
                    (서버도 display_name 쓰기를 set-nickname 함수로만 허용한다) */}
                <div className="pf-name">
                  <span className="pf-name-txt">{name}</span>
                </div>
                {!isFullUser ? (
                  <div className="pf-sub">{t('fab.loginhint')}</div>
                ) : null}
                {isFullUser ? (
                  <div className="pf-acct-actions">
                    <button
                      className="pf-acct-btn pf-mypage-btn"
                      onClick={() => go('/mypage')}
                      title={t('nav.mypage')}
                    >
                      {/* 아이콘 크기는 옆 글자 크기(fab.css 의 .pf-mypage-btn)와 맞춘다 */}
                      <UserIcon size={15} />
                      {t('nav.mypage')}
                    </button>
                    <button
                      className="pf-acct-btn pf-logout-btn"
                      onClick={() => {
                        setOpen(false)
                        logout()
                      }}
                      title={t('fab.logout')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      {t('fab.logout')}
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                className="pf-theme"
                onClick={toggleTheme}
                title={dark ? t('fab.light') : t('fab.dark')}
                aria-label={dark ? t('fab.light') : t('fab.dark')}
              >
                {dark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
              </button>
            </div>

            {picking ? (
              <>
                <div className="pf-avatars">
                  {isAdmin ? (
                    // 관리자: 마스코트 3종 중 선택(고정 아님).
                    Array.from({ length: ADMIN_MASCOT_COUNT }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        className={`pf-avatar-opt ${activeMascot === n ? 'on' : ''}`}
                        onClick={() => pickMascot(n)}
                        title={t('fab.changeChar')}
                      >
                        <Avatar avatarUrl={`mascot:${n}`} seed={seedBase} size={38} />
                      </button>
                    ))
                  ) : (
                    <>
                      {isFullUser ? (
                        <button
                          className={`pf-avatar-opt pf-avatar-upload ${spec.kind === 'image' ? 'on' : ''}`}
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          title={t('fab.uploadImg')}
                        >
                          {spec.kind === 'image' ? (
                            <Avatar avatarUrl={profile?.avatar_url} seed={seedBase} size={38} />
                          ) : (
                            <span className="pf-upload-ic">{uploading ? '…' : <CameraIcon size={20} />}</span>
                          )}
                        </button>
                      ) : null}
                      {GEM_COLORS.map((c) => (
                        <button
                          key={c}
                          className={`pf-avatar-opt ${gemColor === c ? 'on' : ''}`}
                          onClick={() => pickColor(c)}
                        >
                          <GemAvatar color={c} size={38} />
                        </button>
                      ))}
                    </>
                  )}
                </div>
                {isFullUser && !isAdmin ? (
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    hidden
                    onChange={pickImage}
                  />
                ) : null}
                {uploadErr ? <div className="pf-upload-err">{uploadErr}</div> : null}
              </>
            ) : null}

            {!isFullUser ? (
              <button className="pf-login" onClick={() => go('/login')}>
                <span>●</span> {t('fab.login_cta')}
              </button>
            ) : null}

            <div className="pf-list">
              <button className="pf-item" onClick={() => go('/')}>
                <span className="ic"><HomeIcon /></span> {t('fab.home')}
              </button>
              <button className="pf-item" onClick={goArena}>
                <span className="ic"><EarthIcon /></span> {t('common.leveltest')}
              </button>
              <button className="pf-item" onClick={() => go('/guide')}>
                <span className="ic"><InfoIcon /></span> {t('nav.caris')}
              </button>
              {/* 랜딩 CTA 3종(WORLD ARENA · CARIS · Learning Library)과 같은 목록·같은 순서로 맞춘다.
                  라벨은 새 키를 만들지 않고 랜딩이 쓰는 landing.cta_learn 을 그대로 재사용(6개국어 동일 문구). */}
              <button className="pf-item" onClick={() => go('/ebooks')}>
                <span className="ic"><BookIcon /></span> {t('landing.cta_learn')}
              </button>
            </div>

            <div className="pf-langwrap">
              <div className="pf-langlabel"><GlobeIcon size={14} /> {t('fab.language')}</div>
              <div className="pf-lang">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    className={lang === l.code ? 'on' : ''}
                    onClick={() => setLang(l.code)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            {isAdmin ? (
              <button
                className="pf-foot-link"
                onClick={() => go('/admin')}
                style={{ width: '100%', marginTop: 14, marginBottom: 8, fontWeight: 700 }}
              >
                <span className="pf-foot-lbl"><ToolIcon size={16} /> {t('fab.admin')}</span>
                <span className="pf-more-caret">›</span>
              </button>
            ) : null}

            <div className="pf-more">
              <button
                className="pf-foot-link"
                onClick={() => setMoreOpen((m) => !m)}
                aria-expanded={moreOpen}
              >
                <span className="pf-foot-lbl"><MoreIcon size={16} /> {t('fab.morebtn')}</span>
                <span className={`pf-more-caret ${moreOpen ? 'on' : ''}`}>›</span>
              </button>
            </div>

            <div className="pf-hint">
              <div className="pf-assoc-en">Global AI &amp; Robotics Association</div>
            </div>
          </div>

          {open && moreOpen ? (
            <div className="pf-more-pop">
              <button className="pf-more-link" onClick={() => go('/notice')}>
                {t('nav.notice')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link" onClick={() => go('/faq')}>
                {t('nav.support')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link" onClick={() => go('/about')}>
                {t('nav.assoc')} <span className="pf-more-ext">↗</span>
              </button>
              {/* 개발/디자인 확인용 미리보기 — 런칭 시 제거 예정(앰버색으로 구분) */}
              {/* 레벨테스트 인증서 시안 — React 라우트가 아니라 정적 HTML(public/cert-preview.html).
                  레벨 1~7 을 버튼으로 넘겨보는 용도라 실데이터 라우트(/test/certificate)와 별도로 유지한다. */}
              <button
                className="pf-more-link pf-preview"
                onClick={() => {
                  setOpen(false); setMoreOpen(false)
                  window.open(`/cert-preview.html?name=${encodeURIComponent(name)}`, '_blank', 'noopener')
                }}
              >
                레벨테스트 인증서 미리보기 <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={() => go('/certificate')}>
                {t('nav.certpreview')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={() => go('/certificate/preview')}>
                {t('nav.certgatepreview')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={() => go('/verify/preview-sample')}>
                진위확인(유효) 미리보기 <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={() => go('/verify/preview-invalid')}>
                진위확인(무효) 미리보기 <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={goExamPreview}>
                {t('nav.exampreview')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={() => go('/exam/result/preview')}>
                {t('nav.resultpasspreview')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link pf-preview" onClick={() => go('/exam/result/preview?demo=fail')}>
                {t('nav.resultfailpreview')} <span className="pf-more-ext">↗</span>
              </button>
              {/* 개인정보처리방침·이용약관은 한국어 법무 문서 — 한국어에서만 노출 */}
              {lang === 'ko' ? (
                <>
                  <button className="pf-more-link" onClick={() => go('/privacy')}>
                    {t('nav.privacy')} <span className="pf-more-ext">↗</span>
                  </button>
                  <button className="pf-more-link" onClick={() => go('/terms')}>
                    {t('nav.terms')} <span className="pf-more-ext">↗</span>
                  </button>
                </>
              ) : null}
            </div>
          ) : null}

          {/* 맨 위로 — FAB이 있는 모든 화면에 함께 노출(응시/SEB에선 FAB과 같이 숨김). 화면 우하단 끝. */}
          <button
            className="fab-top"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label={t('fab.toTop')}
            title={t('fab.toTop')}
          >
            <ChevronUpIcon size={24} />
          </button>

          <button className="fab" onClick={() => setOpen((o) => !o)} aria-label="menu">
            <img
              src="/logo.png"
              alt="CARIS"
              style={{ width: 40, height: 40, borderRadius: '50%' }}
            />
          </button>
        </>
      )}
    </>
  )
}
