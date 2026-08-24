-- 이북 열람 기록 — "샀는데 실제로 열어봤나" 를 관리자가 본다. 용도는 **환불 판단** 하나다.
--
-- ⛔ 왜 ebook_purchases 에 컬럼을 붙이지 않았나:
--    환불이 나면 revokeForRefund 가 그 사람의 열람권 행을 **지운다**(_shared/payments.ts).
--    열람 시각을 그 행에 두면 환불하는 순간 "읽었다"는 기록이 같이 증발해서,
--    ① 환불 뒤에 말이 바뀌는 분쟁에 댈 근거가 없고
--    ② **사서 읽고 환불하기를 반복하는 사람**을 알아볼 방법이 사라진다(구매도 열람도 매번 지워지니까).
--    그래서 구매와 수명을 분리한 별도 표로 둔다 — 환불해도, 다시 사도 이 표는 이어진다.
--
-- ⚠️ 이 기록만으로 환불을 거절할 수는 없다. 디지털 콘텐츠의 청약철회 제한은 **미리 고지**해야 효력이 있어서
--    /terms 의 이북 청약철회 제한 문구가 선행이다(CLAUDE.md 의 '실키 심사 전 채워야 하는 것' 참고).
--    이 표는 그 문구가 있을 때 근거가 되는 사실기록이다.
--
-- 기록 시점 = ebooks 함수의 read 액션이 서명 URL 을 **발급하는 데 성공한** 순간.
-- 클라이언트가 건너뛸 수 없는 유일한 길목이라 값이 믿을 만하다. 다만 "열었다"까지만 말한다 —
-- 어디까지 읽었는지(진도율)는 여기 없다.

create table if not exists public.ebook_reads (
  -- 사람이 탈퇴하면 그 사람 기록은 지운다(본인 것이라 보관할 근거가 없다).
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- 이북을 지우면 구매 기록도 같이 지워지는 게 기존 동작이라(ebook_purchases cascade) 여기도 맞춘다.
  ebook_id      uuid not null references public.ebooks(id) on delete cascade,
  first_read_at timestamptz not null default now(),
  last_read_at  timestamptz not null default now(),
  -- 열어본 횟수. 한 번 3초 열어본 것과 열 번 나눠 읽은 것이 갈려야 사람이 판단할 수 있다.
  read_count    integer not null default 1 check (read_count > 0),
  primary key (user_id, ebook_id)
);

-- ⚠️ RLS 켜고 정책은 부여하지 않는다 = service role(엣지 함수) 전용. ebook_purchases 와 같은 취급이다.
--    사용자가 직접 쓸 수 있으면 "안 읽었다"로 조작할 수 있어 환불 근거로서 값이 죽는다.
alter table public.ebook_reads enable row level security;

-- 관리자 화면이 "이 책을 산 사람들이 읽었나"를 책 단위로 훑는다(구매자 목록).
create index if not exists ebook_reads_book_idx on public.ebook_reads (ebook_id);

comment on table public.ebook_reads is
  '이북 열람 기록(사람×책). 환불되어도 남는다 — 환불 판단·반복 환불 추적용.';

-- 열람 1회 기록. insert 아니면 갱신.
--   ⚠️ **10분 안의 재호출은 횟수를 올리지 않는다.** 뷰어는 새로고침·언어 전환·서명 URL 재발급 때마다
--      read 를 다시 부르는데, 그걸 다 세면 한 번 앉아서 읽은 것이 "12번 열람"으로 부풀어
--      정확히 판단에 쓰려던 숫자가 판단을 왜곡한다. 마지막 열람 시각은 그래도 매번 갱신한다.
create or replace function public.ebook_mark_read(p_user uuid, p_ebook uuid)
returns void
language sql
set search_path = public
as $$
  insert into ebook_reads (user_id, ebook_id)
  values (p_user, p_ebook)
  on conflict (user_id, ebook_id) do update
    set last_read_at = now(),
        read_count = ebook_reads.read_count
          + case when now() - ebook_reads.last_read_at > interval '10 minutes' then 1 else 0 end;
$$;
