/**
 * 독려 메일 세 벌의 정의 — 메일 관리 화면(기본 문구 편집)과 메일 창(보내기)이 **같은 표**를 본다(2026-09-22).
 * 두 벌이면 치환자 하나를 늘릴 때 한쪽만 늘어나서, 화면엔 있는데 안 채워지는 치환자가 생긴다.
 *   · subjectKey/bodyKey = site_settings 의 키(기본 문구가 거기 산다).
 *   · vars = 본문에 쓸 수 있는 치환자와 설명. `{name}` 은 서버가 이름으로 채우고, 나머지는 화면이 사람마다 값을 보낸다.
 *   · ad = 광고성 여부. 광고성이면 서버가 광고 수신 동의자에게만 보낸다(`mailNudge`).
 */
export type MailKind = 'nudge_leveltest' | 'nudge_env_check' | 'nudge_ticket'
export interface MailTemplateDef {
  kind: MailKind
  title: string
  where: string
  subjectKey: string
  bodyKey: string
  vars: [string, string][]
  /** 미리보기에 채울 예시 값(치환자 → 값). `{name}` 은 공통. */
  sample: Record<string, string>
  ad: boolean
}
export const MAIL_TEMPLATES: MailTemplateDef[] = [
  {
    kind: 'nudge_leveltest', title: '레벨테스트 독려', where: 'WORLD ARENA › 레벨테스트 › 응시자',
    subjectKey: 'mail_leveltest_subject', bodyKey: 'mail_leveltest_body',
    vars: [['{name}', '이름'], ['{level}', '현재 레벨등급'], ['{link}', '레벨테스트 주소']],
    sample: { '{level}': 'Lv.3', '{link}': 'https://garacaris.com/test/select' }, ad: true,
  },
  {
    kind: 'nudge_env_check', title: '시험환경 점검 독려', where: 'CARIS › CARIS 현황 › 시험환경 점검',
    subjectKey: 'mail_nudge_subject', bodyKey: 'mail_nudge_body',
    vars: [['{name}', '응시자 이름'], ['{round}', '회차명'], ['{tier}', '급수'], ['{examDate}', '시험일'], ['{link}', '응시 안내 주소']],
    sample: { '{round}': '제 5회 CARIS', '{tier}': 'Beginner', '{examDate}': '2026-11-28', '{link}': 'https://garacaris.com/exam' }, ad: false,
  },
  {
    kind: 'nudge_ticket', title: '응시 마감 임박 안내', where: 'CARIS › CARIS 현황 › 접수·응시권 › 미사용자 메일',
    subjectKey: 'mail_ticket_subject', bodyKey: 'mail_ticket_body',
    vars: [['{name}', '이름'], ['{round}', '회차명'], ['{tier}', '급수'], ['{examEnd}', '응시 마감'], ['{link}', '응시 안내 주소']],
    sample: { '{round}': '제 5회 CARIS', '{tier}': 'Beginner', '{examEnd}': '2026. 11. 30. 23:59', '{link}': 'https://garacaris.com/exam' }, ad: false,
  },
]
export const mailTemplate = (kind: MailKind): MailTemplateDef => MAIL_TEMPLATES.find((t) => t.kind === kind)!
