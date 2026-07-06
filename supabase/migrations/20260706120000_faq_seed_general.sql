-- FAQ 일반 문항 시드(2차) — 자격시험 사이트에서 통상적으로 쓰는 일반 FAQ 14건(6개국어).
--  · 비어 있던 payment·corporate 카테고리 포함, 기존 7건(sort 10~70)에 이어 sort 80~210.
--  · 사이트 특수 정책(구체적 금액·기한 등)은 넣지 않고 접수 화면·공지로 안내하는 일반 문구만.
--  · 중복 방지: 이 시드의 첫 문항(ko)이 이미 있으면 전체 스킵.
insert into faqs (category, sort, question_i18n, answer_i18n, tag_i18n)
select * from (values
  (
    'schedule'::text, 80,
    '{"ko":"시험 일정은 어디에서 확인하나요?","en":"Where can I check the exam schedule?","ja":"試験日程はどこで確認できますか？","zh":"在哪里可以查看考试日程？","hi":"परीक्षा कार्यक्रम कहाँ देख सकते हैं?","vi":"Tôi có thể xem lịch thi ở đâu?"}'::jsonb,
    '{"ko":"「시험 일정」 페이지에서 회차별 접수 기간과 시험일을 확인할 수 있습니다. 새로운 회차가 열리면 공지사항으로도 안내해 드립니다.","en":"You can check the application period and exam date for each session on the Exam Schedule page. New sessions are also announced in Notices.","ja":"「試験日程」ページで回次ごとの申込期間と試験日を確認できます。新しい回次が開始されるとお知らせでもご案内します。","zh":"可在「考试日程」页面查看各场次的报名期间和考试日期。新场次开放时也会在公告中通知。","hi":"परीक्षा कार्यक्रम पेज पर प्रत्येक सत्र की आवेदन अवधि और परीक्षा तिथि देख सकते हैं। नए सत्र खुलने पर सूचना में भी घोषणा की जाती है।","vi":"Bạn có thể xem thời gian đăng ký và ngày thi của từng đợt trên trang Lịch thi. Khi mở đợt mới, chúng tôi cũng sẽ thông báo trong mục Thông báo."}'::jsonb,
    '{"ko":"일정","en":"Schedule","ja":"日程","zh":"日程","hi":"कार्यक्रम","vi":"Lịch thi"}'::jsonb
  ),
  (
    'schedule', 90,
    '{"ko":"응시 자격에 제한이 있나요?","en":"Are there any eligibility requirements?","ja":"受験資格に制限はありますか？","zh":"应试资格有限制吗？","hi":"क्या परीक्षा देने के लिए कोई पात्रता शर्तें हैं?","vi":"Có yêu cầu điều kiện dự thi không?"}'::jsonb,
    '{"ko":"CARIS Pro는 학력·연령·경력 제한 없이 누구나 응시할 수 있습니다. CARIS Master는 하위 등급부터 순차 취득이 원칙이며, CARIS Pro 1급 취득자만 Master 4급에 응시할 수 있습니다.","en":"Anyone can take CARIS Pro regardless of education, age, or career. CARIS Master follows a step-by-step principle: only holders of CARIS Pro Level 1 can take Master Level 4.","ja":"CARIS Proは学歴・年齢・経歴を問わずどなたでも受験できます。CARIS Masterは下位級から順に取得するのが原則で、CARIS Pro 1級取得者のみMaster 4級を受験できます。","zh":"CARIS Pro 不限学历·年龄·经历，任何人都可应试。CARIS Master 原则上需从低级别逐级取得，只有取得 CARIS Pro 1级者才能报考 Master 4级。","hi":"CARIS Pro कोई भी दे सकता है — शिक्षा, आयु या अनुभव की कोई शर्त नहीं है। CARIS Master में निचले स्तर से क्रमिक प्राप्ति का नियम है: केवल CARIS Pro स्तर 1 धारक ही Master स्तर 4 की परीक्षा दे सकते हैं।","vi":"Bất kỳ ai cũng có thể dự thi CARIS Pro, không giới hạn học vấn, độ tuổi hay kinh nghiệm. CARIS Master theo nguyên tắc lấy tuần tự từ cấp thấp: chỉ người đã đạt CARIS Pro cấp 1 mới được dự thi Master cấp 4."}'::jsonb,
    '{"ko":"응시 자격","en":"Eligibility","ja":"受験資格","zh":"应试资格","hi":"पात्रता","vi":"Điều kiện dự thi"}'::jsonb
  ),
  (
    'schedule', 100,
    '{"ko":"접수를 취소할 수 있나요?","en":"Can I cancel my application?","ja":"申込をキャンセルできますか？","zh":"可以取消报名吗？","hi":"क्या मैं अपना आवेदन रद्द कर सकता हूँ?","vi":"Tôi có thể hủy đăng ký không?"}'::jsonb,
    '{"ko":"접수 기간 내에는 취소할 수 있습니다. 접수 마감 이후에는 취소·변경이 제한될 수 있으니, 자세한 절차는 공지사항을 확인해 주세요.","en":"You can cancel during the application period. After the deadline, cancellation or changes may be limited — please check the Notices for details.","ja":"申込期間内はキャンセルできます。申込締切後はキャンセル・変更が制限される場合がありますので、詳細はお知らせをご確認ください。","zh":"报名期间内可以取消。报名截止后取消·变更可能受限，详情请查看公告。","hi":"आवेदन अवधि के भीतर रद्द किया जा सकता है। समय सीमा के बाद रद्द करने या बदलाव सीमित हो सकते हैं — विवरण के लिए सूचनाएँ देखें।","vi":"Bạn có thể hủy trong thời gian đăng ký. Sau khi hết hạn đăng ký, việc hủy hoặc thay đổi có thể bị hạn chế — vui lòng xem mục Thông báo để biết chi tiết."}'::jsonb,
    '{"ko":"접수","en":"Application","ja":"申込","zh":"报名","hi":"आवेदन","vi":"Đăng ký"}'::jsonb
  ),
  (
    'system', 110,
    '{"ko":"권장 응시 환경은 어떻게 되나요?","en":"What is the recommended exam environment?","ja":"推奨される受験環境は何ですか？","zh":"推荐的应试环境是什么？","hi":"अनुशंसित परीक्षा वातावरण क्या है?","vi":"Môi trường dự thi được khuyến nghị là gì?"}'::jsonb,
    '{"ko":"안정적인 인터넷에 연결된 PC(데스크톱·노트북)에서 최신 버전의 Chrome 또는 Edge 브라우저 사용을 권장합니다. 시험 전에 조용하고 방해받지 않는 장소를 준비해 주세요.","en":"We recommend a PC (desktop/laptop) with a stable internet connection and the latest version of Chrome or Edge. Please prepare a quiet, undisturbed place before the exam.","ja":"安定したインターネットに接続されたPC（デスクトップ・ノート）で、最新バージョンのChromeまたはEdgeのご利用を推奨します。試験前に静かで邪魔の入らない場所をご用意ください。","zh":"建议使用连接稳定网络的 PC（台式机·笔记本），并使用最新版 Chrome 或 Edge 浏览器。考试前请准备安静、不受打扰的环境。","hi":"स्थिर इंटरनेट से जुड़े PC (डेस्कटॉप/लैपटॉप) पर Chrome या Edge के नवीनतम संस्करण की सिफारिश की जाती है। परीक्षा से पहले शांत, बाधारहित स्थान तैयार रखें।","vi":"Khuyến nghị dùng PC (máy bàn/laptop) có kết nối internet ổn định và phiên bản mới nhất của Chrome hoặc Edge. Hãy chuẩn bị nơi yên tĩnh, không bị làm phiền trước khi thi."}'::jsonb,
    '{"ko":"응시 환경","en":"Exam Environment","ja":"受験環境","zh":"应试环境","hi":"परीक्षा वातावरण","vi":"Môi trường thi"}'::jsonb
  ),
  (
    'system', 120,
    '{"ko":"회원가입은 어떻게 하나요?","en":"How do I sign up?","ja":"会員登録はどうすればいいですか？","zh":"如何注册会员？","hi":"मैं साइन अप कैसे करूँ?","vi":"Làm thế nào để đăng ký tài khoản?"}'::jsonb,
    '{"ko":"별도의 가입 절차 없이 구글 계정으로 로그인하면 자동으로 가입됩니다. 모바일 앱 안의 브라우저(인앱 브라우저)에서는 구글 로그인이 차단될 수 있으니 Chrome·Safari 같은 기본 브라우저를 이용해 주세요.","en":"There is no separate sign-up process — just log in with your Google account and your account is created automatically. Google login may be blocked in in-app browsers, so please use a standard browser such as Chrome or Safari.","ja":"別途の登録手続きはなく、Googleアカウントでログインすると自動的に登録されます。アプリ内ブラウザではGoogleログインがブロックされる場合があるため、ChromeやSafariなどの標準ブラウザをご利用ください。","zh":"无需单独注册，使用谷歌账号登录即自动完成注册。应用内浏览器可能会拦截谷歌登录，请使用 Chrome、Safari 等默认浏览器。","hi":"अलग से साइन-अप की आवश्यकता नहीं है — अपने Google खाते से लॉग इन करते ही खाता अपने आप बन जाता है। इन-ऐप ब्राउज़र में Google लॉगिन अवरुद्ध हो सकता है, इसलिए Chrome या Safari जैसे मानक ब्राउज़र का उपयोग करें।","vi":"Không cần đăng ký riêng — chỉ cần đăng nhập bằng tài khoản Google, tài khoản sẽ được tạo tự động. Đăng nhập Google có thể bị chặn trong trình duyệt trong ứng dụng, vì vậy hãy dùng trình duyệt chuẩn như Chrome hoặc Safari."}'::jsonb,
    '{"ko":"계정","en":"Account","ja":"アカウント","zh":"账号","hi":"खाता","vi":"Tài khoản"}'::jsonb
  ),
  (
    'system', 130,
    '{"ko":"시험 중 다른 화면으로 이동하면 어떻게 되나요?","en":"What happens if I switch to another screen during the exam?","ja":"試験中に他の画面へ移動するとどうなりますか？","zh":"考试中切换到其他界面会怎样？","hi":"परीक्षा के दौरान दूसरी स्क्रीन पर जाने से क्या होता है?","vi":"Điều gì xảy ra nếu tôi chuyển sang màn hình khác trong khi thi?"}'::jsonb,
    '{"ko":"부정행위 방지를 위해 시험 중 화면 이탈, 복사 등의 행위는 감지되어 기록됩니다. 반복될 경우 응시가 무효 처리될 수 있으니 시험이 끝날 때까지 시험 화면을 유지해 주세요.","en":"To prevent cheating, actions such as leaving the exam screen or copying are detected and recorded. Repeated violations may invalidate your attempt, so please stay on the exam screen until you finish.","ja":"不正行為防止のため、試験中の画面離脱やコピーなどの行為は検知・記録されます。繰り返すと受験が無効になる場合がありますので、終了まで試験画面を維持してください。","zh":"为防止作弊，考试期间离开界面、复制等行为会被检测并记录。多次发生可能导致应试作废，请在考试结束前保持在考试界面。","hi":"नकल रोकने के लिए, परीक्षा के दौरान स्क्रीन छोड़ने या कॉपी करने जैसी गतिविधियाँ पहचानी और दर्ज की जाती हैं। बार-बार होने पर परीक्षा अमान्य हो सकती है, इसलिए समाप्ति तक परीक्षा स्क्रीन पर बने रहें।","vi":"Để chống gian lận, các hành vi như rời khỏi màn hình thi hoặc sao chép sẽ bị phát hiện và ghi lại. Vi phạm lặp lại có thể khiến bài thi bị hủy, vì vậy hãy giữ nguyên màn hình thi cho đến khi kết thúc."}'::jsonb,
    '{"ko":"부정행위 방지","en":"Anti-Cheating","ja":"不正防止","zh":"防作弊","hi":"नकल रोकथाम","vi":"Chống gian lận"}'::jsonb
  ),
  (
    'payment', 140,
    '{"ko":"응시료는 얼마인가요?","en":"How much is the exam fee?","ja":"受験料はいくらですか？","zh":"考试费用是多少？","hi":"परीक्षा शुल्क कितना है?","vi":"Lệ phí thi là bao nhiêu?"}'::jsonb,
    '{"ko":"응시료는 검정 종류와 등급에 따라 다르며, 응시 접수 화면에서 확인할 수 있습니다.","en":"The fee depends on the certification track and level, and is shown on the application screen.","ja":"受験料は検定の種類と級によって異なり、申込画面で確認できます。","zh":"考试费用因检定种类和级别而异，可在报名界面查看。","hi":"शुल्क प्रमाणन ट्रैक और स्तर के अनुसार अलग-अलग होता है और आवेदन स्क्रीन पर दिखाया जाता है।","vi":"Lệ phí tùy theo loại chứng nhận và cấp bậc, được hiển thị trên màn hình đăng ký."}'::jsonb,
    '{"ko":"응시료","en":"Fee","ja":"受験料","zh":"费用","hi":"शुल्क","vi":"Lệ phí"}'::jsonb
  ),
  (
    'payment', 150,
    '{"ko":"결제는 어떻게 하나요?","en":"How do I pay?","ja":"支払いはどうすればいいですか？","zh":"如何付款？","hi":"भुगतान कैसे करूँ?","vi":"Thanh toán như thế nào?"}'::jsonb,
    '{"ko":"응시 접수 단계에서 결제가 진행되며, 이용 가능한 결제 수단은 접수 화면에서 안내됩니다. 결제가 완료되어야 접수가 확정됩니다.","en":"Payment is made during the application process, and the available payment methods are shown on the application screen. Your application is confirmed only after payment is completed.","ja":"申込手続きの中で支払いを行い、利用可能な支払い方法は申込画面でご案内します。支払いが完了すると申込が確定します。","zh":"在报名流程中完成付款，可用的付款方式会在报名界面说明。付款完成后报名才算确定。","hi":"भुगतान आवेदन प्रक्रिया के दौरान किया जाता है, और उपलब्ध भुगतान विधियाँ आवेदन स्क्रीन पर दिखाई जाती हैं। भुगतान पूरा होने पर ही आवेदन पक्का होता है।","vi":"Thanh toán được thực hiện trong quá trình đăng ký; các phương thức thanh toán khả dụng sẽ hiển thị trên màn hình đăng ký. Đăng ký chỉ được xác nhận sau khi thanh toán hoàn tất."}'::jsonb,
    '{"ko":"결제","en":"Payment","ja":"支払い","zh":"付款","hi":"भुगतान","vi":"Thanh toán"}'::jsonb
  ),
  (
    'payment', 160,
    '{"ko":"환불받을 수 있나요?","en":"Can I get a refund?","ja":"返金してもらえますか？","zh":"可以退款吗？","hi":"क्या मुझे धनवापसी मिल सकती है?","vi":"Tôi có thể được hoàn tiền không?"}'::jsonb,
    '{"ko":"접수 기간 내에 접수를 취소하면 응시료가 환불됩니다. 접수 마감 이후에는 환불이 제한될 수 있으며, 자세한 기준은 공지사항의 환불 규정을 확인해 주세요.","en":"If you cancel within the application period, the fee is refunded. After the deadline, refunds may be limited — please see the refund policy in the Notices for details.","ja":"申込期間内にキャンセルすると受験料が返金されます。申込締切後は返金が制限される場合がありますので、詳細はお知らせの返金規定をご確認ください。","zh":"在报名期间内取消报名可退还考试费。报名截止后退款可能受限，具体标准请查看公告中的退款规定。","hi":"आवेदन अवधि के भीतर रद्द करने पर शुल्क वापस किया जाता है। समय सीमा के बाद धनवापसी सीमित हो सकती है — विवरण के लिए सूचनाओं में धनवापसी नीति देखें।","vi":"Nếu hủy trong thời gian đăng ký, lệ phí sẽ được hoàn lại. Sau hạn đăng ký, việc hoàn tiền có thể bị hạn chế — vui lòng xem quy định hoàn tiền trong mục Thông báo."}'::jsonb,
    '{"ko":"환불","en":"Refund","ja":"返金","zh":"退款","hi":"धनवापसी","vi":"Hoàn tiền"}'::jsonb
  ),
  (
    'grading', 170,
    '{"ko":"틀린 문항은 감점되나요?","en":"Do wrong answers reduce my score?","ja":"間違えた問題は減点されますか？","zh":"答错会扣分吗？","hi":"क्या गलत उत्तर से अंक कटते हैं?","vi":"Trả lời sai có bị trừ điểm không?"}'::jsonb,
    '{"ko":"아니요. 틀린 문항에 대한 감점은 없으며, 맞힌 문항의 점수만 합산하여 채점합니다. 모르는 문제도 비워 두지 말고 답하는 것이 유리합니다.","en":"No. There is no penalty for wrong answers — only correct answers are counted. It is better to answer every question rather than leave it blank.","ja":"いいえ。間違えた問題への減点はなく、正解した問題の点数のみを合算して採点します。わからない問題も空欄にせず回答するほうが有利です。","zh":"不会。答错不扣分，只累计答对题目的分数。不会的题也不要留空，作答更有利。","hi":"नहीं। गलत उत्तर पर कोई दंड नहीं है — केवल सही उत्तर गिने जाते हैं। प्रश्न खाली छोड़ने के बजाय उत्तर देना बेहतर है।","vi":"Không. Trả lời sai không bị trừ điểm — chỉ tính điểm các câu đúng. Tốt hơn là trả lời mọi câu thay vì bỏ trống."}'::jsonb,
    '{"ko":"채점","en":"Grading","ja":"採点","zh":"评分","hi":"मूल्यांकन","vi":"Chấm điểm"}'::jsonb
  ),
  (
    'grading', 180,
    '{"ko":"급수는 어떻게 정해지나요?","en":"How is my level determined?","ja":"級はどのように決まりますか？","zh":"级别是如何确定的？","hi":"मेरा स्तर कैसे तय होता है?","vi":"Cấp bậc của tôi được xác định như thế nào?"}'::jsonb,
    '{"ko":"CARIS Pro는 한 번의 시험에서 취득한 점수에 따라 4급~1급이 차등 부여됩니다(100점 만점 기준 4급 60점, 3급 70점, 2급 80점, 1급 90점 이상). CARIS Master는 급수별로 별도의 검정에 응시합니다.","en":"For CARIS Pro, Levels 4 to 1 are awarded based on your score in a single exam (out of 100: Level 4 from 60, Level 3 from 70, Level 2 from 80, Level 1 from 90). For CARIS Master, you take a separate exam for each level.","ja":"CARIS Proは一度の試験で取得した点数に応じて4級～1級が付与されます（100点満点で4級60点、3級70点、2級80点、1級90点以上）。CARIS Masterは級ごとに別の検定を受験します。","zh":"CARIS Pro 根据一次考试的得分授予 4级～1级（满分100分：4级60分、3级70分、2级80分、1级90分以上）。CARIS Master 则按级别分别报考。","hi":"CARIS Pro में एक ही परीक्षा के अंक के आधार पर स्तर 4 से 1 दिए जाते हैं (100 में से: स्तर 4 — 60, स्तर 3 — 70, स्तर 2 — 80, स्तर 1 — 90 से)। CARIS Master में प्रत्येक स्तर की अलग परीक्षा होती है।","vi":"Với CARIS Pro, cấp 4 đến cấp 1 được trao dựa trên điểm của một kỳ thi duy nhất (thang 100: cấp 4 từ 60, cấp 3 từ 70, cấp 2 từ 80, cấp 1 từ 90). Với CARIS Master, mỗi cấp thi một kỳ riêng."}'::jsonb,
    '{"ko":"등급","en":"Levels","ja":"級","zh":"级别","hi":"स्तर","vi":"Cấp bậc"}'::jsonb
  ),
  (
    'corporate', 190,
    '{"ko":"단체(기업·기관) 응시가 가능한가요?","en":"Is group testing available for companies and organizations?","ja":"団体（企業・機関）での受験は可能ですか？","zh":"企业·机构可以团体应试吗？","hi":"क्या कंपनियों और संस्थानों के लिए सामूहिक परीक्षा उपलब्ध है?","vi":"Doanh nghiệp, tổ chức có thể dự thi theo nhóm không?"}'::jsonb,
    '{"ko":"가능합니다. 임직원 단체 응시를 원하는 기업·기관은 협회로 문의해 주시면 일정과 접수 방법을 안내해 드립니다.","en":"Yes. Companies and organizations that want group testing for their staff can contact the association, and we will guide you through the schedule and application process.","ja":"可能です。役職員の団体受験をご希望の企業・機関は協会までお問い合わせいただければ、日程と申込方法をご案内します。","zh":"可以。希望员工团体应试的企业·机构请与协会联系，我们将为您介绍日程和报名方法。","hi":"हाँ। कर्मचारियों की सामूहिक परीक्षा चाहने वाली कंपनियाँ/संस्थान एसोसिएशन से संपर्क करें — हम कार्यक्रम और आवेदन प्रक्रिया की जानकारी देंगे।","vi":"Có. Doanh nghiệp, tổ chức muốn cho nhân viên dự thi theo nhóm vui lòng liên hệ hiệp hội, chúng tôi sẽ hướng dẫn lịch trình và cách đăng ký."}'::jsonb,
    '{"ko":"단체 응시","en":"Group Testing","ja":"団体受験","zh":"团体应试","hi":"सामूहिक परीक्षा","vi":"Thi theo nhóm"}'::jsonb
  ),
  (
    'corporate', 200,
    '{"ko":"취득한 자격은 어떻게 활용하나요?","en":"How can I use the certification I earned?","ja":"取得した資格はどのように活用できますか？","zh":"取得的资格如何使用？","hi":"प्राप्त प्रमाणन का उपयोग कैसे करूँ?","vi":"Tôi có thể dùng chứng nhận đã đạt như thế nào?"}'::jsonb,
    '{"ko":"합격 후 마이페이지에서 자격증을 PDF로 발급받아 입사 지원, 인사평가, 교육 이수 증빙 등에 제출할 수 있습니다.","en":"After passing, you can issue your certificate as a PDF from My Page and submit it for job applications, HR evaluations, or proof of training.","ja":"合格後、マイページから資格証をPDFで発行し、就職応募や人事評価、教育履修の証明などに提出できます。","zh":"合格后，可在我的页面将证书以 PDF 形式开具，用于求职、人事考核、培训证明等。","hi":"उत्तीर्ण होने के बाद, माई पेज से प्रमाणपत्र PDF के रूप में जारी कर नौकरी आवेदन, HR मूल्यांकन या प्रशिक्षण प्रमाण के लिए जमा कर सकते हैं।","vi":"Sau khi đạt, bạn có thể cấp chứng chỉ dạng PDF từ Trang của tôi và nộp cho hồ sơ xin việc, đánh giá nhân sự hoặc chứng minh đào tạo."}'::jsonb,
    '{"ko":"활용","en":"Usage","ja":"活用","zh":"用途","hi":"उपयोग","vi":"Sử dụng"}'::jsonb
  ),
  (
    'corporate', 210,
    '{"ko":"기업 제휴나 교육 프로그램 문의는 어디로 하나요?","en":"Where do I ask about corporate partnerships or training programs?","ja":"企業提携や研修プログラムの問い合わせはどこにすればいいですか？","zh":"企业合作或培训项目咨询联系谁？","hi":"कॉर्पोरेट साझेदारी या प्रशिक्षण कार्यक्रमों के बारे में कहाँ पूछूँ?","vi":"Tôi hỏi về hợp tác doanh nghiệp hoặc chương trình đào tạo ở đâu?"}'::jsonb,
    '{"ko":"기업 제휴, 임직원 교육 등 협력 관련 문의는 협회로 연락해 주시면 담당자가 안내해 드립니다.","en":"For partnership inquiries such as corporate alliances or staff training, please contact the association and a staff member will assist you.","ja":"企業提携や役職員研修などの協力に関するお問い合わせは、協会までご連絡いただければ担当者がご案内します。","zh":"企业合作、员工培训等合作相关咨询，请联系协会，将由专人为您解答。","hi":"कॉर्पोरेट साझेदारी या कर्मचारी प्रशिक्षण जैसी सहयोग संबंधी पूछताछ के लिए एसोसिएशन से संपर्क करें — संबंधित स्टाफ आपकी सहायता करेगा।","vi":"Về hợp tác doanh nghiệp, đào tạo nhân viên và các hợp tác khác, vui lòng liên hệ hiệp hội để được nhân viên phụ trách hướng dẫn."}'::jsonb,
    '{"ko":"제휴","en":"Partnership","ja":"提携","zh":"合作","hi":"साझेदारी","vi":"Hợp tác"}'::jsonb
  )
) as v(category, sort, question_i18n, answer_i18n, tag_i18n)
where not exists (
  select 1 from faqs where question_i18n->>'ko' = '시험 일정은 어디에서 확인하나요?'
);
