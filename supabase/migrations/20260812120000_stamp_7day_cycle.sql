-- 출석 스탬프를 7일 사이클로 바로잡는다 + 7일 완주 보너스.
--  [버그] user_stamps('daily').count 가 **누적만** 했다. 리셋이 없어 8일째부터 화면이 영원히 "7/7" 이고
--         7칸이 전부 체크된 채 고정 — 새 사이클이 시작되지 않았다. 7일차 선물 아이콘은 그려져 있는데
--         보상을 주는 코드도 없었다(그림만 있고 받는 게 없음).
--  [수정] 'daily' = **사이클 위치(1..7)**, 'daily_total' = **총 누적 출석일**(리셋과 무관).
--         7 을 채운 날 코인 보너스(+20)를 준다.
--  · 사이클이 끊겨도 총 누적은 안 무너진다 — 구현계획/제품구상의 "연속 스트릭 ❌ · 누적 스탬프" 결정 그대로.
--  · cosmetic-only 하드 불변식 유지: user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.

-- ── (1) 백필: 기존 count 는 누적값이었다. 총 누적으로 옮겨 보존한 뒤 사이클 위치로 접는다. ──
insert into user_stamps (user_id, stamp_kind, count, updated_at)
select user_id, 'daily_total', count, now()
  from user_stamps
 where stamp_kind = 'daily'
on conflict (user_id, stamp_kind) do nothing;

-- 23회 출석 → 23 = 7*3 + 2 → 사이클 위치 2. 7 의 배수는 7 로 남긴다(막 채운 판을 뺏지 않는다).
update user_stamps
   set count = case when count <= 0 then 0 else ((count - 1) % 7) + 1 end,
       updated_at = now()
 where stamp_kind = 'daily';

-- ── (2) 적립 함수 ──
create or replace function complete_daily_kind(p_uid uuid, p_points int, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_kind text := case when p_kind = 'daily_learn' then 'daily_learn' else 'attendance' end;
  v_att boolean;
  v_lrn boolean;
  v_reward boolean;     -- 오늘 재화 보상을 아직 안 줬는가(출석·학습 통틀어 1회)
  v_kind_first boolean; -- 이 종류가 오늘 처음인가
  v_cycle int;          -- 이번 적립 뒤 사이클 위치(1..7). 보상이 없으면 null.
  v_bonus int := 0;     -- 7일 완주 보너스 코인
  c_cycle_len constant int := 7;
  c_cycle_bonus constant int := 20;  -- ⚠️ 뽑기 1회분(get-hub ECON.drawCost)과 같은 값으로 정한 것
begin
  -- (1) 오늘 행 확보(레벨테스트·미니게임이 이미 만들어 뒀을 수 있다) 후 FOR UPDATE 로 잠근다.
  --     동시 호출은 여기서 직렬화되므로 아래 판정/적립이 원자적이다.
  insert into daily_activity (user_id, day) values (p_uid, v_day)
    on conflict (user_id, day) do nothing;
  select did_attendance, did_learn into v_att, v_lrn
    from daily_activity where user_id = p_uid and day = v_day for update;

  v_kind_first := case when v_kind = 'daily_learn' then not v_lrn else not v_att end;
  v_reward := not (v_att or v_lrn);

  -- (2) 종류 플래그 세팅(멱등).
  update daily_activity
     set did_attendance = did_attendance or (v_kind = 'attendance'),
         did_learn      = did_learn      or (v_kind = 'daily_learn')
   where user_id = p_uid and day = v_day;

  -- (3) 재화 증분 — 절대값이 아니라 원자 증분. 하루 1회.
  if v_reward then
    -- ⚠️ 7 을 찍은 그 자리에서 0 으로 접지 않는다. 그러면 7일째 출석한 사람이 꽉 찬 판을 못 보고
    --    바로 빈 판을 본다. 다음 출석에서 1 로 넘어가며 새 사이클이 열린다.
    select count into v_cycle
      from user_stamps where user_id = p_uid and stamp_kind = 'daily' for update;
    v_cycle := case when coalesce(v_cycle, 0) >= c_cycle_len then 1 else coalesce(v_cycle, 0) + 1 end;

    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily', v_cycle)
      on conflict (user_id, stamp_kind) do update
        set count = v_cycle, updated_at = now();

    -- 총 누적 출석일 — 사이클 리셋과 무관하게 계속 쌓인다.
    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily_total', 1)
      on conflict (user_id, stamp_kind) do update
        set count = user_stamps.count + 1, updated_at = now();

    if v_cycle = c_cycle_len then v_bonus := c_cycle_bonus; end if;

    insert into user_currency (user_id, points) values (p_uid, p_points + v_bonus)
      on conflict (user_id) do update
        set points = user_currency.points + p_points + v_bonus, updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true, 'day', v_day, 'kind', v_kind,
    'first', v_reward,          -- 재화 지급 여부(클라 보상 연출 조건)
    'kind_first', v_kind_first, -- 이 종류를 오늘 처음 완료했는가
    'stamps', v_cycle,          -- 적립 뒤 사이클 위치(1..7)
    'bonus', v_bonus            -- 7일 완주 보너스 코인(0 이면 없음)
  );
end
$$;

revoke all on function complete_daily_kind(uuid, int, text) from public, anon, authenticated;
grant execute on function complete_daily_kind(uuid, int, text) to service_role;
