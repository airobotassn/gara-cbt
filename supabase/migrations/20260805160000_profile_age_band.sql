-- ============================================================
-- 연령대(age_band) — 온보딩(지역 확정 화면)에서 지역과 함께 1회 수집.
--   · 값은 **밴드뿐**: '10s'(10대 이하) ~ '60s'(60대 이상) + 'private'(공개 안 함).
--     생년월일·정확한 나이는 받지 않는다(통계 집계용).
--   · 'private' 도 '답했다'로 친다 — null 일 때만 온보딩 게이트가 다시 묻는다.
--     (공개 안 함을 null 로 저장하면 매번 다시 묻게 되어 거부 의사를 무시하는 꼴이 된다.)
--   · 지역과 달리 **잠그지 않는다**(나이는 해마다 바뀐다). 다만 쓰기는 service role(set-region)만 —
--     profiles 의 authenticated UPDATE 허용 컬럼(avatar_url·school_id·deactivated_at)에 넣지
--     않으므로 클라이언트 직접 쓰기는 자동으로 막힌다.
--   멱등(재실행 안전).
-- ============================================================

alter table profiles add column if not exists age_band text;

alter table profiles drop constraint if exists profiles_age_band_chk;
alter table profiles add constraint profiles_age_band_chk
  check (age_band is null or age_band in ('10s', '20s', '30s', '40s', '50s', '60s', 'private'));

-- 집계용 부분 인덱스(탈퇴자 제외) — 지역·국가 인덱스와 같은 패턴.
create index if not exists profiles_age_band_idx on profiles (age_band) where deactivated_at is null;
