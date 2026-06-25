import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import type { ChangeEvent, ReactNode } from 'react'
import { useAuth } from '../context/AuthProvider'
import { supabase, callFunction } from '../lib/supabase'
import GemAvatar, { Avatar } from './GemAvatar'
import { GEM_COLORS, parseAvatar, uploadAvatar } from '../lib/avatar'

export default function Layout({ children }: { children: ReactNode }) {
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
  // 응시 화면(/exam/run/:id)에서는 FAB 숨김 — 시험 중 이탈 차단
  const inTest = pathname.startsWith('/exam/run/')

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

  const name = isFullUser ? profile?.display_name || user?.email || '내 계정' : '게스트'

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
      setUploadErr(err instanceof Error ? err.message : '업로드에 실패했습니다.')
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
                title="캐릭터 변경"
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
                        title="이름 변경"
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
                <div className="pf-sub">{isFullUser ? user?.email : '로그인하면 응시할 수 있어요'}</div>
                {isFullUser ? (
                  <button
                    className="pf-logout"
                    onClick={() => {
                      setOpen(false)
                      logout()
                    }}
                    title="로그아웃"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    로그아웃
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
                      title="이미지 업로드"
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
                <span>●</span> 구글로 로그인
              </button>
            ) : null}

            <div className="pf-list">
              <button className="pf-item" onClick={() => go('/exam')}>
                <span className="ic">📝</span> GARA 자격검정
              </button>
              <button className="pf-item" onClick={() => go('/certificate')}>
                <span className="ic">📜</span> 자격증 미리보기
              </button>
            </div>

            {isAdmin ? (
              <button
                className="pf-foot-link"
                onClick={() => go('/admin')}
                style={{ width: '100%', marginTop: 14, marginBottom: 8, fontWeight: 700 }}
              >
                <span>🛠 관리자 페이지</span>
                <span className="pf-more-caret">›</span>
              </button>
            ) : null}

            <div className="pf-more">
              <button
                className="pf-foot-link"
                onClick={() => setMoreOpen((m) => !m)}
                aria-expanded={moreOpen}
              >
                <span>ⓘ 더보기</span>
                <span className={`pf-more-caret ${moreOpen ? 'on' : ''}`}>›</span>
              </button>
            </div>

            <div className="pf-hint">
              <Link to="/" style={{ color: 'inherit' }} onClick={() => setOpen(false)}>
                GARA 자격검정
              </Link>
              <div className="pf-assoc-en">Global AI &amp; Robotics Association</div>
            </div>
          </div>

          {open && moreOpen ? (
            <div className="pf-more-pop">
              <button className="pf-more-link" onClick={() => go('/about')}>
                협회 소개 <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link" onClick={() => go('/privacy')}>
                개인정보처리방침 <span className="pf-more-ext">↗</span>
              </button>
              <button className="pf-more-link" onClick={() => go('/terms')}>
                이용약관 <span className="pf-more-ext">↗</span>
              </button>
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
