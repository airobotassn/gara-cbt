-- 의견함 첨부파일 — 캡처 이미지뿐 아니라 PPT·PDF 로 정리해 보내는 사람까지 받는다(2026-08-26 지시).
--
-- ⛔ **비로그인이 쓰는 화면이라 '브라우저가 Storage 에 직접 올린다' 를 그냥 열면 안 된다.**
--    그러려면 storage.objects 에 anon insert 정책을 줘야 하는데, 그 순간 우리 스토리지는
--    가드 없는 무제한 업로드 엔드포인트가 된다(느린 회선의 봇 하나면 요금이 그쪽으로 간다).
--    그래서 **엣지 함수(service role)가 경로 하나짜리 서명 업로드 URL 을 발급**하고 브라우저는
--    그 URL 로만 올린다. 버킷에는 정책이 하나도 없다 = 서명 토큰 말고는 들어갈 길이 없다.
--    (버킷·정책은 마이그레이션이 아니라 supabase/storage-buckets.sql 에 있다 — storage 스키마는
--     pglite 에 없어서 섞으면 test:db 가 통째로 죽는다.)
--
-- ⚠️ 그래도 발급 자체는 로그인 없이 부를 수 있으므로 **발급을 세는 표가 하나 필요하다**(feedback_uploads).
--    이 표가 하는 일 셋: ① 도배 바닥선 ② 제출할 때 "그 경로가 정말 이 사람이 방금 올린 것인가" 확인
--    ③ 올려놓고 안 보낸 고아 파일 목록.

-- ─────────────────────────────────────────────────────────────
-- (1) 의견에 붙은 첨부 목록
--     ⚠️ **경로 문자열만 두지 않는다** — 원래 파일 이름·크기를 같이 박아야 관리자 화면이
--        'a3f9…webp' 가 아니라 '오탈자정리.pptx (2.1MB)' 로 읽힌다. 스토리지 경로는 uuid 라
--        그 자체로는 사람에게 아무 말도 안 한다.
-- ─────────────────────────────────────────────────────────────
alter table public.feedbacks
  add column if not exists files jsonb not null default '[]'::jsonb;

alter table public.feedbacks drop constraint if exists feedbacks_files_shape;
alter table public.feedbacks add constraint feedbacks_files_shape check (
  jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 3
);

-- ─────────────────────────────────────────────────────────────
-- (2) 발급 원장
--     ⚠️ feedback_id 가 **null 인 행 = 올려놓고 안 보낸 파일**이다. 지우는 크론은 아직 없다 —
--        지금은 이 표가 그 목록을 들고 있는 것까지고, 청소는 사람이 돌리거나 나중에 크론을 얹는다.
--     ⚠️ 의견이 지워지면 이 행도 같이 지운다(cascade). 스토리지 파일 삭제는 SQL 이 못 하므로
--        관리자 함수(feedbackDelete)가 지우기 **전에** 경로를 읽어 스토리지부터 비운다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.feedback_uploads (
  id uuid primary key default gen_random_uuid(),
  -- 발급받은 사람. 원본 IP 가 아니라 날짜 소금 해시다(feedbacks.ip_hash 와 같은 값).
  ip_hash text not null,
  -- 버킷 안 경로. 발급 때 서버가 정하는 값이라 클라가 못 고른다.
  path text not null unique,
  -- 사람이 고른 원래 파일 이름·크기. 관리자 화면·엑셀이 이걸 보여준다.
  name text not null,
  size bigint not null,
  feedback_id uuid references public.feedbacks(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint feedback_uploads_size_chk check (size > 0 and size <= 20971520),
  constraint feedback_uploads_name_chk check (
    regexp_replace(name, '[[:space:]]', '', 'g') <> '' and length(name) <= 200
  )
);

create index if not exists feedback_uploads_iprate_idx on public.feedback_uploads (ip_hash, created_at desc);
create index if not exists feedback_uploads_orphan_idx on public.feedback_uploads (created_at) where feedback_id is null;

alter table public.feedback_uploads enable row level security;
-- 정책 없음 = service role(엣지 함수) 전용. feedbacks 와 같은 이유다.

-- ─────────────────────────────────────────────────────────────
-- (3) 업로드 자리 잡기 — 서명 URL 을 발급하기 **전에** 이 함수가 통과해야 한다.
--     ⚠️ 세고 넣는 걸 엣지 함수 쪽 select→insert 로 짜면 동시 요청이 나란히 통과한다.
--        feedback_post 와 같은 방식으로 advisory lock 안에서 센다.
--     ⚠️ 상한은 넉넉하다 — 검수자가 화면을 훑으며 캡처를 연달아 붙이는 게 정상 사용이다.
--        봇이 스토리지를 창고로 쓰는 걸 막는 바닥선이지 정교한 방어가 아니다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.feedback_upload_claim(
  p_ip_hash text,
  p_path    text,
  p_name    text,
  p_size    bigint
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_cnt   int;
  v_bytes bigint;
begin
  if coalesce(p_ip_hash, '') = '' then
    raise exception 'no_ip';
  end if;

  perform pg_advisory_xact_lock(hashtext('fbup:' || p_ip_hash));

  -- 건수 바닥선(10분 15건). 한 건에 3개까지라 정상 사용은 5건 연속 제출까지 여유가 있다.
  select count(*) into v_cnt
    from feedback_uploads u
   where u.ip_hash = p_ip_hash
     and u.created_at > now() - interval '10 minutes';
  if v_cnt >= 15 then
    raise exception 'too_many';
  end if;

  -- 용량 바닥선(하루 400MB). 건수만 세면 20MB 짜리 15개가 그대로 통과한다.
  select coalesce(sum(u.size), 0) into v_bytes
    from feedback_uploads u
   where u.ip_hash = p_ip_hash
     and u.created_at > now() - interval '1 day';
  if v_bytes + p_size > 419430400 then
    raise exception 'too_big';
  end if;

  insert into feedback_uploads (ip_hash, path, name, size)
  values (p_ip_hash, p_path, p_name, p_size)
  returning id into v_id;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- (4) feedback_post 에 첨부를 얹는다.
--     ⛔ **인자를 늘리며 기본값을 주면 안 된다** — 6인자 옛 함수가 남아 있으면 7인자 호출이
--        모호해져(`function is not unique`) 접수가 통째로 죽는다. 옛 것을 지우고 새로 만든다.
--     ⛔ **클라가 보낸 이름·크기를 그대로 믿지 않는다.** 경로만 받고 이름·크기는 발급 원장에서
--        다시 읽는다 — 안 그러면 '3KB 짜리 캡처' 라고 적힌 200MB 파일이 목록에 뜬다.
-- ─────────────────────────────────────────────────────────────
drop function if exists public.feedback_post(uuid, text, text, text, text, text);

create or replace function public.feedback_post(
  p_user    uuid,
  p_ip_hash text,
  p_org     text,
  p_name    text,
  p_path    text,
  p_body    text,
  p_files   text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_cnt   int;
  v_files jsonb;
  v_org  text := regexp_replace(p_org,  '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_path text := regexp_replace(p_path, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_body text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  perform pg_advisory_xact_lock(hashtext(coalesce(p_ip_hash, '')));

  -- 첨부 목록은 **발급 원장에서** 만든다. 이 IP 가 실제로 발급받은 경로만 걸리므로
  -- 남의 경로나 없는 경로를 적어 보내도 조용히 빠진다.
  -- ⚠️ 화면에 붙인 순서를 지킨다 — created_at 으로 정렬하면 사용자가 3번째로 붙인 게 1번이 된다.
  select coalesce(
           jsonb_agg(jsonb_build_object('path', u.path, 'name', u.name, 'size', u.size)
                     order by array_position(p_files, u.path)),
           '[]'::jsonb)
    into v_files
    from feedback_uploads u
   where u.ip_hash = p_ip_hash
     and u.path = any(coalesce(p_files, array[]::text[]));

  if jsonb_array_length(v_files) > 3 then
    raise exception 'too_many_files';
  end if;

  if p_ip_hash is not null then
    -- (1) 같은 내용 재전송 → 원래 것을 돌려주고 끝(멱등).
    --     ⚠️ 첨부까지 같아야 같은 글이다. body 만 보면 "쓰고 나서 파일을 붙여 다시 보낸" 사람이
    --        첨부 없는 옛 글의 id 를 돌려받고 파일이 통째로 사라진다.
    --     ⚠️ 반대로 첨부를 비교하면서 v_files 를 '아직 안 묶인 것' 으로만 만들면, 더블클릭의
    --        두 번째 호출에서 첨부가 빈 배열이 되어 멱등이 깨진다 — 그래서 위 select 는
    --        feedback_id 를 보지 않는다.
    select f.id into v_id
      from feedbacks f
     where f.ip_hash = p_ip_hash
       and f.body = v_body
       and f.files = v_files
       and f.created_at > now() - interval '1 day'
     limit 1;
    if v_id is not null then
      return v_id;
    end if;

    -- (2) 도배 바닥선.
    select count(*) into v_cnt
      from feedbacks f
     where f.ip_hash = p_ip_hash
       and f.created_at > now() - interval '10 minutes';
    if v_cnt >= 20 then
      raise exception 'too_many';
    end if;
  end if;

  insert into feedbacks (user_id, ip_hash, org, name, path, body, files)
  values (p_user, p_ip_hash, v_org, v_name, v_path, v_body, v_files)
  returning id into v_id;

  -- 고아 청소 대상에서 빼둔다. ⚠️ coalesce 로 **처음 묶인 의견을 지킨다** — 같은 파일을 다른
  -- 의견에 다시 붙여도 앞의 의견에서 떼어가지 않는다(그러면 앞 글의 첨부가 청소에 쓸려간다).
  update feedback_uploads u
     set feedback_id = coalesce(u.feedback_id, v_id)
   where u.ip_hash = p_ip_hash
     and u.path = any(coalesce(p_files, array[]::text[]));

  return v_id;
end;
$$;

-- 사용자 토큰으로는 못 부른다. 엣지 함수(service role)만 쓴다.
revoke all on function public.feedback_post(uuid, text, text, text, text, text, text[]) from public;
revoke all on function public.feedback_post(uuid, text, text, text, text, text, text[]) from anon;
revoke all on function public.feedback_post(uuid, text, text, text, text, text, text[]) from authenticated;

revoke all on function public.feedback_upload_claim(text, text, text, bigint) from public;
revoke all on function public.feedback_upload_claim(text, text, text, bigint) from anon;
revoke all on function public.feedback_upload_claim(text, text, text, bigint) from authenticated;
