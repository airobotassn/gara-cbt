-- 오늘의 학습/출석 완료 판정을 '종류(kind)별'로 분리한다.
--  [버그] 기존 complete_daily 는 1/일 가드를 **daily_activity 행 존재**로 판정했다. 그런데 그 행은
--         레벨테스트(submit-test·get-result)·미니게임(submit-minigame)도 만든다(did_leveltest/did_minigame).
--         → 레벨테스트만 해도 그 날 출석/오늘의 학습이 '이미 완료'로 잠기고 재화·스탬프가 지급되지 않았다.
--  [수정] 잠금 = 종류 플래그(did_attendance / did_learn)로 판정. 행 존재는 잠금 근거가 아니다.
--         재화(코인+스탬프) 보상은 기존 경제 그대로 **하루 1회**(출석·학습 중 먼저 한 쪽)로 유지한다
--         — 활동점수(activity_ledger)는 원래대로 종류별로 각각 적립된다(attendance 10 · daily_learn 30).
--  · cosmetic-only 하드 불변식 유지: user_progress / user_level_skill 을 절대 읽거나 쓰지 않는다.
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
    insert into user_currency (user_id, points) values (p_uid, p_points)
      on conflict (user_id) do update
        set points = user_currency.points + p_points, updated_at = now();
    insert into user_stamps (user_id, stamp_kind, count) values (p_uid, 'daily', 1)
      on conflict (user_id, stamp_kind) do update
        set count = user_stamps.count + 1, updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true, 'day', v_day, 'kind', v_kind,
    'first', v_reward,          -- 재화 지급 여부(클라 보상 연출 조건)
    'kind_first', v_kind_first  -- 이 종류를 오늘 처음 완료했는가
  );
end
$$;

revoke all on function complete_daily_kind(uuid, int, text) from public, anon, authenticated;
grant execute on function complete_daily_kind(uuid, int, text) to service_role;

-- 구버전 2-arg 시그니처는 래퍼로 남긴다 — 마이그레이션과 Edge Function 배포 사이의 시차에
-- 옛 complete-daily(2-arg 호출)가 죽지 않게. 오버로드 모호성(default 인자)이 없도록 이름을 분리했다.
create or replace function complete_daily(p_uid uuid, p_points int)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select complete_daily_kind(p_uid, p_points, 'attendance')
$$;

revoke all on function complete_daily(uuid, int) from public, anon, authenticated;
grant execute on function complete_daily(uuid, int) to service_role;
