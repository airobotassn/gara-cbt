-- CBT 스키마 정리
-- ⚠️ 코드 배포와 함께 적용할 것:
--    (1) 함수 재배포: start-exam, get-exam-result, submit-exam, admin
--    (2) 프론트 배포(git push) — choices/violation 제거 반영
--    이 SQL의 1·2번(컬럼 개명/제거)은 배포와 거의 동시에 해야 시험이 안 깨짐.

-- 1) questions.options → choices (4지선다 보기)
alter table questions rename column options to choices;

-- 2) exam_attempts.violation_count 제거 (부정 차단은 SEB가 담당)
alter table exam_attempts drop column if exists violation_count;

-- 3) profiles.is_anonymous 제거 + 가입 트리거 정리 (CBT는 익명 응시 없음)
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;
alter table profiles drop column if exists is_anonymous;

-- 4) subject/topic 필수화 (기존 null 백필 후 NOT NULL)
update questions set subject = coalesce(subject, ''), topic = coalesce(topic, '');
alter table questions alter column subject set not null;
alter table questions alter column topic set not null;

-- 참고: 1인1회는 DB unique 대신 start-exam 로직으로 유지(관리자 RETAKE_ALLOW_EMAILS 재응시 예외 때문).
--       멱등성은 submit-exam의 status='in_progress' 확인으로 보장(중복 제출 시 409).
