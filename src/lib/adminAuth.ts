// 관리자 권한은 이제 서버(admin-questions 'me' 액션)가 판별한다.
//  - 루트 관리자: airobotassn@gmail.com (함수 ROOT_ADMIN, 삭제 불가, 관리자 추가/삭제 가능)
//  - 일반 관리자: DB admin_users 테이블 (루트가 관리자 관리 탭에서 추가/삭제)
// UI 게이트(Admin.tsx)는 'me' 호출 성공 여부로 판단하므로 여기 하드코딩 목록은 더는 쓰지 않는다.
export const ROOT_ADMIN = 'airobotassn@gmail.com'
