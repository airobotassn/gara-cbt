-- ============================================================
-- 마이그레이션 v2 → v3 (다국어 + 레벨별 6축 + 레벨별 누적 + 등급 사다리)
-- ⚠️ pre-launch 전용: 기존 문항/응시 데이터는 샘플이라 폐기한다.
--    실유저 데이터가 쌓인 뒤엔 이 파일 대신 ALTER 기반 무손실 마이그레이션을 써야 함.
--
-- 실행 순서:
--   1) 이 파일(migrate_v3.sql)  ← 변경/제거된 테이블 정리
--   2) schema.sql               ← v3 테이블 생성
--   3) seed.sql                 ← 샘플 문항(원하면)
-- profiles 는 유지(auth 연동). attempt_status enum 도 유지(schema.sql 이 if not exists 재사용).
-- ============================================================

-- 제거된 테이블(MMR 누적/티어평균)
drop table if exists tier_avg_profile cascade;
drop table if exists user_skill cascade;

-- 구조가 바뀐 테이블(category enum→text, 문항 다국어 jsonb, attempt 등급 컬럼 등)
drop table if exists attempt_answers cascade;
drop table if exists test_attempts cascade;
drop table if exists questions cascade;

-- 더 이상 쓰지 않는 enum(카테고리는 레벨별 텍스트 코드로 대체)
drop type if exists category cascade;

-- 이후 schema.sql 을 실행하면
--   questions / test_attempts / attempt_answers / user_level_skill / user_progress
-- 가 새로 생성된다.
