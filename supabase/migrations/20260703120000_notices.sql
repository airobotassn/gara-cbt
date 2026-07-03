-- 공지사항(notices) — 관리자 CRUD + 공개 페이지(/notice) 데이터 소스.
--  · 6개국어 저장(title_i18n / body_i18n JSONB).
--  · 공개(published=true)된 행만 클라 read 허용(RLS). 작성/수정/삭제는 정책 없음 = service role(admin 함수) 전용.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'guide',            -- 필터: guide | schedule | maintenance | event
  tag text not null default 'notice',                -- 배지: notice | guide | required
  title_i18n jsonb not null default '{}'::jsonb,     -- { ko, en, ja, zh, hi, vi }
  body_i18n jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,             -- 상단 featured 고정
  published boolean not null default true,
  published_at timestamptz not null default now(),   -- 표시 날짜
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notices_pub_idx on notices (published, pinned desc, published_at desc);

alter table notices enable row level security;
-- 공개된 공지는 누구나(anon 포함) 읽기. 쓰기 정책 없음 → service role(admin 함수)만 작성/수정/삭제.
drop policy if exists notices_public_read on notices;
create policy notices_public_read on notices
  for select using (published = true);

-- 초기 시드: 기존 하드코딩 공지 3건(6개국어)을 그대로 이관 → 보고용 화면 동일 유지. (테이블이 비었을 때만)
insert into notices (category, tag, pinned, published, published_at, title_i18n, body_i18n)
select * from (values
  (
    'guide'::text, 'notice'::text, true, true, timestamptz '2026-06-25 09:00:00+09',
    '{"ko":"CARIS 자격검정 정식 오픈 안내","en":"CARIS Certification Now Officially Open","ja":"CARIS資格検定の正式オープンのお知らせ","zh":"CARIS 资格检定正式开放公告","hi":"CARIS प्रमाणन अब आधिकारिक रूप से खुला","vi":"Thông báo mở chính thức kỳ thi chứng nhận CARIS"}'::jsonb,
    '{"ko":"AI 활용 능력을 평가하는 CARIS 자격검정이 정식 오픈되었습니다. PC에서 보안 브라우저(SEB)로 응시할 수 있습니다.","en":"The CARIS certification that evaluates AI proficiency is now officially open. You can take it on a PC using the secure browser (SEB).","ja":"AI活用能力を評価するCARIS資格検定が正式にオープンしました。PCでセキュアブラウザ（SEB）を使って受験できます。","zh":"评估 AI 应用能力的 CARIS 资格检定已正式开放。可在 PC 上使用安全浏览器（SEB）应试。","hi":"AI दक्षता का मूल्यांकन करने वाला CARIS प्रमाणन अब आधिकारिक रूप से खुल गया है। आप इसे PC पर सुरक्षित ब्राउज़र (SEB) से दे सकते हैं।","vi":"Kỳ thi chứng nhận CARIS đánh giá năng lực sử dụng AI đã chính thức mở. Bạn có thể dự thi trên PC bằng trình duyệt bảo mật (SEB)."}'::jsonb
  ),
  (
    'guide', 'guide', false, true, timestamptz '2026-06-20 09:00:00+09',
    '{"ko":"보안 브라우저(SEB) 응시 안내","en":"Secure Browser (SEB) Exam Guide","ja":"セキュアブラウザ（SEB）受験のご案内","zh":"安全浏览器（SEB）应试指南","hi":"सुरक्षित ब्राउज़र (SEB) परीक्षा गाइड","vi":"Hướng dẫn dự thi bằng trình duyệt bảo mật (SEB)"}'::jsonb,
    '{"ko":"본 시험은 화면 캡처·복사·이탈을 차단하는 Safe Exam Browser에서만 응시할 수 있습니다. 응시 전 「시험환경 테스트」에서 설치·환경을 미리 점검해 주세요.","en":"This exam can only be taken in the Safe Exam Browser, which blocks screen capture, copying, and leaving the window. Before taking it, please check your setup and environment in the “Exam Environment Test.”","ja":"本試験は画面キャプチャ・コピー・離脱を遮断するSafe Exam Browserでのみ受験できます。受験前に「試験環境テスト」で設置・環境を事前にご確認ください。","zh":"本考试仅可在阻止屏幕截图·复制·离开的 Safe Exam Browser 中应试。应试前请在「考试环境测试」中提前检查安装与环境。","hi":"यह परीक्षा केवल Safe Exam Browser में दी जा सकती है, जो स्क्रीन कैप्चर, कॉपी और विंडो छोड़ने को रोकता है। देने से पहले, कृपया “परीक्षा वातावरण परीक्षण” में इंस्टॉलेशन और वातावरण जाँच लें।","vi":"Bài thi này chỉ có thể làm trong Safe Exam Browser, vốn chặn chụp màn hình, sao chép và rời cửa sổ. Trước khi thi, vui lòng kiểm tra cài đặt và môi trường tại “Kiểm tra môi trường thi.”"}'::jsonb
  ),
  (
    'guide', 'required', false, true, timestamptz '2026-06-15 09:00:00+09',
    '{"ko":"부정행위 예방 안내","en":"Cheating Prevention Notice","ja":"不正行為防止のご案内","zh":"防作弊须知","hi":"धोखाधड़ी रोकथाम सूचना","vi":"Thông báo phòng ngừa gian lận"}'::jsonb,
    '{"ko":"시험 중 화면 캡처·복사·다른 창 이탈은 차단·기록됩니다. 부정행위가 확인되면 응시가 무효 처리될 수 있으니 유의해 주세요.","en":"During the exam, screen capture, copying, and switching to other windows are blocked and logged. Please note that confirmed cheating may invalidate your attempt.","ja":"試験中の画面キャプチャ・コピー・他のウィンドウへの離脱は遮断・記録されます。不正行為が確認された場合、受験が無効になることがありますのでご注意ください。","zh":"考试期间，屏幕截图·复制·切换到其他窗口都会被阻止并记录。若确认作弊，应试可能被判无效，请注意。","hi":"परीक्षा के दौरान स्क्रीन कैप्चर, कॉपी और अन्य विंडो पर जाना अवरुद्ध एवं दर्ज किया जाता है। धोखाधड़ी की पुष्टि होने पर आपका प्रयास अमान्य हो सकता है, कृपया ध्यान दें।","vi":"Trong khi thi, việc chụp màn hình, sao chép và chuyển sang cửa sổ khác sẽ bị chặn và ghi lại. Lưu ý rằng nếu xác nhận gian lận, bài thi của bạn có thể bị hủy."}'::jsonb
  )
) as v(category, tag, pinned, published, published_at, title_i18n, body_i18n)
where not exists (select 1 from notices);
