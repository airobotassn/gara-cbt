-- 랭킹 더미 캐릭터를 **그림이 있는 계열(a)** 로 (2026-08-26)
--
-- 왜: 시드는 6종(a·b·c × 남·여)에서 고르게 뿌리는데 **그림은 a 남·여 2종만 들어와 있다**
--     (b·c 는 시트가 없어 `20260826170000` 에서 진열도 내렸다). 그래서 더미 3분의 2가
--     남의 방·공유 카드에서 폴백 한 장(옛 한복 소녀)으로 떴다 — 성별도 레벨도 무시되고
--     전부 같은 그림이라, 전세계 1위와 17점짜리가 나란히 같은 얼굴이었다.
--
-- ⚠️ **성별은 지킨다** — 남자 키였던 더미가 여자 그림으로 바뀌면 그건 고친 게 아니라 뒤집은 것이다.
-- ⚠️ 레벨은 손댈 게 없다. 캐릭터 그림의 레벨은 저장값이 아니라 **시즌 총점 파생**이라
--    (`arenaLevelForScore` → `char/<키>/lv<N>.webp`) 그림만 있으면 점수에 맞는 장이 저절로 뜬다.
-- ⚠️ **실회원은 안 건드린다.** 남이 고른 캐릭터를 우리가 갈아입히는 건 몰수다 — 진열을 내려도
--    이미 가진 사람은 그대로 입는다는 규칙(`20260826170000`)과 같은 이유다.
-- ⚠️ b·c 시트가 도착하면 이 함수를 걷어내고 `seed_ranking_dummies()` 를 다시 돌리면 6종으로 돌아간다.
-- ⚠️ **재시드하면 이 함수도 한 번 더 부를 것** — 배경(`assign_ranking_dummy_skins()`)과 같은 짝이다.
create or replace function public.assign_ranking_dummy_characters()
returns int language plpgsql as $$
declare v_n int;
begin
  update ranking_dummies
     set character_key = case when right(character_key, 2) = '_f' then 'char_a_f' else 'char_a_m' end
   where character_key is distinct from
         (case when right(character_key, 2) = '_f' then 'char_a_f' else 'char_a_m' end);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.assign_ranking_dummy_characters() from public, anon, authenticated;

select public.assign_ranking_dummy_characters();
