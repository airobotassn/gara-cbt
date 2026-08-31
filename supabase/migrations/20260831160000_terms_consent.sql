-- 약관 동의 (2026-08-31)
-- 만 14세 미만 아동의 개인정보는 법정대리인 동의 없이 처리할 수 없다(개인정보보호법 §22-2).
-- 우리는 구글 로그인 하나뿐이라 나이를 알 방법이 없어서, **가입 연령을 본인이 확인하는 체크 한 줄**을
-- 로그인 직후 게이트에서 받는다(약관·개인정보처리방침 동의와 한 줄로 묶었다).
--
-- ⛔ **동의는 service role 만 쓴다.** `profiles` 는 테이블 UPDATE 를 회수하고 허용 컬럼만 다시 부여하는
--    화이트리스트 방식이라(`grant update (avatar_url, school_id, deactivated_at)`) 아래 두 컬럼은
--    **자동으로 authenticated 가 못 쓴다.** 그 목록에 절대 추가하지 말 것 — 추가하는 순간
--    브라우저가 체크박스를 누르지 않고도 자기 동의를 직접 써넣을 수 있다.
--
-- ⚠️ `terms_version` 은 **재동의**를 위해 있다. 약관을 고치면 코드의 현재 버전만 올리면 되고,
--    값이 다른 사람에게 게이트가 다시 뜬다. 버전 문자열의 짝은 두 곳이다 —
--    `src/lib/consent.ts` 의 `TERMS_VERSION` ↔ `supabase/functions/agree-terms` 의 같은 상수.
--    한쪽만 올리면 **전원이 매번 다시 동의하게 되거나(화면만 올림) 아무도 안 물어보게 된다(서버만 올림).**
--
-- ⚠️ 동의하지 않은 계정을 지우지 않는다. 실수로 나간 사람과, 결제·자격증 이력이 있는 기존 회원이
--    다친다(결제 원장은 법정 보존 대상이다). 동의 전에는 서비스를 못 쓰는 것으로 충분하다.

alter table public.profiles add column if not exists terms_agreed_at timestamptz;
alter table public.profiles add column if not exists terms_version   text;

-- 미동의 계정을 찾는 쿼리 전용(운영 점검·정리). 대부분의 행은 값이 차므로 부분 인덱스가 작다.
create index if not exists profiles_terms_pending_idx
  on public.profiles (id) where terms_agreed_at is null;
