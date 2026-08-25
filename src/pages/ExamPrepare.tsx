import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { callFunction, isFunctionCode } from '../lib/supabase'
import { isMobileDevice, getDesktopOS } from '../lib/device'
import MobileBlock from '../components/MobileBlock'
import { SEB_REQUIRED, isSEB, sebConfigured, sebLaunchUrl, sebInstaller } from '../lib/seb'
import { DEFAULT_EXAM_SLUG, RESULT_RELEASE_DAYS } from '../lib/testConfig'
import type { StartExamResponse } from '../lib/types'
import { useT } from '../lib/i18n'
import { getPrepareExam } from '../lib/caris'

const STEP_KEYS = [
  'prep.step_exam',
  'prep.step_guide',
  'prep.step_notice',
  'prep.step_seb',
  'prep.step_menu',
  'prep.step_practice',
  'prep.step_ready',
]

// 국가공인 CBT 형태의 응시 전 단계 플로우 (창을 하나씩 넘기며 진행)
export default function ExamPrepare() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { isFullUser, loginWithGoogle } = useAuth()
  const { t, lang } = useT()
  // 어느 응시권으로 들어왔는지. state 는 마이페이지 카드 클릭 경로, ?ticket= 는 새로고침에도 살아남는 durable 소스.
  const ticketId =
    (location.state as { ticketId?: string } | null)?.ticketId ?? params.get('ticket') ?? ''
  // 결제한 시험 → 안내 표시용 트랙·티어(현재 CARIS-Ⅰ Pro 고정). 결제 연동 시 getPrepareExam 인자 교체.
  const { track: examTrack, tier: examTier } = getPrepareExam(lang)
  const [step, setStep] = useState(0)
  const [agree, setAgree] = useState(false)
  const [practice, setPractice] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  const [err, setErr] = useState('')
  // 재진입 무효 — SEB 를 켜기 전에 여기서 끝낸다. 재시도가 의미 없으므로 안내만 보여준다.
  const [voided, setVoided] = useState(false)
  const [sebNotice, setSebNotice] = useState(false)

  // 준비 화면에 오래(10분) 아무 조작 없이 방치되면(예: SEB 로 나가고 남은 탭) 자동으로 메인으로.
  // 폴링이 아니라 타이머 1개 + 클릭/키 리스너뿐이라 리소스 부담 없음. 조작하면 타이머 리셋 → 진행 중인 사람은 안 쫓겨남.
  useEffect(() => {
    const IDLE_MS = 10 * 60 * 1000
    let id = window.setTimeout(() => navigate('/'), IDLE_MS)
    const reset = () => {
      window.clearTimeout(id)
      id = window.setTimeout(() => navigate('/'), IDLE_MS)
    }
    window.addEventListener('click', reset)
    window.addEventListener('keydown', reset)
    return () => {
      window.clearTimeout(id)
      window.removeEventListener('click', reset)
      window.removeEventListener('keydown', reset)
    }
  }, [navigate])

  // SEB 를 띄운 뒤부터 30초마다 "시험이 시작됐나" 를 묻고, 시작이 확인되면 이 탭을 메인으로 보낸다.
  //
  // ⚠️ **묻는 것 말고 방법이 없다.** SEB 안 페이지는 서버에 "시작했다" 를 보내지만, 바깥 브라우저 탭에는
  //    직접 신호를 못 보낸다(완전히 다른 프로그램이라 저장소도 공유되지 않는다). 서버가 유일한 연결점이고,
  //    서버는 먼저 말을 걸 수 없으니 이쪽에서 물어야 한다.
  // ⚠️ SEB 를 띄우기 전에는 묻지 않는다(sebNotice) — 시작될 리가 없는 동안 부를 이유가 없다.
  // ⚠️ 가벼운 전용 조회(startedCheck)를 쓴다. 목록 조회는 응시권·회차·점검기록까지 훑어 폴링에 못 쓴다.
  useEffect(() => {
    if (!sebNotice || !ticketId) return
    let alive = true
    const ask = () => {
      callFunction<{ started?: boolean }>('my-attempts', { action: 'startedCheck', ticketId })
        .then((r) => { if (alive && r.started) navigate('/') })
        .catch(() => { /* 실패는 무시 — 다음 주기에 다시 묻는다 */ })
    }
    const id = window.setInterval(ask, 30_000)
    return () => { alive = false; window.clearInterval(id) }
  }, [sebNotice, ticketId, navigate])

  if (isMobileDevice()) return <MobileBlock />

  const inSeb = isSEB()
  const inst = sebInstaller(getDesktopOS())
  const isMac = inst.os === 'mac'
  const osLabel = isMac ? 'macOS' : 'Windows'
  const checks = [
    { ok: !isMobileDevice(), label: t('prep.chk_pc') },
    { ok: window.innerWidth >= 1024, label: t('prep.chk_screen') },
    { ok: !!document.fullscreenEnabled, label: t('prep.chk_fs') },
    { ok: navigator.onLine, label: t('prep.chk_net') },
  ]

  // SEB 열기 — 실행 링크에 **일회용 로그인 인계표**를 실어 보낸다.
  //
  // ⚠️ SEB 는 별도 브라우저 프로필이라 여기서 만든 로그인이 안 넘어가고, 그 안에서 구글 로그인도 불가능하다
  //    (SEB 가 외부 사이트를 막고 구글도 이런 브라우저를 거부한다). 표가 없으면 SEB 안에서 응시를
  //    시작할 방법이 아예 없다. 표는 SEB 안에서 시험 전용 토큰으로 교환된다(functions/seb-handoff).
  // ⚠️ ticketId 는 필수다 — 어느 응시권으로 들어가는지 표에 박아야 토큰이 새어도 그 한 장 밖으로 못 나간다.
  // ⚠️ 표는 **매번 새로 받는다**(재사용 금지). 1회용이고 수명도 짧아서, 안내 팝업의 '다시 열기' 가
  //    앞서 쓴 표를 재사용하면 두 번째 클릭이 조용히 실패한다.
  async function openSeb() {
    if (!ticketId) {
      setErr(t('prep.err_no_ticket'))
      return
    }
    setStarting(true)
    try {
      const h = await callFunction<{ nonce: string }>('seb-handoff', { action: 'issue', ticketId })
      setStarting(false)
      // SEB 실행 시도 + 설치/실행 안내 팝업(안 열리면 여기서 바로 설치). SEB 안에선 /exam/seb 로 진입.
      window.location.href = sebLaunchUrl(lang, h.nonce)
      setSebNotice(true)
    } catch (e) {
      setStarting(false)
      // ⛔ 들어갈 수 없는 사유는 **SEB 를 켜기 전에** 여기서 끝난다. 시험 시작에서만 잡으면 SEB 가 켜지고,
      //    잠긴 화면 안에서 안내를 본 뒤 다시 SEB 를 빠져나와야 한다 — 헛걸음이다.
      //    무효 계열만 문의 안내를 붙인다. 정상 제출로 끝난 건(already_done)은 안내할 게 없다.
      if (isFunctionCode(e, 'reentry_blocked') || isFunctionCode(e, 'attempt_voided')) setVoided(true)
      setErr(e instanceof Error ? e.message : t('prep.err_start'))
    }
  }

  async function startExam() {
    if (!isFullUser) {
      localStorage.setItem('examIntent', '1')
      loginWithGoogle(`${window.location.origin}/auth/callback?next=${encodeURIComponent('/exam/prepare')}`)
      return
    }
    if (!agree || starting) return
    setErr('')

    // 보안 브라우저가 필요한데 일반 브라우저면 → SEB 로 시험 열기
    if (SEB_REQUIRED && !inSeb) {
      if (!sebConfigured()) {
        setErr(t('prep.err_seb_not_ready'))
        return
      }
      await openSeb()
      return
    }

    setStarting(true)
    try {
      try {
        await document.documentElement.requestFullscreen?.()
      } catch {
        /* 무시 */
      }
      // ⚠️ ticketId 를 반드시 실어보낸다. 같은 회차에서 여러 급수를 접수할 수 있어서(2026-08 결정)
      //    응시권이 2장 이상이면 서버가 어느 걸 쓸지 몰라 409 pick_ticket 으로 튕긴다.
      //    그 상태에서 고를 화면이 없으면 **돈은 다 냈는데 어느 시험도 시작 못 하는** 상태가 된다.
      //    값은 마이페이지 응시권 카드 → navigate state, 또는 URL ?ticket= 로 들어온다.
      // ⚠️ lang 은 **응시 언어**다 — 서버가 이 값으로 문항을 투영하고 exam_attempts.lang 에 못박는다.
      //    빠뜨리면 서버 기본값(ko)이라 외국어 사용자가 한국어 시험지를 받는다.
      const res = await callFunction<StartExamResponse>('start-exam', {
        examSlug: DEFAULT_EXAM_SLUG,
        lang,
        ...(ticketId ? { ticketId } : {}),
      })
      navigate(`/exam/run/${res.attemptId}`, { state: res })
    } catch (e) {
      setStarting(false)
      setErr(e instanceof Error ? e.message : t('prep.err_start'))
    }
  }

  const last = step === STEP_KEYS.length - 1

  return (
    <div className="exam-center">
      {sebNotice && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setSebNotice(false)}>
          <div className="bg-surface-container-lowest rounded-2xl p-6 md:p-7 max-w-sm w-full ambient-shadow" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-5">
              <div className="w-14 h-14 rounded-full bg-primary-container/10 text-primary-container flex items-center justify-center mx-auto mb-3">
                <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>security</span>
              </div>
              <h3 className="font-title-md text-title-md font-bold text-on-surface mb-1.5">{t('gate.seb_opened_q')}</h3>
              <p className="font-body-md text-body-md text-on-surface-variant break-keep">{t('gate.seb_opened_desc')}</p>
            </div>
            {/* 실행이 주 동작(재실행), 다운로드는 미설치일 때만 쓰는 보조 동작 */}
            <div className="flex flex-col gap-2.5">
              {/* ⚠️ 여기서도 openSeb() 을 부른다 — 인계표는 1회용·단명이라 앞서 만든 걸 다시 쓰면 조용히 실패한다. */}
              <button onClick={() => { void openSeb() }} className="w-full bg-primary-container text-on-primary font-title-md text-title-md font-bold px-6 py-3 rounded-xl ambient-shadow inline-flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[20px]">lock_open</span>
                {t('seb.launch_btn')}
              </button>
              {/* 미설치일 때만 쓰는 보조 버튼 — 라벨·용량·경고 팁을 버튼 안 여러 줄로 */}
              <a href={inst.url} target="_blank" rel="noreferrer" className="group w-full border border-outline-variant hover:border-primary-container rounded-xl px-5 py-3 flex flex-col items-center gap-0.5 text-center transition-colors">
                <span className="inline-flex items-center gap-2 font-label-md text-label-md font-bold text-on-surface group-hover:text-primary-container break-keep">
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  {t('seb.download')}
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">{osLabel} · {inst.size}</span>
                <span className="font-label-sm text-label-sm text-on-surface-variant break-keep">{t('seb.warn_title')}</span>
              </a>
            </div>
            <button className="mt-4 w-full text-on-surface-variant hover:text-primary-container font-label-md text-label-md py-1.5 transition-colors" onClick={() => setSebNotice(false)}>{t('common.close')}</button>
          </div>
        </div>
      )}
      <div className="prep">
        <ol className="prep-steps">
          {STEP_KEYS.map((s, i) => (
            <li key={s} className={`${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`}>
              <span className="prep-no">{i < step ? '✓' : i + 1}</span>
              <span className="prep-label">{t(s)}</span>
            </li>
          ))}
        </ol>

        <div className="prep-body">
          <h2 className="prep-title">{t(STEP_KEYS[step])}</h2>

          {/* 0. 검정 안내 — 결제한 시험(디폴트 CARIS-Ⅰ Pro)의 /guide 팩트: 과목·시험 구성·합격 기준 */}
          {step === 0 && (
            <div className="prep-text">
              <p>{t('prep.exam_lead', { exam: `${examTrack.name} ${examTier.name}` })}</p>
              {examTier.target && (
                <>
                  <h4 className="prep-sub">{t('caris.lbl.target')}</h4>
                  <p>{examTier.target}</p>
                </>
              )}
              <h4 className="prep-sub">{t('caris.lbl.subjects')}</h4>
              <ul>
                {examTier.subjects.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <dl className="prep-facts">
                <dt>{t('caris.lbl.format')}</dt>
                <dd>{examTier.format ?? examTier.method ?? '-'}</dd>
                {examTier.practical && (
                  <>
                    <dt>{t('caris.lbl.practical')}</dt>
                    <dd>{examTier.practical}</dd>
                  </>
                )}
                <dt>{t('caris.lbl.pass')}</dt>
                <dd>{examTier.pass}</dd>
              </dl>
            </div>
          )}

          {/* 1. 안내사항 */}
          {step === 1 && (
            <div className="prep-text">
              <p>{t('prep.guide_lead')}</p>
              <ul>
                <li>{t('prep.guide_li2')}</li>
                <li>{t('prep.guide_li3', { d: RESULT_RELEASE_DAYS })}</li>
                <li>{t('prep.guide_li4')}</li>
              </ul>
            </div>
          )}

          {/* 2. 유의사항 */}
          {step === 2 && (
            <div className="prep-text">
              <p>{t('prep.notice_lead')}</p>
              <ul>
                <li>{t('prep.notice_li3')}</li>
                <li>{t('prep.notice_li4')}</li>
                <li>{t('prep.notice_li5')}</li>
              </ul>
              <p>{t('prep.af_lead')}</p>
              <ul>
                <li>{t('prep.af1')}</li>
                <li>{t('prep.af2')}</li>
                <li>{t('prep.af3')}</li>
                <li>{t('prep.af4')}</li>
                <li>{t('prep.af5')}</li>
                <li>{t('prep.af13')}</li>
                <li>{t('prep.af6')}</li>
                <li>{t('prep.af7')}</li>
                <li>{t('prep.af8')}</li>
                <li>{t('prep.af9')}</li>
                <li>{t('prep.af10')}</li>
                <li>{t('prep.af11')}</li>
                <li>{t('prep.af12')}</li>
              </ul>
            </div>
          )}

          {/* 3. 보안 프로그램 설치 — /exam/check(SebInstall)와 동일 정보 구조(설명→버튼→라벨:값→경고 문장) */}
          {step === 3 && (
            <div className="prep-text">
              {inSeb ? (
                <div className="prep-seb-ok">{t('prep.seb_running')}</div>
              ) : (
                <>
                  <p>{t('check.sec1_desc')}</p>
                  <a
                    className="exam-btn"
                    href={inst.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '4px 0 18px' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>download</span>
                    {t('seb.download')}
                  </a>
                  <dl className="prep-facts">
                    <dt>{t('seb.fact_program')}</dt>
                    <dd>Safe Exam Browser ({osLabel})</dd>
                    <dt>{t('seb.fact_maker')}</dt>
                    <dd>{t('seb.fact_maker_v')}</dd>
                    <dt>{t('seb.fact_install')}</dt>
                    <dd>{t('seb.chip_once')} · {t('seb.chip_size', { size: inst.size })}</dd>
                  </dl>
                  <div className="prep-sebwarn">
                    <b>{isMac ? t('seb.warn_title') : t('seb.warn_title_win', { dialog: t('seb.dialog_title') })}</b>
                    {isMac ? (
                      <p>{t('seb.step2_d_mac')}</p>
                    ) : (
                      <p>
                        {t('seb.warn_body_pre')} <span className="prep-kbd">{t('seb.dialog_more')}</span> →{' '}
                        <span className="prep-kbd strong">{t('seb.dialog_run')}</span> {t('seb.warn_body_post')}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 4. 메뉴 설명 */}
          {step === 4 && (
            <div className="prep-text">
              <p>{t('prep.menu_lead')}</p>
              <ul>
                <li>{t('prep.menu_li1')}</li>
                <li>{t('prep.menu_li2')}</li>
                <li>{t('prep.menu_li3')}</li>
                <li>{t('prep.menu_li5')}</li>
              </ul>
            </div>
          )}

          {/* 5. 문제풀이 연습 + 환경 점검 */}
          {step === 5 && (
            <div className="prep-practice">
              <h4 className="prep-sub">{t('prep.check_title')}</h4>
              <ul className="check-list" style={{ marginBottom: 18 }}>
                {checks.map((c) => (
                  <li key={c.label} className={c.ok ? 'ok' : 'no'}>
                    <span className="ic">{c.ok ? '✓' : '✕'}</span>
                    <span className="lab">{c.label}</span>
                    <span className="note">{c.ok ? t('prep.check_ok') : t('prep.check_no')}</span>
                  </li>
                ))}
                <li className={inSeb ? 'ok' : 'info'}>
                  <span className="ic">{inSeb ? '✓' : 'ℹ'}</span>
                  <span className="lab">{t('prep.chk_seb')}</span>
                  <span className="note">{inSeb ? t('prep.chk_seb_running') : t('prep.chk_seb_info')}</span>
                </li>
              </ul>

              <h4 className="prep-sub">{t('prep.sample_title')}</h4>
              <p className="prep-note">{t('prep.sample_note')}</p>
              <div className="prep-sample">
                <div className="prep-sample-q">
                  <span className="prep-sample-no">{t('prep.sample_eg')}</span>
                  {t('prep.sample_q')}
                </div>
                <div className="cbt-opts">
                  {[
                    t('prep.sample_opt1'),
                    t('prep.sample_opt2'),
                    t('prep.sample_opt3'),
                    t('prep.sample_opt4'),
                  ].map((opt, i) => (
                    <button
                      key={i}
                      className={`cbt-opt ${practice === i ? 'sel' : ''}`}
                      onClick={() => setPractice(i)}
                    >
                      <span className="cbt-opt-no">{i + 1}</span>
                      <span className="cbt-opt-lab">{opt}</span>
                    </button>
                  ))}
                </div>
                {practice !== null && (
                  <div className={`prep-sample-fb ${practice === 0 ? 'ok' : 'no'}`}>
                    {practice === 0 ? t('prep.sample_fb_ok') : t('prep.sample_fb_no')}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. 시험 준비 완료 */}
          {step === 6 && (
            <div className="prep-text">
              <p>{t('prep.ready_lead')}</p>
              <ul>
                <li>{t('prep.ready_li1')}</li>
                <li>{t('prep.ready_li2')}</li>
              </ul>
              <label className="prep-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>{t('prep.agree')}</span>
              </label>
              {!isFullUser && <p className="prep-warn">{t('prep.login_warn')}</p>}
              {err && <p className="prep-warn">{err}</p>}
              {/* 무효는 다시 눌러도 같은 답이 온다 — 사유와 문의 경로를 그 자리에서 알려준다. */}
              {voided && (
                <p className="font-body-md text-body-md text-on-surface-variant" style={{ marginTop: 8, lineHeight: 1.65 }}>
                  {t('seb.voided_how')}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="prep-foot">
          <button
            className="exam-btn-ghost"
            disabled={step === 0 || starting}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            {t('prep.prev')}
          </button>
          {!last ? (
            <button className="exam-btn" onClick={() => setStep((s) => s + 1)}>
              {t('prep.next')}
            </button>
          ) : (
            <button className="exam-btn" disabled={(!agree && isFullUser) || starting} onClick={startExam}>
              {starting ? t('prep.starting') : isFullUser ? t('prep.start') : t('prep.start_login')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
