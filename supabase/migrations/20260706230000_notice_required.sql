-- 공지 배지 단순화: tag(공지/안내/필독) 대신 required(필독) 불리언만 사용.
--  · 공개 카드 배지 = 분류(category: 안내/시험일정/점검/이벤트). 필독이면 빨간 '필독' 배지 추가.
--  · tag 컬럼은 삭제하지 않고 dormant로 유지(과거 데이터 보존·롤백 여지). 앱은 더 이상 tag를 읽거나 쓰지 않음.
alter table notices add column if not exists required boolean not null default false;

-- 기존 tag='required' 공지를 필독으로 이관(1회성).
update notices set required = true where tag = 'required' and required = false;
