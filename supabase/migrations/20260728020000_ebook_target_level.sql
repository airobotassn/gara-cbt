-- 이북 추천용 대상 레벨. 레벨테스트 결과창(/test/result)이 응시자 레벨에 맞는 책을 위로 올린다.
--   레벨당 1권(Lv.1~7) 체계라 정수 하나면 충분하다. 책이 한 레벨 안에서 축별로 갈라지면
--   그때 6축 태그(axis_keys)를 추가할 것 — 지금 넣어봐야 고를 대상이 없어 결과가 안 바뀐다.
--   null = 레벨 무관(추천 정렬에서 맨 뒤로 밀린다).
alter table public.ebooks add column if not exists target_level smallint;

alter table public.ebooks drop constraint if exists ebooks_target_level_range;
alter table public.ebooks add constraint ebooks_target_level_range
  check (target_level is null or (target_level between 1 and 7));

-- 기존 책 백필 — 제목이 'Level N STAGE CLEAR' 규칙이라 거기서 뽑는다.
--   (제목 규칙에 기대는 건 이 1회성 백필뿐. 이후에는 관리자 폼에서 직접 고른다.)
update public.ebooks
   set target_level = (substring(title from 'Level\s*([1-7])'))::smallint
 where target_level is null
   and title ~ 'Level\s*[1-7]';
