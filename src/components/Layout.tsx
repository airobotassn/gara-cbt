import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import type { ChangeEvent, ReactNode } from 'react'
import { useAuth } from '../context/AuthProvider'
import { supabase, callFunction } from '../lib/supabase'
import GemAvatar, { Avatar } from './GemAvatar'
import { GEM_COLORS, parseAvatar, uploadAvatar } from '../lib/avatar'
import { isSEB } from '../lib/seb'
import { useT, LANGS } from '../lib/i18n'
import { makePracticeExam } from '../lib/practice'
import {
  HomeIcon,
  TargetIcon,
  InfoIcon,
  UserIcon,
  SunIcon,
  MoonIcon,
  GlobeIcon,
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
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
  // 응시 화면(/exam/run/:id) + 보안 브라우저(SEB) 안에서만 FAB 숨김(시험 중 이탈 차단).
  // 그 외 모든 페이지는 헤더 없이 FAB이 네비 역할을 한다.
  const inTest = pathname.startsWith('/exam/run/') || isSEB()

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

  async function saveName() {
    const v = draft.trim()
    if (v && user) {
      await supabase.from('profiles').update({ display_name: v }).eq('id', user.id)
      setProfile((p) => ({ avatar_url: p?.avatar_url ?? null, display_name: v }))
    }
    setEditing(false)
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

  // SEMI-CARIS(내부 /test) 로 이동
  function goSemiCaris() {
    setOpen(false)
    setMoreOpen(false)
    navigate('/test/select')
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
                {isAdmin ? (
                  <img className="pf-ava-mascot" src="/admin-mascot.png" alt="" width={52} height={52} />
                ) : (
                  <Avatar avatarUrl={profile?.avatar_url} seed={seedBase} size={52} />
                )}
                <span className="pf-ava-badge"><PencilIcon size={11} /></span>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                {isFullUser && editing ? (
                  <div className="pf-edit-row">
                    <input
                      className="pf-input"
                      value={draft}
                      autoFocus
                      maxLength={20}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName()
                        if (e.key === 'Escape') setEditing(false)
                      }}
                    />
                    <button className="pf-save" onClick={saveName}>
                      ✓
                    </button>
                  </div>
                ) : (
                  <div className="pf-name">
                    <span className="pf-name-txt">{name}</span>
                    {isFullUser ? (
                      <button
                        className="pf-edit"
                        title={t('fab.editName')}
                        onClick={() => {
                          setDraft(profile?.display_name || '')
                          setEditing(true)
                        }}
                      >
                        ✎
                      </button>
                    ) : null}
                  </div>
                )}
                {!isFullUser ? (
                  <div className="pf-sub">{t('fab.loginhint')}</div>
                ) : null}
                {isFullUser ? (
                  <div className="pf-acct-actions">
                    <button
                      className="pf-acct-btn"
                      onClick={() => go('/mypage')}
                      title={t('nav.mypage')}
                    >
                      <UserIcon size={13} />
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
                </div>
                {isFullUser ? (
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
                <span className="ic"><HomeIcon /></span> {t('common.home')}
              </button>
              <button className="pf-item" onClick={goSemiCaris}>
                <span className="ic"><TargetIcon /></span> {t('common.leveltest')}
              </button>
              <button className="pf-item" onClick={() => go('/guide')}>
                <span className="ic"><InfoIcon /></span> {t('nav.caris')}
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
              <Link to="/" style={{ color: 'inherit' }} onClick={() => setOpen(false)}>
                {t('nav.exam')}
              </Link>
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
              <button className="pf-more-link pf-preview" onClick={() => go('/certificate')}>
                {t('nav.certpreview')} <span className="pf-more-ext">↗</span>
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
              alt="GARA"
              style={{ width: 40, height: 40, borderRadius: '50%' }}
            />
          </button>
        </>
      )}
    </>
  )
}
