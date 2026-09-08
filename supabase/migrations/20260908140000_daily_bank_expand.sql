-- 2026-09-08 · DAILY QUIZ 문제은행 대폭 확장 (2026-09-08 지시 "이런 느낌의 문제들을 많이")
--
-- 레벨테스트 509문항에서 개념을 뽑아 DAILY QUIZ 문항 + 해설(글) + 해설 그림(SVG)을 한 벌로 만들었다.
-- 해설·그림은 코드에 있고(src/lib/theory/batch*.ts · src/components/dailyVisuals/batch*.tsx),
-- 이 마이그레이션은 그 해설이 붙은 **문항을 은행에 올린다**.
--
--   · 되살림 42건 — 2026-09-08 오전에 '해설 없음'으로 지웠던 행 중 이번에 해설이 생긴 것.
--     ⛔ **본문은 한 글자도 안 건드린다.** 생성 배치가 같은 용어에 새 문제문을 써 온 것이 4건 있었지만
--        반영하지 않았다 — 한국어가 바뀌면 그 행의 번역을 비우는 게 규칙이고, 그중에는 6개국어가 다 찬 것도 있었다.
--   · 새 문항 77건(한국어만).
--   · 이력(question_history · kind=term · scope=daily)에 한 줄씩 남긴다.
--
-- ⛔ **해설이 없는 용어는 여기 없다.** /daily 는 해설이 붙은 문항만 낸다(20260908130000 의 규칙).
--    코드에서 해설을 지우면 그 문항은 화면에서 정답만 보이고 해설 칸이 빈 채로 남는다 — 같이 지울 것.
-- ⚠️ 새 문항은 한국어뿐이다. 관리자 › DAILY QUIZ › 문항 관리 › 「🌐 미번역 번역」을 눌러야 5개국어가 찬다.

begin;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-051', 'AI', '{"ko":"목표를 받으면 스스로 계획을 세우고 검색·계산 같은 도구를 골라 쓰며 끝까지 실행하는 시스템"}'::jsonb, '{"ko":"AI 에이전트"}'::jsonb, '{"ko":["챗봇","RAG","파인튜닝"]}'::jsonb, true, 51)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"AI 에이전트"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-052', 'AI', '{"ko":"두 조건이 모두 참일 때만 전체를 참으로 만들어 다음 동작을 실행하게 하는 판단 기호"}'::jsonb, '{"ko":"AND 연산자"}'::jsonb, '{"ko":["OR 연산자","NOT 연산자","관계 연산자"]}'::jsonb, true, 52)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"AND 연산자"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-053', 'AI', '{"ko":"예측한 상자와 정답 상자가 겹친 넓이를, 두 상자를 합친 넓이로 나눈 비율"}'::jsonb, '{"ko":"IoU"}'::jsonb, '{"ko":["mAP","정밀도","F1 스코어"]}'::jsonb, true, 53)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"IoU"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-054', '로봇', '{"ko":"목표값과 현재값의 차이를 지금·누적·변화 속도 세 갈래로 나눠 출력을 정하는 제어 방식"}'::jsonb, '{"ko":"PID 제어"}'::jsonb, '{"ko":["온오프 제어","피드포워드 제어","인터록 회로"]}'::jsonb, true, 54)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"PID 제어"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-055', 'AI', '{"ko":"모델을 다시 학습시키지 않고, 질문마다 외부 문서를 찾아와 근거로 답을 만든다"}'::jsonb, '{"ko":"RAG"}'::jsonb, '{"ko":["파인튜닝","사전 학습","프롬프트 엔지니어링"]}'::jsonb, true, 55)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"RAG"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-056', 'AI', '{"ko":"모델이 낸 여러 답 중 사람이 더 나은 쪽을 고르고, 그 선호를 보상 삼아 다시 학습시키는 방법"}'::jsonb, '{"ko":"RLHF"}'::jsonb, '{"ko":["파인튜닝","사전 학습","지도학습"]}'::jsonb, true, 56)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"RLHF"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'fbdc338e-0d70-486e-9862-06f48237a842';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'fbdc338e-0d70-486e-9862-06f48237a842', 'D-027', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"SLAM"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '6ded3c25-92c0-4f61-a932-010edca313ad';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '6ded3c25-92c0-4f61-a932-010edca313ad', 'D-049', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"VLA 모델"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-057', 'AI', '{"ko":"문장에 담긴 기분이 긍정인지 부정인지 점수로 매겨 흐름이나 비율로 정리하는 기술"}'::jsonb, '{"ko":"감정 분석"}'::jsonb, '{"ko":["키워드 추출","기계번역","맞춤법 검사"]}'::jsonb, true, 57)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"감정 분석"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '18a701c8-5d95-4fb8-8efc-b81905403f70';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '18a701c8-5d95-4fb8-8efc-b81905403f70', 'D-050', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"강건성(Robustness)"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '379a3573-edff-4f21-afb5-178afccb6a77';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '379a3573-edff-4f21-afb5-178afccb6a77', 'D-007', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"강화학습"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '59ad8e13-d079-4ca3-b50b-4131070686f2';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '59ad8e13-d079-4ca3-b50b-4131070686f2', 'D-009', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"거대언어모델(LLM)"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'e5dde7d9-72c9-4d80-992e-764ab649f147';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'e5dde7d9-72c9-4d80-992e-764ab649f147', 'D-034', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"경로계획"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '4db7c8e9-9fd2-43ac-8d7b-e4a097f3bba1';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '4db7c8e9-9fd2-43ac-8d7b-e4a097f3bba1', 'D-012', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"과적합"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-058', 'AI', '{"ko":"사진이나 화면 속에 찍힌 글자를 찾아내 편집할 수 있는 텍스트로 바꾸는 기술"}'::jsonb, '{"ko":"광학문자인식"}'::jsonb, '{"ko":["음성인식","객체 탐지","이미지 생성"]}'::jsonb, true, 58)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"광학문자인식"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-059', '로봇', '{"ko":"여럿이 각자 최단 경로만 고집하다 서로의 길을 막아, 아무도 움직일 수 없게 된 상태"}'::jsonb, '{"ko":"교착 상태"}'::jsonb, '{"ko":["병목","충돌 회피","경로 재계획"]}'::jsonb, true, 59)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"교착 상태"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-060', 'AI', '{"ko":"결과를 줄글이 아니라 표나 미리 정한 필드 형식에 맞춰 내놓게 지정하는 방식"}'::jsonb, '{"ko":"구조화 출력"}'::jsonb, '{"ko":["네거티브 프롬프트","롤 프롬프팅","토큰"]}'::jsonb, true, 60)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"구조화 출력"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-061', 'AI', '{"ko":"장비를 점으로, 서로의 연결 관계를 선으로 놓고 그 연결 구조 자체를 학습하는 신경망"}'::jsonb, '{"ko":"그래프 신경망(GNN)"}'::jsonb, '{"ko":["합성곱 신경망(CNN)","순환 신경망(RNN)","오토인코더"]}'::jsonb, true, 61)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"그래프 신경망(GNN)"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-062', 'AI', '{"ko":"한 언어로 쓴 문장을 뜻을 유지한 채 다른 언어의 문장으로 자동으로 바꿔 주는 기술"}'::jsonb, '{"ko":"기계번역"}'::jsonb, '{"ko":["광학문자인식","음성인식","요약"]}'::jsonb, true, 62)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"기계번역"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-063', 'AI', '{"ko":"원하는 것 대신 결과에서 빼고 싶은 요소를 미리 지정해 걸러내게 하는 지시 방식"}'::jsonb, '{"ko":"네거티브 프롬프트"}'::jsonb, '{"ko":["롤 프롬프팅","퓨샷 프롬프팅","구조화 출력"]}'::jsonb, true, 63)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"네거티브 프롬프트"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-064', 'AI', '{"ko":"정해진 정답을 꺼내는 게 아니라, 문맥 뒤에 올 확률이 가장 높은 조각을 하나씩 이어 붙이는 방식"}'::jsonb, '{"ko":"다음 토큰 예측"}'::jsonb, '{"ko":["어텐션 메커니즘","디코딩","임베딩"]}'::jsonb, true, 64)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"다음 토큰 예측"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-065', 'AI', '{"ko":"가진 사진을 회전·반전·밝기 조정으로 변형해 학습에 쓸 표본 수를 인위적으로 불리는 기법"}'::jsonb, '{"ko":"데이터 증강"}'::jsonb, '{"ko":["전이 학습","드롭아웃","배치 정규화"]}'::jsonb, true, 65)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"데이터 증강"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-066', '피지컬AI', '{"ko":"가상 훈련장의 마찰·조명·무게를 매번 무작위로 흔들어, 어떤 현실에서도 통하게 만드는 학습법"}'::jsonb, '{"ko":"도메인 랜덤화"}'::jsonb, '{"ko":["데이터 증강","전이 학습","도메인 적응"]}'::jsonb, true, 66)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"도메인 랜덤화"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '8f292979-29d9-4b81-ba6f-f36071e18ae0';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '8f292979-29d9-4b81-ba6f-f36071e18ae0', 'D-039', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"디지털 트윈"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-067', 'AI', '{"ko":"완전한 무작위 잡음에서 시작해 한 단계씩 잡음을 걷어내며 그림을 완성하는 생성 원리"}'::jsonb, '{"ko":"디퓨전"}'::jsonb, '{"ko":["적대적 생성 신경망(GAN)","어텐션 메커니즘","렌더링"]}'::jsonb, true, 67)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"디퓨전"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-068', 'AI', '{"ko":"실제 인물의 얼굴이나 목소리를 다른 영상에 합성해 진짜처럼 보이게 만든 결과물"}'::jsonb, '{"ko":"딥페이크"}'::jsonb, '{"ko":["모션 캡처","합성음성","이미지 생성"]}'::jsonb, true, 68)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"딥페이크"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'b913ec86-8e2d-49a8-9f9f-017bc2b9b930';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'b913ec86-8e2d-49a8-9f9f-017bc2b9b930', 'D-028', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"라이다(LiDAR)"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-069', 'AI', '{"ko":"AI에게 특정 인물이나 직업을 맡겨 그 입장의 말투와 관점으로 답하게 하는 기법"}'::jsonb, '{"ko":"롤 프롬프팅"}'::jsonb, '{"ko":["퓨샷 프롬프팅","생각의 사슬","네거티브 프롬프트"]}'::jsonb, true, 69)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"롤 프롬프팅"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '874092cf-c7d2-416e-8a66-88e3aa87adae';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '874092cf-c7d2-416e-8a66-88e3aa87adae', 'D-002', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"머신러닝"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '43b21326-b928-41d2-bc86-fe50d3933b23';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '43b21326-b928-41d2-bc86-fe50d3933b23', 'D-043', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"멀티모달"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-070', '피지컬AI', '{"ko":"CPU가 값을 한 번에 읽도록 자료구조 멤버 사이에 쓰지 않는 빈 바이트를 끼워 넣는 규칙"}'::jsonb, '{"ko":"메모리 정렬"}'::jsonb, '{"ko":["메모리 단편화","스택 프레임","캐시 미스"]}'::jsonb, true, 70)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"메모리 정렬"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-071', 'AI', '{"ko":"한 오브젝트가 신호를 쏘면 그 신호를 기다리던 다른 오브젝트들이 동시에 움직이게 하는 기능"}'::jsonb, '{"ko":"메시지 방송"}'::jsonb, '{"ko":["변수","함수 호출","이벤트 블록"]}'::jsonb, true, 71)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"메시지 방송"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'fb740429-3a58-4520-b29e-76f60ad1c266';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'fb740429-3a58-4520-b29e-76f60ad1c266', 'D-041', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"모방학습"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-072', '로봇', '{"ko":"제어 칩이 내보내는 약한 신호를 받아 바퀴를 실제로 돌릴 만한 전류로 키워 주는 중계 부품"}'::jsonb, '{"ko":"모터 드라이버"}'::jsonb, '{"ko":["서보모터","엔코더","리미트 스위치"]}'::jsonb, true, 72)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"모터 드라이버"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-073', 'AI', '{"ko":"대화가 길어져 기억 용량을 넘기기 전에 지난 내용을 짧게 압축해 자리를 비우는 처리"}'::jsonb, '{"ko":"문맥 요약"}'::jsonb, '{"ko":["컨텍스트 창","RAG","캐싱"]}'::jsonb, true, 73)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"문맥 요약"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-074', '피지컬AI', '{"ko":"3차원 점 데이터를 일정 크기의 정육면체 칸으로 나눈 뒤 칸마다 점 하나로 합쳐 줄이는 압축"}'::jsonb, '{"ko":"복셀 그리드 다운샘플링"}'::jsonb, '{"ko":["미디언 필터","세그멘테이션","포인트 클라우드 정합"]}'::jsonb, true, 74)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"복셀 그리드 다운샘플링"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-075', '로봇', '{"ko":"제어 프로그램을 거치지 않고 배선으로 곧장 모터 전원을 끊어 버리는 최후의 안전 장치"}'::jsonb, '{"ko":"비상 정지"}'::jsonb, '{"ko":["인터록 회로","워치독 타이머","소프트웨어 정지 명령"]}'::jsonb, true, 75)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"비상 정지"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-076', 'AI', '{"ko":"자료를 넘기기 전에 이름·연락처처럼 사람을 특정할 수 있는 부분만 지우거나 가리는 처리"}'::jsonb, '{"ko":"비식별화"}'::jsonb, '{"ko":["암호화","접근 권한 설정","데이터 백업"]}'::jsonb, true, 76)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"비식별화"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'edfae6f7-54b3-40bb-92a2-705b0b21c499';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'edfae6f7-54b3-40bb-92a2-705b0b21c499', 'D-006', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"비지도학습"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-077', 'AI', '{"ko":"같은 물체에 겹친 여러 예측 상자 중 확신이 가장 높은 것만 남기고 나머지를 지우는 후처리"}'::jsonb, '{"ko":"비최대 억제(NMS)"}'::jsonb, '{"ko":["IoU","바운딩 박스","신뢰도 임계값"]}'::jsonb, true, 77)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"비최대 억제(NMS)"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-078', 'AI', '{"ko":"데이터 개수가 늘어날 때 연산 횟수가 얼마나 가파르게 증가하는지를 나타내는 방법"}'::jsonb, '{"ko":"빅오 표기법"}'::jsonb, '{"ko":["의사코드","진리표","실행 시간"]}'::jsonb, true, 78)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"빅오 표기법"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-079', 'AI', '{"ko":"정답표 없이 방대한 원문을 스스로 읽어 내리며 언어의 규칙과 지식을 처음 쌓는 단계"}'::jsonb, '{"ko":"사전 학습"}'::jsonb, '{"ko":["파인튜닝","RLHF","지도학습"]}'::jsonb, true, 79)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"사전 학습"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-080', 'AI', '{"ko":"정답을 바로 내놓지 않고 중간 풀이 단계를 차례로 거치게 해 정확도를 높이는 기법"}'::jsonb, '{"ko":"생각의 사슬"}'::jsonb, '{"ko":["퓨샷 프롬프팅","롤 프롬프팅","파인튜닝"]}'::jsonb, true, 80)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"생각의 사슬"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'f30bbf36-e9c5-44c8-a7b7-d94963b0258d';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'f30bbf36-e9c5-44c8-a7b7-d94963b0258d', 'D-013', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"생성형 AI"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-081', 'AI', '{"ko":"아직 줄 서지 않은 부분에서 가장 작은 값을 찾아 맨 앞과 자리를 바꾸는 일을 되풀이하는 방법"}'::jsonb, '{"ko":"선택 정렬"}'::jsonb, '{"ko":["버블 정렬","삽입 정렬","병합 정렬"]}'::jsonb, true, 81)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"선택 정렬"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-082', 'AI', '{"ko":"사진 속 픽셀 하나하나가 어느 물체에 속하는지 가려내 형태 윤곽까지 도려내는 비전 기술"}'::jsonb, '{"ko":"세그멘테이션"}'::jsonb, '{"ko":["이미지 분류","객체 탐지","자세 추정"]}'::jsonb, true, 82)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"세그멘테이션"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '2658c63f-e7e8-444d-b155-4d1b83461a26';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '2658c63f-e7e8-444d-b155-4d1b83461a26', 'D-019', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"센서"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-083', '피지컬AI', '{"ko":"장치에 소리·빛 같은 물리 신호를 쏘아, 계측값 자체를 거짓으로 읽게 만드는 공격"}'::jsonb, '{"ko":"센서 스푸핑"}'::jsonb, '{"ko":["패킷 스니핑","랜섬웨어","적대적 예제"]}'::jsonb, true, 83)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"센서 스푸핑"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '77041a6f-1e23-4bf2-bb74-c5f0f8680933';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '77041a6f-1e23-4bf2-bb74-c5f0f8680933', 'D-026', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"순기구학"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-084', 'AI', '{"ko":"일의 흐름과 갈림길을 타원·직사각형·마름모 같은 기호와 화살표로 표현한 설계 그림"}'::jsonb, '{"ko":"순서도"}'::jsonb, '{"ko":["의사코드","블록 스크립트","클래스 다이어그램"]}'::jsonb, true, 84)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"순서도"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-085', 'AI', '{"ko":"정렬 여부와 상관없이 첫 칸부터 마지막 칸까지 하나씩 차례로 비교해 원하는 값을 찾는 방법"}'::jsonb, '{"ko":"순차 탐색"}'::jsonb, '{"ko":["이진 탐색","해시 조회","버블 정렬"]}'::jsonb, true, 85)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"순차 탐색"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '74d352b4-4c69-4bb5-8ad4-2c19d29613fe';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '74d352b4-4c69-4bb5-8ad4-2c19d29613fe', 'D-045', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"스와름 로보틱스"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'bf145664-a8e6-4087-b91b-d9641a07e67e';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'bf145664-a8e6-4087-b91b-d9641a07e67e', 'D-038', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"시뮬레이션 투 리얼(Sim-to-Real)"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-086', 'AI', '{"ko":"대화가 시작되기 전에 AI의 역할과 지켜야 할 규칙을 미리 못박아 두는 상위 명령층"}'::jsonb, '{"ko":"시스템 프롬프트"}'::jsonb, '{"ko":["네거티브 프롬프트","프롬프트 인젝션","퓨샷 프롬프팅"]}'::jsonb, true, 86)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"시스템 프롬프트"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'f89d70d8-4aa3-4b26-b5c2-40e1a1f9c97a';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'f89d70d8-4aa3-4b26-b5c2-40e1a1f9c97a', 'D-004', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"신경망"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '861dcfff-992a-42ff-89a1-813461891bb7';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '861dcfff-992a-42ff-89a1-813461891bb7', 'D-047', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"실시간 제어"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-087', '로봇', '{"ko":"0과 1로 끊어지지 않고 온도나 밝기처럼 값이 연속적으로 이어지며 변하는 신호 형태"}'::jsonb, '{"ko":"아날로그 신호"}'::jsonb, '{"ko":["디지털 신호","이진 신호","PWM 신호"]}'::jsonb, true, 87)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"아날로그 신호"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-088', '로봇', '{"ko":"오래 걸리는 작업에 목표를 보내고 진행 상황을 계속 받아 보다가 중간에 취소도 할 수 있는 통신"}'::jsonb, '{"ko":"액션 통신"}'::jsonb, '{"ko":["토픽","서비스","파라미터"]}'::jsonb, true, 88)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"액션 통신"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'c3b95215-7aa6-442a-a873-ae427d164132';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'c3b95215-7aa6-442a-a873-ae427d164132', 'D-018', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"액추에이터"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-089', 'AI', '{"ko":"가중치를 표현하는 비트 수를 줄여 모델 용량과 추론 시간을 함께 낮추는 경량화 기법"}'::jsonb, '{"ko":"양자화"}'::jsonb, '{"ko":["지식 증류","가지치기","정규화"]}'::jsonb, true, 89)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"양자화"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '113fe22d-4243-43b4-894e-fd4f78fd59e2';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '113fe22d-4243-43b4-894e-fd4f78fd59e2', 'D-016', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"어텐션 메커니즘"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '21f3562b-0995-44c5-8a44-f92e3643a82e';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '21f3562b-0995-44c5-8a44-f92e3643a82e', 'D-029', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"엔코더"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '6ae88470-b084-4c53-9f4f-e0110306fff3';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '6ae88470-b084-4c53-9f4f-e0110306fff3', 'D-037', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"엣지 컴퓨팅"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '430356f8-0151-4312-b1a5-9a772579d041';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '430356f8-0151-4312-b1a5-9a772579d041', 'D-025', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"역기구학"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-090', 'AI', '{"ko":"센서 단선이나 0으로 나누기처럼 예기치 못한 오류가 나도 멈추지 않게 우회로를 두는 구조"}'::jsonb, '{"ko":"예외 처리"}'::jsonb, '{"ko":["조건 분기문","무한 반복","디버깅"]}'::jsonb, true, 90)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"예외 처리"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-091', '피지컬AI', '{"ko":"진동·온도 데이터의 변화 추세로 고장 날 시점을 미리 짚어 그 전에 손보는 설비 관리 방식"}'::jsonb, '{"ko":"예지 보전"}'::jsonb, '{"ko":["사후 보전","정기 점검","품질 검사"]}'::jsonb, true, 91)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"예지 보전"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-092', 'AI', '{"ko":"낮추면 매번 같은 답을, 높이면 매번 다른 답을 내놓게 만드는 생성 조절 설정값"}'::jsonb, '{"ko":"온도(Temperature)"}'::jsonb, '{"ko":["탑피(Top-P)","max_tokens","파라미터"]}'::jsonb, true, 92)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"온도(Temperature)"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '43af2447-11b4-4a06-b198-4988b11c0bc9';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '43af2447-11b4-4a06-b198-4988b11c0bc9', 'D-048', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"온디바이스 AI"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-093', '피지컬AI', '{"ko":"정상 동작 중에는 계속 초기화되다가, 초기화가 끊기면 장치를 강제로 재부팅시키는 감시 장치"}'::jsonb, '{"ko":"워치독 타이머"}'::jsonb, '{"ko":["실시간 클럭(RTC)","인터럽트","타이머 카운터"]}'::jsonb, true, 93)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"워치독 타이머"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-094', 'AI', '{"ko":"여러 후보 답을 섞고 조금씩 변형해 좋은 것만 남기며, 세대를 거듭해 좋은 해를 찾아가는 탐색법"}'::jsonb, '{"ko":"유전 알고리즘"}'::jsonb, '{"ko":["경사하강법","브루트포스 탐색","강화학습"]}'::jsonb, true, 94)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"유전 알고리즘"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-095', 'AI', '{"ko":"회의나 영상 속 말소리를 받아 시간 표시와 함께 글자로 옮겨 적어 주는 기술"}'::jsonb, '{"ko":"음성인식"}'::jsonb, '{"ko":["음성합성","광학문자인식","기계번역"]}'::jsonb, true, 95)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"음성인식"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-096', 'AI', '{"ko":"적어 둔 대본을 억양까지 얹어 사람 목소리에 가까운 소리로 바꿔 읽어 주는 기술"}'::jsonb, '{"ko":"음성합성"}'::jsonb, '{"ko":["음성인식","기계번역","광학문자인식"]}'::jsonb, true, 96)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"음성합성"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-097', '피지컬AI', '{"ko":"연속한 몇 개의 값을 더해 나눈 값으로 대체하며 창을 옮겨가는, 잡음을 눌러 주는 신호 처리"}'::jsonb, '{"ko":"이동 평균 필터"}'::jsonb, '{"ko":["미디언 필터","칼만 필터","정규화"]}'::jsonb, true, 97)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"이동 평균 필터"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-098', '피지컬AI', '{"ko":"급한 신호가 들어오면 CPU가 하던 일을 즉시 멈추고 정해진 코드를 먼저 처리하는 구조"}'::jsonb, '{"ko":"인터럽트"}'::jsonb, '{"ko":["폴링","DMA","워치독 타이머"]}'::jsonb, true, 98)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"인터럽트"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-099', '로봇', '{"ko":"동시에 켜지면 안 되는 두 동작이 서로의 회로를 끊어, 절대 겹치지 않게 만드는 안전 설계"}'::jsonb, '{"ko":"인터록 회로"}'::jsonb, '{"ko":["자기유지 회로","타이머 회로","비상 정지"]}'::jsonb, true, 99)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"인터록 회로"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '9bf02ec7-0480-4ffc-ad70-cc5423ea885c';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '9bf02ec7-0480-4ffc-ad70-cc5423ea885c', 'D-036', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"임베디드 AI"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-100', 'AI', '{"ko":"단어나 문장의 뜻을 컴퓨터가 계산할 수 있게 고차원 공간의 좌표 숫자로 바꾸는 변환"}'::jsonb, '{"ko":"임베딩"}'::jsonb, '{"ko":["토큰화","인코딩","코사인 유사도"]}'::jsonb, true, 100)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"임베딩"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '7e63ce0a-ba43-4bcb-9da6-f013b4a73e81';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '7e63ce0a-ba43-4bcb-9da6-f013b4a73e81', 'D-044', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"자기수용감각"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'bf68ec50-ee02-41ed-869f-c37a1f57913d';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'bf68ec50-ee02-41ed-869f-c37a1f57913d', 'D-015', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"자연어처리(NLP)"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '88e926c2-566b-4381-b018-b1e86e63c6a2';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '88e926c2-566b-4381-b018-b1e86e63c6a2', 'D-033', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"자율주행"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-101', '로봇', '{"ko":"몸체가 얼마나 빠르게 기울고 도는지 각속도를 측정해 자세와 균형을 잡게 해 주는 부품"}'::jsonb, '{"ko":"자이로 센서"}'::jsonb, '{"ko":["가속도 센서","엔코더","지자기 센서"]}'::jsonb, true, 101)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"자이로 센서"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-102', 'AI', '{"ko":"사람 눈에는 똑같아 보이는 미세한 잡음을 입력에 섞어 모델이 다르게 분류하게 만드는 공격"}'::jsonb, '{"ko":"적대적 공격"}'::jsonb, '{"ko":["프롬프트 인젝션","딥페이크","과적합"]}'::jsonb, true, 102)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"적대적 공격"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-103', '로봇', '{"ko":"주변이 밝은지 어두운지 전압 변화로 읽어 가로등이나 화면 밝기를 자동으로 조절하게 하는 부품"}'::jsonb, '{"ko":"조도 센서"}'::jsonb, '{"ko":["적외선 센서","온도 센서","컬러 센서"]}'::jsonb, true, 103)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"조도 센서"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-104', 'AI', '{"ko":"반복 안에 또 다른 반복을 넣어 행과 열처럼 두 방향을 모두 훑을 때 쓰는 제어 구조"}'::jsonb, '{"ko":"중첩 루프"}'::jsonb, '{"ko":["무한 반복","조건 분기문","재귀 호출"]}'::jsonb, true, 104)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"중첩 루프"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '221bc7b6-a979-4a01-bfce-9a348d5fa4f3';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '221bc7b6-a979-4a01-bfce-9a348d5fa4f3', 'D-005', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"지도학습"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-105', 'AI', '{"ko":"큰 모델이 내놓는 판단의 확률 분포까지 작은 모델에게 베끼게 해, 성능을 지킨 채 크기를 줄이는 학습"}'::jsonb, '{"ko":"지식 증류"}'::jsonb, '{"ko":["양자화","가지치기","전이 학습"]}'::jsonb, true, 105)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"지식 증류"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-106', '피지컬AI', '{"ko":"주변 장치가 CPU를 거치지 않고 데이터를 곧바로 메모리에 옮겨 넣게 하는 전송 방식"}'::jsonb, '{"ko":"직접 메모리 접근(DMA)"}'::jsonb, '{"ko":["인터럽트","폴링","캐시"]}'::jsonb, true, 106)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"직접 메모리 접근(DMA)"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-107', 'AI', '{"ko":"무슨 일이 일어날지 알리는 데서 멈추지 않고, 지금 무엇을 어떻게 바꾸라고까지 짚어 주는 분석 단계"}'::jsonb, '{"ko":"처방적 분석"}'::jsonb, '{"ko":["예측 분석","진단 분석","설명적 분석"]}'::jsonb, true, 107)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"처방적 분석"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-108', '로봇', '{"ko":"소리를 쏘아 물체에 부딪혀 돌아오는 시간을 재서 앞에 있는 것까지의 거리를 계산하는 부품"}'::jsonb, '{"ko":"초음파 센서"}'::jsonb, '{"ko":["적외선 센서","라이다(LiDAR)","자이로 센서"]}'::jsonb, true, 108)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"초음파 센서"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'e475911d-3cee-4b4e-84a7-d815c8c2c2a0';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'e475911d-3cee-4b4e-84a7-d815c8c2c2a0', 'D-040', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"촉각 센서"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-109', '피지컬AI', '{"ko":"렌즈 때문에 휘어 보이는 상을 격자판으로 재서 곧게 펴고 실제 치수와 맞추는 보정 과정"}'::jsonb, '{"ko":"카메라 캘리브레이션"}'::jsonb, '{"ko":["화이트 밸런스","데이터 증강","이진화"]}'::jsonb, true, 109)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"카메라 캘리브레이션"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-110', '피지컬AI', '{"ko":"직전에 예측한 값과 지금 들어온 측정값을 신뢰도에 따라 섞어 참값을 추정하는 알고리즘"}'::jsonb, '{"ko":"칼만 필터"}'::jsonb, '{"ko":["이동 평균 필터","미디언 필터","저역 통과 필터"]}'::jsonb, true, 110)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"칼만 필터"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-111', 'AI', '{"ko":"모델이 한 번에 눈에 담아 둘 수 있는 입력 분량의 한계로, 밖으로 밀려난 내용은 잊힌다"}'::jsonb, '{"ko":"컨텍스트 창"}'::jsonb, '{"ko":["토큰","파인튜닝","임베딩"]}'::jsonb, true, 111)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"컨텍스트 창"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '943d7105-f4b4-4e06-89a9-1e9d029c639e';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '943d7105-f4b4-4e06-89a9-1e9d029c639e', 'D-014', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"컴퓨터 비전"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '27b69b2d-a28d-4d8a-95d2-414bc7e92e72';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '27b69b2d-a28d-4d8a-95d2-414bc7e92e72', 'D-046', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"컴플라이언트 제어"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-112', 'AI', '{"ko":"두 벡터가 이루는 사잇각만 보고 길이와 상관없이 의미가 얼마나 닮았는지 재는 계산법"}'::jsonb, '{"ko":"코사인 유사도"}'::jsonb, '{"ko":["유클리드 거리","임베딩","평균 제곱 오차"]}'::jsonb, true, 112)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"코사인 유사도"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-113', 'AI', '{"ko":"다음 단어 후보를 확률 높은 순으로 세워 누적 합이 정해진 값에 닿을 때까지만 남기는 설정"}'::jsonb, '{"ko":"탑피(Top-P)"}'::jsonb, '{"ko":["온도(Temperature)","max_tokens","토큰"]}'::jsonb, true, 113)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"탑피(Top-P)"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-114', 'AI', '{"ko":"글로 적은 설명 한 줄만 주면 그 내용에 맞는 그림을 새로 그려 내놓는 기술"}'::jsonb, '{"ko":"텍스트-투-이미지"}'::jsonb, '{"ko":["이미지 검색","광학문자인식","사진 보정"]}'::jsonb, true, 114)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"텍스트-투-이미지"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '52f072e8-d0be-4ca4-8c7f-4a24e520b733';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '52f072e8-d0be-4ca4-8c7f-4a24e520b733', 'D-030', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"토크"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-115', 'AI', '{"ko":"모델이 글을 다룰 때 쓰는 최소 조각 단위로, 분량과 요금을 세는 기준이 된다"}'::jsonb, '{"ko":"토큰"}'::jsonb, '{"ko":["파라미터","컨텍스트 창","임베딩"]}'::jsonb, true, 115)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"토큰"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '7bbb2bd9-5f92-4a0f-84de-74ffd6156892';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '7bbb2bd9-5f92-4a0f-84de-74ffd6156892', 'D-008', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"트랜스포머"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'deb6c35e-9f31-4227-b53d-f517c2136be3';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'deb6c35e-9f31-4227-b53d-f517c2136be3', 'D-042', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"파운데이션 모델"}'::jsonb);

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'edeb8879-d221-4ff1-8d9d-7fe257671dad';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'edeb8879-d221-4ff1-8d9d-7fe257671dad', 'D-010', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"파인튜닝"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-116', '로봇', '{"ko":"전압을 낮추지 않고 켜짐과 꺼짐의 비율만 바꿔 모터 속도나 LED 밝기를 조절하는 출력 방식"}'::jsonb, '{"ko":"펄스 폭 변조"}'::jsonb, '{"ko":["아날로그 출력","모터 드라이버","직렬 통신"]}'::jsonb, true, 116)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"펄스 폭 변조"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-117', 'AI', '{"ko":"학습에 쓴 데이터가 한쪽으로 쏠려 있어서 그 방향으로 결과가 자꾸 치우치는 성질"}'::jsonb, '{"ko":"편향"}'::jsonb, '{"ko":["환각","과적합","노이즈"]}'::jsonb, true, 117)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"편향"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-118', '피지컬AI', '{"ko":"값 자체가 아니라 그 값이 놓인 메모리 번지를 담아, 복사 없이 큰 데이터를 넘기게 해 주는 변수"}'::jsonb, '{"ko":"포인터"}'::jsonb, '{"ko":["배열","구조체","참조 카운트"]}'::jsonb, true, 118)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"포인터"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-119', 'AI', '{"ko":"단어를 한꺼번에 병렬로 읽는 구조에서 사라져 버리는 앞뒤 순서 정보를 좌표처럼 더해 주는 장치"}'::jsonb, '{"ko":"포지셔널 인코딩"}'::jsonb, '{"ko":["어텐션 마스크","임베딩","패딩"]}'::jsonb, true, 119)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"포지셔널 인코딩"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-120', 'AI', '{"ko":"원하는 결과의 예시를 두어 개 먼저 보여준 뒤 같은 형태로 답하게 하는 기법"}'::jsonb, '{"ko":"퓨샷 프롬프팅"}'::jsonb, '{"ko":["제로샷 프롬프팅","롤 프롬프팅","파인튜닝"]}'::jsonb, true, 120)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"퓨샷 프롬프팅"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'ee60c2d6-def1-465c-baba-e0426e6c33bf';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'ee60c2d6-def1-465c-baba-e0426e6c33bf', 'D-011', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"프롬프트 엔지니어링"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-121', 'AI', '{"ko":"사용자 입력에 숨긴 명령으로 미리 걸어둔 안전 규칙을 덮어써 무력화하는 공격"}'::jsonb, '{"ko":"프롬프트 인젝션"}'::jsonb, '{"ko":["적대적 공격","데이터 추출 공격","SQL 인젝션"]}'::jsonb, true, 121)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"프롬프트 인젝션"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-122', 'AI', '{"ko":"고정된 문장 틀에 바꿔 끼울 자리를 비워 두고 값만 갈아 넣어 반복해 쓰는 지시 방식"}'::jsonb, '{"ko":"프롬프트 템플릿"}'::jsonb, '{"ko":["퓨샷 프롬프팅","롤 프롬프팅","구조화 출력"]}'::jsonb, true, 122)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"프롬프트 템플릿"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = 'a9f89cae-60d6-4752-a794-b8e855d27257';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', 'a9f89cae-60d6-4752-a794-b8e855d27257', 'D-017', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"하이퍼파라미터"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-123', 'AI', '{"ko":"현실에서 좀처럼 못 구하는 상황을 3D 시뮬레이터로 만들어, 정답 표시까지 자동으로 붙인 학습 자료"}'::jsonb, '{"ko":"합성 데이터"}'::jsonb, '{"ko":["데이터 증강","크라우드소싱 라벨링","전이 학습"]}'::jsonb, true, 123)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"합성 데이터"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-124', 'AI', '{"ko":"작은 필터가 이미지 위를 훑고 지나가며 선·모서리·질감 같은 특징을 뽑아내는 신경망"}'::jsonb, '{"ko":"합성곱 신경망(CNN)"}'::jsonb, '{"ko":["순환 신경망(RNN)","트랜스포머","오토인코더"]}'::jsonb, true, 124)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"합성곱 신경망(CNN)"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '72493b56-7b3b-4088-a5a3-bf99d25eeedd';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '72493b56-7b3b-4088-a5a3-bf99d25eeedd', 'D-031', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"협동로봇(코봇)"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-125', 'AI', '{"ko":"맞힌 것과 틀린 것을 실제·예측 두 축의 네 칸으로 갈라, 오류의 종류를 구분해 보는 표"}'::jsonb, '{"ko":"혼동 행렬"}'::jsonb, '{"ko":["정밀도-재현율 곡선","F1 스코어","ROC 곡선"]}'::jsonb, true, 125)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"혼동 행렬"}'::jsonb from ins;

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-126', 'AI', '{"ko":"근거가 하나도 없어도 통계적으로 그럴듯한 문장을 확신에 차서 만들어 내는 현상"}'::jsonb, '{"ko":"환각"}'::jsonb, '{"ko":["편향","과적합","적대적 공격"]}'::jsonb, true, 126)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"환각"}'::jsonb from ins;

update term_questions set deleted_at = null, active = true, updated_at = now() where id = '5000d924-7346-4ab2-8a7d-2aa667a659cb';

insert into question_history (kind, question_id, label, scope, action, actor, detail) values ('term', '5000d924-7346-4ab2-8a7d-2aa667a659cb', 'D-032', 'daily', 'restore', 'batch-2026-09-08', '{"answer":"휴머노이드 로봇"}'::jsonb);

with ins as (
  insert into term_questions (bank_id, code, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order)
  values ('00000000-0000-0000-0000-0000000000a2', 'D-127', 'AI', '{"ko":"자동으로 처리된 결과를 사람이 중간에서 확인하고 승인해야 다음 단계로 넘어가는 구조"}'::jsonb, '{"ko":"휴먼 인 더 루프"}'::jsonb, '{"ko":["완전 자동화","강화학습","파인튜닝"]}'::jsonb, true, 127)
  returning id, code)
insert into question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'create', 'batch-2026-09-08', '{"answer":"휴먼 인 더 루프"}'::jsonb from ins;

commit;
