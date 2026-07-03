-- FAQ(faqs) — 관리자 CRUD + 공개 페이지(/faq) 데이터 소스.
--  · 6개국어 저장(question_i18n / answer_i18n / tag_i18n JSONB).
--  · 공개(published=true)만 클라 read(RLS). 쓰기는 service role(admin 함수) 전용.
create table if not exists faqs (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'schedule',   -- schedule | system | payment | grading | corporate
  question_i18n jsonb not null default '{}'::jsonb,
  answer_i18n jsonb not null default '{}'::jsonb,
  tag_i18n jsonb not null default '{}'::jsonb,
  sort int not null default 100,               -- 표시 순서(작을수록 위)
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists faqs_pub_idx on faqs (published, category, sort, created_at);

alter table faqs enable row level security;
drop policy if exists faqs_public_read on faqs;
create policy faqs_public_read on faqs
  for select using (published = true);

-- 기존 하드코딩 FAQ 7건(6개국어)을 그대로 이관 (테이블이 비었을 때만)
insert into faqs (category, sort, question_i18n, answer_i18n, tag_i18n)
select * from (values
  (
    'system'::text, 10,
    '{"ko":"모바일이나 태블릿으로 응시할 수 있나요?","en":"Can I take the exam on a phone or tablet?","ja":"モバイルやタブレットで受験できますか？","zh":"可以用手机或平板应试吗？","hi":"क्या मैं फोन या टैबलेट पर परीक्षा दे सकता हूँ?","vi":"Tôi có thể dự thi trên điện thoại hoặc máy tính bảng không?"}'::jsonb,
    '{"ko":"아니요. CARIS 자격검정은 PC(데스크톱·노트북) 전용입니다. 모바일·태블릿에서는 응시할 수 없습니다.","en":"No. The CARIS certification is for PC (desktop/laptop) only. It cannot be taken on mobile or tablet.","ja":"いいえ。CARIS資格検定はPC（デスクトップ・ノート）専用です。モバイル・タブレットでは受験できません。","zh":"不可以。CARIS 资格检定仅限 PC（台式机·笔记本）。无法在手机·平板上应试。","hi":"नहीं। CARIS प्रमाणन केवल PC (डेस्कटॉप/लैपटॉप) के लिए है। इसे मोबाइल या टैबलेट पर नहीं दिया जा सकता।","vi":"Không. Chứng nhận CARIS chỉ dành cho PC (máy bàn/laptop). Không thể dự thi trên di động hoặc máy tính bảng."}'::jsonb,
    '{"ko":"응시 환경","en":"Exam Environment","ja":"受験環境","zh":"应试环境","hi":"परीक्षा वातावरण","vi":"Môi trường thi"}'::jsonb
  ),
  (
    'system', 20,
    '{"ko":"보안 브라우저(SEB)가 무엇인가요?","en":"What is the secure browser (SEB)?","ja":"セキュアブラウザ（SEB）とは何ですか？","zh":"安全浏览器（SEB）是什么？","hi":"सुरक्षित ब्राउज़र (SEB) क्या है?","vi":"Trình duyệt bảo mật (SEB) là gì?"}'::jsonb,
    '{"ko":"시험 중 화면 캡처·복사·다른 프로그램 전환을 차단하는 공식 시험 보안 프로그램입니다. 응시 시작 시 안내에 따라 한 번 설치하면 됩니다.","en":"It is the official exam-security program that blocks screen capture, copying, and switching to other programs during the exam. You install it once by following the instructions when you start.","ja":"試験中の画面キャプチャ・コピー・他プログラムへの切り替えを遮断する公式の試験セキュリティプログラムです。受験開始時に案内に従って一度インストールするだけです。","zh":"这是官方考试安全程序，可在考试期间阻止屏幕截图·复制·切换到其他程序。开始应试时按提示安装一次即可。","hi":"यह आधिकारिक परीक्षा-सुरक्षा प्रोग्राम है जो परीक्षा के दौरान स्क्रीन कैप्चर, कॉपी और अन्य प्रोग्राम पर स्विच करने को रोकता है। शुरू करते समय निर्देशों के अनुसार इसे एक बार इंस्टॉल करें।","vi":"Đây là chương trình bảo mật thi chính thức, chặn chụp màn hình, sao chép và chuyển sang chương trình khác trong khi thi. Bạn chỉ cần cài đặt một lần theo hướng dẫn khi bắt đầu."}'::jsonb,
    '{"ko":"보안 브라우저","en":"Secure Browser","ja":"セキュアブラウザ","zh":"安全浏览器","hi":"सुरक्षित ब्राउज़र","vi":"Trình duyệt bảo mật"}'::jsonb
  ),
  (
    'grading', 30,
    '{"ko":"시험 결과는 언제 나오나요?","en":"When are the exam results available?","ja":"試験結果はいつ出ますか？","zh":"考试结果什么时候出？","hi":"परीक्षा परिणाम कब आते हैं?","vi":"Khi nào có kết quả thi?"}'::jsonb,
    '{"ko":"제출 후 1주일 뒤 마이페이지 「성적 확인」에서 합격 여부와 점수를 확인할 수 있습니다.","en":"One week after submission, you can check your pass/fail status and score in “View Results” on My Page.","ja":"提出から1週間後、マイページの「成績確認」で合否と点数を確認できます。","zh":"提交一周后，可在我的页面「成绩查询」中查看是否合格及分数。","hi":"जमा करने के एक सप्ताह बाद, आप माई पेज के “परिणाम देखें” में उत्तीर्ण/अनुत्तीर्ण स्थिति और अंक देख सकते हैं।","vi":"Một tuần sau khi nộp, bạn có thể xem kết quả đạt/không đạt và điểm số tại “Xem kết quả” trên Trang của tôi."}'::jsonb,
    '{"ko":"결과","en":"Results","ja":"結果","zh":"结果","hi":"परिणाम","vi":"Kết quả"}'::jsonb
  ),
  (
    'grading', 40,
    '{"ko":"합격 기준은 어떻게 되나요?","en":"What is the passing criteria?","ja":"合格基準はどうなっていますか？","zh":"合格标准是什么？","hi":"उत्तीर्ण मानदंड क्या है?","vi":"Tiêu chí đạt là gì?"}'::jsonb,
    '{"ko":"전체 문항의 60% 이상을 맞히면 합격입니다.","en":"You pass by answering 60% or more of all questions correctly.","ja":"全問題の60%以上正解で合格です。","zh":"答对全部题目的 60% 以上即为合格。","hi":"सभी प्रश्नों के 60% या अधिक सही उत्तर देने पर आप उत्तीर्ण होते हैं।","vi":"Bạn đạt nếu trả lời đúng từ 60% tổng số câu trở lên."}'::jsonb,
    '{"ko":"채점","en":"Grading","ja":"採点","zh":"评分","hi":"मूल्यांकन","vi":"Chấm điểm"}'::jsonb
  ),
  (
    'schedule', 50,
    '{"ko":"재응시할 수 있나요?","en":"Can I retake the exam?","ja":"再受験できますか？","zh":"可以重新应试吗？","hi":"क्या मैं दोबारा परीक्षा दे सकता हूँ?","vi":"Tôi có thể thi lại không?"}'::jsonb,
    '{"ko":"한 회차의 자격검정은 1회만 응시할 수 있으며, 제출한 뒤에는 같은 회차를 다시 응시할 수 없습니다. 다음 회차에는 다시 응시하실 수 있습니다.","en":"Each exam session allows only one attempt. Once you submit, you cannot retake that same session — but you can apply for the next session.","ja":"各回の資格検定は1回のみ受験でき、提出後は同じ回を再受験できません。次回の回であらためて受験いただけます。","zh":"每场资格检定仅可应试一次，提交后无法重考同一场，但可报名参加下一场。","hi":"प्रत्येक परीक्षा सत्र में केवल एक बार परीक्षा दी जा सकती है। जमा करने के बाद आप उसी सत्र को दोबारा नहीं दे सकते, लेकिन अगले सत्र के लिए आवेदन कर सकते हैं।","vi":"Mỗi đợt thi chỉ được dự một lần. Sau khi nộp bài, bạn không thể thi lại đợt đó, nhưng có thể đăng ký đợt thi tiếp theo."}'::jsonb,
    '{"ko":"재응시","en":"Retake","ja":"再受験","zh":"重新应试","hi":"पुनः परीक्षा","vi":"Thi lại"}'::jsonb
  ),
  (
    'grading', 60,
    '{"ko":"자격증은 어떻게 받나요?","en":"How do I receive my certificate?","ja":"資格証はどうやって受け取りますか？","zh":"如何获得证书？","hi":"मुझे प्रमाणपत्र कैसे मिलेगा?","vi":"Tôi nhận chứng chỉ bằng cách nào?"}'::jsonb,
    '{"ko":"합격하면 마이페이지 「자격증 발급 현황」 또는 성적 확인 화면에서 자격증을 PDF로 발급·출력할 수 있습니다.","en":"Once you pass, you can issue and print your certificate as a PDF from “Certificate Issuance Status” on My Page or from the results screen.","ja":"合格すると、マイページの「資格証発行状況」または成績確認画面から資格証をPDFで発行・印刷できます。","zh":"合格后，可在我的页面「证书发放状态」或成绩查询界面将证书以 PDF 形式发放·打印。","hi":"उत्तीर्ण होने पर, आप माई पेज के “प्रमाणपत्र जारी स्थिति” या परिणाम स्क्रीन से अपना प्रमाणपत्र PDF के रूप में जारी एवं प्रिंट कर सकते हैं।","vi":"Sau khi đạt, bạn có thể cấp và in chứng chỉ dưới dạng PDF từ “Tình trạng cấp chứng chỉ” trên Trang của tôi hoặc từ màn hình kết quả."}'::jsonb,
    '{"ko":"자격증","en":"Certificate","ja":"資格証","zh":"证书","hi":"प्रमाणपत्र","vi":"Chứng chỉ"}'::jsonb
  ),
  (
    'schedule', 70,
    '{"ko":"시험 중 안 푼 문항이 있으면 어떻게 되나요?","en":"What happens if I have unanswered questions during the exam?","ja":"試験中に未回答の問題があるとどうなりますか？","zh":"考试中有未作答的题目会怎样？","hi":"परीक्षा के दौरान अनुत्तरित प्रश्न रह जाएँ तो क्या होता है?","vi":"Nếu còn câu chưa trả lời trong khi thi thì sao?"}'::jsonb,
    '{"ko":"안 푼 문항이 있으면 제출되지 않으며, 경고 후 미응답 문항으로 이동합니다. 제한시간이 끝나면 자동으로 제출됩니다.","en":"If any questions are unanswered, submission is blocked; after a warning you are moved to the unanswered questions. When time runs out, the exam is submitted automatically.","ja":"未回答の問題があると提出されず、警告の後に未回答の問題へ移動します。制限時間が終了すると自動的に提出されます。","zh":"若有未作答的题目则无法提交，警告后会跳转到未作答题目。时限结束时将自动提交。","hi":"यदि कोई प्रश्न अनुत्तरित हैं तो जमा नहीं होता; चेतावनी के बाद आपको अनुत्तरित प्रश्नों पर ले जाया जाता है। समय समाप्त होने पर परीक्षा स्वतः जमा हो जाती है।","vi":"Nếu còn câu chưa trả lời, bài sẽ không được nộp; sau cảnh báo bạn được chuyển đến câu chưa trả lời. Khi hết giờ, bài thi được nộp tự động."}'::jsonb,
    '{"ko":"응시 중","en":"During the Exam","ja":"受験中","zh":"应试中","hi":"परीक्षा के दौरान","vi":"Trong khi thi"}'::jsonb
  )
) as v(category, sort, question_i18n, answer_i18n, tag_i18n)
where not exists (select 1 from faqs);
