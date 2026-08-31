-- 레벨별 캐릭터 크기 (2026-08-31)
--
-- 업로드로 캐릭터를 늘릴 수 있게 만들었더니(20260831140000) 두 가지가 드러났다(실측):
--   ① 그림 발밑에 투명 여백이 12~24% 남아 캐릭터가 무대에서 **떠 있었다**.
--   ② 레벨이 오를수록 인물이 오히려 작게 그려져 있었다(Lv.1 이 캔버스의 75.6%, Lv.7 이 63.9%).
-- ①은 계산이라 **업로드가 자동으로** 잘라낸다(알파 경계까지 트림 → 그림 맨 아래가 곧 발끝).
-- ②는 판단이라 **사람이 정한다** — 그게 이 컬럼이다.
--
-- ⛔ **캐릭터당 하나가 아니라 레벨당 하나다.** 캐릭터 하나에 배율 하나를 두면 "Lv.7 만 작다"를
--    못 고친다(전부 같이 커진다). 처음에 그렇게 만들려다 되돌렸다.
-- ⚠️ **스킨 값을 대체하지 않는다.** 최종 키 = `--skin-char-h × 배율` 이다. 스킨은 "이 배경에서
--    캐릭터가 서는 자리와 기본 키", 배율은 "이 레벨이 그 기준의 몇 배인가"다.
--    ⛔ 배율로 발끝 위치(`--skin-char-bottom`)를 대신하려 들지 말 것 — 그건 배경마다 지평선이
--       달라서 생기는 값이라 캐릭터 속성이 될 수 없다.
-- ⚠️ 값이 없는 레벨은 1 로 친다. 그래서 이 표에 행이 없는 옛 캐릭터는 예전 그대로 그려진다.
-- ⚠️ 업로드가 **초기값을 넣어 준다** — 원본에서 인물이 캔버스의 몇 %를 차지했는지를 그대로 담아
--    (제일 큰 레벨을 1.0 으로 정규화) 원본의 크기 관계를 보존한다. 관리자는 거기서부터 조정한다.
--    안 넣으면 트림 직후 7장이 전부 같은 키가 되어 '자란다'는 사실이 사라진다.

alter table public.hub_char_art
  add column if not exists scales jsonb not null default '{}'::jsonb;

-- 범위를 좁게 묶는다. 열어두면 실수로 0.01 이나 50 이 들어가 캐릭터가 사라지거나 화면을 덮는다.
--   ⚠️ CHECK 로는 못 한다 — jsonb 를 펴서 보려면 서브쿼리가 필요한데 CHECK 제약에는 못 쓴다
--      (`cannot use subquery in check constraint`). 그래서 트리거다.
create or replace function public.hub_char_scales_guard() returns trigger
  language plpgsql as $$
declare k text; v text;
begin
  for k, v in select key, value from jsonb_each_text(new.scales) loop
    if k !~ '^[1-7]$' then
      raise exception 'scales 키는 1~7 이어야 합니다: %', k;
    end if;
    if v !~ '^[0-9]+(\.[0-9]+)?$' or v::numeric < 0.4 or v::numeric > 2.0 then
      raise exception 'Lv.% 크기는 0.4 ~ 2.0 사이여야 합니다: %', k, v;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_hub_char_scales on public.hub_char_art;
create trigger trg_hub_char_scales before insert or update on public.hub_char_art
  for each row execute function public.hub_char_scales_guard();
