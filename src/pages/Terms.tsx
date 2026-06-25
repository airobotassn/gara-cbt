import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TopBar from '../components/TopBar'
import { useT, type TFunc } from '../lib/i18n'
import { useAuth } from '../context/AuthProvider'
import { supabase } from '../lib/supabase'

const RETENTION_DAYS = 90 // 탈퇴 후 보관기간(이후 purge_deactivated_accounts 로 영구 삭제)

// 회원탈퇴(soft delete): 비활성화 → 보관 → 재로그인 시 복구. 로그인(영구) 유저에게만 노출.
function WithdrawButton({ t }: { t: TFunc }) {
  const { user, isFullUser, logout } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!isFullUser || !user) return null

  async function withdraw() {
    if (busy || !user) return
    if (!window.confirm(t('withdraw.confirm', { d: RETENTION_DAYS }))) return
    setBusy(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ deactivated_at: new Date().toISOString() })
        .eq('id', user.id)
      if (error) throw error
      await logout()
      alert(t('withdraw.done'))
      navigate('/', { replace: true })
    } catch (e) {
      setBusy(false)
      alert(e instanceof Error ? e.message : t('withdraw.failed'))
    }
  }

  return (
    <div style={{ marginTop: 40, paddingTop: 14, borderTop: '1px solid var(--line)', textAlign: 'right' }}>
      <button
        onClick={withdraw}
        disabled={busy}
        title={t('withdraw.desc', { d: RETENTION_DAYS })}
        style={{
          border: 'none',
          background: 'none',
          color: 'var(--dim)',
          fontSize: 12,
          textDecoration: 'underline',
          textUnderlineOffset: 2,
          cursor: busy ? 'default' : 'pointer',
          padding: 0,
        }}
      >
        {busy ? '…' : t('withdraw.button')}
      </button>
    </div>
  )
}

// 글로벌 AI 로봇협회 서비스 이용약관. (개인정보처리방침 Privacy.tsx 와 동일한 doc 패턴)
const ARTICLES: { title: string; lead?: string; items?: string[] }[] = [
  {
    title: '제1조 (목적)',
    lead: '본 약관은 글로벌 AI 로봇협회(이하 "협회")가 제공하는 웹사이트 및 관련 서비스(이하 "서비스")의 이용과 관련하여 "협회"와 이용자(이하 "회원") 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.',
  },
  {
    title: '제2조 (용어의 정의)',
    lead: '본 약관에서 사용하는 용어의 정의는 다음과 같습니다.',
    items: [
      '"서비스"란 "협회"가 운영하는 웹사이트 및 이를 통해 제공하는 일체의 서비스(AI·로봇 지식 자가 테스트, 온라인 교육, 자격 검정 등)를 의미합니다.',
      '"회원"이란 본 약관에 동의하고 Google 로그인을 통해 "서비스" 이용계약을 체결한 자를 의미합니다.',
      '"Google 로그인"이란 Google 계정을 통해 본인 인증 후 "서비스"에 접근하는 방식을 의미합니다.',
    ],
  },
  {
    title: '제3조 (약관의 게시 및 개정)',
    items: [
      '"협회"는 본 약관을 "서비스" 초기 화면 또는 회원가입 화면에 게시합니다.',
      '"협회"는 관련 법령을 위반하지 않는 범위 내에서 본 약관을 개정할 수 있습니다.',
      '약관을 개정하는 경우 적용일자 및 개정 사유를 명시하여 적용일 7일 전부터 공지합니다. "회원"에게 불리한 개정의 경우 30일 전부터 공지합니다.',
      '"회원"이 개정 약관의 적용일 이후에도 "서비스"를 계속 이용하는 경우 개정 약관에 동의한 것으로 봅니다.',
    ],
  },
  {
    title: '제4조 (회원가입 및 로그인)',
    items: [
      '"서비스"는 "Google 로그인"을 통한 "회원"에 한하여 제공됩니다.',
      '"협회"는 Google이 제공하는 범위 내에서 "회원"의 이메일, 이름, 프로필 이미지 등 최소한의 정보만 확인합니다.',
      'Google 계정의 관리 책임은 "회원"에게 있으며, 계정 관리 소홀로 인해 발생하는 손해에 대하여 "협회"는 책임을 지지 않습니다.',
      '다음 각 호에 해당하는 경우 "협회"는 이용 승낙을 거부하거나 이용계약을 해지할 수 있습니다 — (가) 타인의 Google 계정을 도용하여 가입을 신청한 경우, (나) 부정한 용도 또는 "협회"의 정상적인 "서비스" 운영을 방해할 목적으로 신청한 경우.',
    ],
  },
  {
    title: '제5조 (서비스의 제공 및 변경)',
    items: [
      '"협회"는 현재 AI·로봇 관련 자가 테스트 서비스를 제공하며, 향후 온라인 교육 및 자격 검정 서비스를 추가할 예정입니다.',
      '"협회"는 운영상·기술상 필요에 따라 "서비스"의 전부 또는 일부를 변경하거나 종료할 수 있습니다. 이 경우 변경 내용 및 적용일을 사전에 공지합니다.',
      '"협회"는 연중무휴 "서비스" 제공을 목표로 하나, 정기점검·긴급점검·시스템 장애 등의 사유로 "서비스"가 일시 중단될 수 있습니다.',
    ],
  },
  {
    title: '제6조 (개인정보 보호)',
    items: [
      '개인정보의 수집·이용·보관 및 파기는 별도의 개인정보처리방침에 따릅니다.',
      '"협회"는 "서비스" 운영에 필요한 최소한의 정보만 처리하며, "회원"의 동의 없이 제3자에게 제공하지 않습니다. 단, 법령에 의한 경우는 예외로 합니다.',
      '회원 탈퇴 시 개인정보는 개인정보처리방침에 따라 처리됩니다.',
    ],
  },
  {
    title: '제7조 (테스트 및 자격 검정)',
    items: [
      '자가 테스트 결과는 학습 참고 목적이며, 전문적 능력이나 자격을 보장하지 않습니다.',
      '향후 제공될 자격 검정 서비스의 운영 기준 및 인증 효력은 별도 정책으로 정합니다.',
      '"협회"는 부정행위가 확인되는 경우 해당 결과를 취소하고 이용을 제한할 수 있습니다.',
    ],
  },
  {
    title: '제8조 (유료 서비스)',
    items: [
      '유료 서비스 도입 시 결제, 환불 및 취소에 관한 사항은 관련 법령(전자상거래 등에서의 소비자보호에 관한 법률 등)에 따라 별도로 고지합니다.',
      '현재 무료로 제공되는 "서비스"는 사전 공지 후 유료로 전환될 수 있습니다.',
    ],
  },
  {
    title: '제9조 (회원의 의무)',
    lead: '"회원"은 다음 각 호의 행위를 하여서는 안 됩니다.',
    items: [
      '타인의 계정을 사용하거나 부정한 방법으로 로그인하는 행위',
      '자동화 프로그램, 해킹 등 비정상적인 방법으로 "서비스"에 접근하는 행위',
      '테스트 결과 조작, 대리 응시 등 평가의 공정성을 해치는 행위',
      '"서비스" 내 자료를 무단으로 복제, 배포, 판매하거나 저작권을 침해하는 행위',
      '기타 법령 또는 공서양속에 반하는 행위',
    ],
  },
  {
    title: '제10조 (회원자격 제한 및 해지)',
    items: [
      '"협회"는 "회원"이 본 약관을 위반하거나 "서비스" 운영을 방해하는 경우, 사전 통지 후 이용을 제한하거나 회원자격을 박탈할 수 있습니다. 긴급한 경우 이용 제한 또는 회원자격 박탈을 먼저 시행하고 사후 통지할 수 있습니다.',
      '"회원"은 언제든지 "서비스" 내 탈퇴 기능을 이용하거나 Google 계정 연동을 해제함으로써 이용계약을 해지할 수 있습니다.',
    ],
  },
  {
    title: '제11조 (지식재산권)',
    items: [
      '"서비스" 내 교육 자료, 테스트 문항, 콘텐츠 및 운영 시스템에 관한 지식재산권은 "협회" 또는 정당한 권리자에게 귀속됩니다.',
      '"회원"은 "협회"의 사전 서면 동의 없이 "서비스"를 통해 취득한 정보를 영리 목적으로 이용하거나 제3자에게 제공할 수 없습니다.',
    ],
  },
  {
    title: '제12조 (면책)',
    items: [
      '"협회"는 Google 서비스 장애, 통신망 장애, 천재지변 등 불가항력으로 인한 "서비스" 중단에 대하여 책임을 지지 않습니다.',
      '"협회"는 "회원"의 귀책사유로 발생한 손해에 대하여 책임을 지지 않습니다.',
      '"협회"는 "서비스"가 특정 목적에 적합함을 보증하지 않으며, 자가 테스트 결과의 정확성이나 활용 결과에 대한 법적 책임을 지지 않습니다.',
      '무료 서비스와 관련하여 "협회"의 책임은 관련 법령이 허용하는 최대 범위 내에서 제한됩니다.',
    ],
  },
  {
    title: '제13조 (준거법 및 관할)',
    items: [
      '본 약관은 대한민국 법률에 따라 해석됩니다.',
      '"서비스" 이용과 관련하여 발생한 분쟁에 관한 소송은 민사소송법상 관할법원을 전속관할로 합니다.',
    ],
  },
  {
    title: '부칙',
    lead: '본 약관은 "협회"가 공지한 시행일부터 적용됩니다.',
  },
]

export default function Terms() {
  const { t } = useT()

  return (
    <div className="wrap">
      <TopBar />
      <div className="card pad doc">
        <h1 className="doc-title">글로벌 AI 로봇협회 서비스 이용약관</h1>
        {ARTICLES.map((a) => (
          <section className="doc-article" key={a.title}>
            <h2>{a.title}</h2>
            {a.lead ? <p>{a.lead}</p> : null}
            {a.items ? (
              <ul>
                {a.items.map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
        <p className="doc-updated">시행일: [입력 예정]</p>

        <WithdrawButton t={t} />
      </div>
    </div>
  )
}
