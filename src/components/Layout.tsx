import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import type { ChangeEvent, ReactNode } from 'react'
import { useAuth } from '../context/AuthProvider'
import { supabase, callFunction } from '../lib/supabase'
import GemAvatar, { Avatar } from './GemAvatar'
import { GEM_COLORS, parseAvatar, uploadAvatar } from '../lib/avatar'
import { isSEB } from '../lib/seb'
import { useT, LANGS } from '../lib/i18n'

export default function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useT()
  const { user, isFullUser, loginWithGoogle, logout } = useAuth()
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
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 응시 화면(/exam/run/:id) + 보안 브라우저(SEB) 안에서는 FAB 숨김 — 시험 중 이탈 차단
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

  // 패널 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null
      if (el?.closest('.panel, .fab, .pf-more-pop')) return
      setOpen(false)
      setMoreOpen(false)
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
                <span className="pf-ava-badge">🎨</span>
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
                <div className="pf-sub">{isFullUser ? user?.email : t('fab.loginhint')}</div>
                {isFullUser ? (
                  <button
                    className="pf-logout"
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
                ) : null}
              </div>
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
                        <span className="pf-upload-ic">{uploading ? '…' : '📷'}</span>
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
              <button className="pf-login" onClick={() => loginWithGoogle()}>
                <span>●</span> {t('fab.login')}
              </button>
            ) : null}

            <div className="pf-list">
              <button className="pf-item" onClick={() => go('/exam')}>
                <span className="ic">📝</span> {t('nav.exam')}
              </button>
              <button className="pf-item" onClick={() => go('/guide')}>
                <span className="ic">ℹ️</span> {t('nav.guide')}
              </button>
              {isFullUser ? (
                <button className="pf-item" onClick={() => go('/mypage')}>
                  <span className="ic">🙋</span> {t('nav.mypage')}
                </button>
              ) : null}
              <button className="pf-item" onClick={() => go('/certificate')}>
                <span className="ic">📜</span> {t('nav.certpreview')}
              </button>
            </div>

            <div className="pf-langwrap">
              <div className="pf-langlabel">🌐 {t('fab.language')}</div>
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
                <span>🛠 {t('fab.admin')}</span>
                <span className="pf-more-caret">›</span>
              </button>
            ) : null}

            <div className="pf-more">
              <button
                className="pf-foot-link"
                onClick={() => setMoreOpen((m) => !m)}
                aria-expanded={moreOpen}
              >
                <span>ⓘ {t('fab.morebtn')}</span>
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
                {t('nav.faq')} <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link" onClick={() => go('/about')}>
                {t('nav.assoc')} <span className="pf-more-ext">↗</span>
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
