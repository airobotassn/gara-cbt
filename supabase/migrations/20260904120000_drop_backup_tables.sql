-- 2026-09-04 · 백업 스냅샷 표 15개 드롭
--   위험한 마이그레이션 직전에 `create table as select *` 로 떠 둔 되돌리기용 사본들이다.
--   전부 되돌릴 시점이 지났고(사다리를 그 뒤로 한 번 더 밀었고 문항도 갈아엎었다),
--   무엇보다 ⛔ **RLS 가 꺼진 채 anon 에 SELECT/INSERT/UPDATE/DELETE 권한이 붙어 있어서
--   익명 키만으로 인터넷 누구나 읽고 지울 수 있었다** — 그 안에 문항 정답(correct_index)과
--   회원 개인정보가 들어 있다. `create table as` 는 RLS 를 안 켜므로 public 스키마 기본 grant 가
--   그대로 노출로 이어진다. 앞으로 스냅샷을 뜨면 같은 자리에서 `enable row level security` 도 칠 것.
--
--   드롭 대상(회수 약 22MB):
--     _bak_20260722_*              (7) 첫 사다리 밀기(옛 1~6 → 2~7) 직전 · 20260722090000
--     _bak_20260827_*              (3) 두 번째 밀기(옛 2~5 → 3~6) 직전 · 20260827120000
--     test_questions_backup_20260804   Lv.1~3 5번째 보기 삭제 직전 · 20260804120000
--     _bak_l3_ans5_20260723            위 작업 부속 · 마이그레이션 파일 없이 손으로 뜬 것
--     anon_purge_backup_20260805_* (3) 익명 계정 정리 직전 · 파일 없이 손으로 뜬 것
--                                      ⛔ 이건 정리한 계정의 개인정보라 보관 자체가 문제였다
--
--   ⚠️ 되돌리기 없음. 이 프로젝트는 PITR 이 꺼져 있고 자동 백업도 0건이라 복원 수단이 사라진다
--      (2026-09-04 지시 — 밀기가 일주일째 안정적이고 그 뒤 Lv.2 문항 30개가 새로 들어와
--       스냅샷 시점으로는 어차피 되돌릴 수 없는 상태라 판단).

begin;

drop table if exists _bak_20260722_kb_chunks;
drop table if exists _bak_20260722_question_events;
drop table if exists _bak_20260722_test_answers;
drop table if exists _bak_20260722_test_attempts;
drop table if exists _bak_20260722_test_questions;
drop table if exists _bak_20260722_user_level_skill;
drop table if exists _bak_20260722_user_progress;

drop table if exists _bak_20260827_kb_chunks;
drop table if exists _bak_20260827_question_events;
drop table if exists _bak_20260827_test_questions;

drop table if exists _bak_l3_ans5_20260723;
drop table if exists test_questions_backup_20260804;

drop table if exists anon_purge_backup_20260805_answers;
drop table if exists anon_purge_backup_20260805_attempts;
drop table if exists anon_purge_backup_20260805_profiles;

commit;
