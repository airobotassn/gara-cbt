// DAILY QUIZ 해설 글 — vi. 키는 한국어 정답 용어 그대로.
export const THEORY: Record<string, { point: string; why?: string[]; compare?: string }> = {
  "엔드 이펙터": {
    "point": "Giữ nguyên cánh tay, chỉ thay phần đầu. Bẫy ở chỗ điểm chuẩn (TCP) cũng di chuyển theo.",
    "compare": "End effector = toàn bộ dụng cụ gắn ở đầu · Gripper = một tay kẹp trong số đó."
  },
  "서보모터": {
    "point": "Động cơ tự kiểm tra đã quay bao nhiêu độ, sai thì tự chỉnh lại.",
    "why": [
      "Dùng cho khớp robot·CNC không được lệch vị trí. Đổi lại phải gắn encoder nên đắt hơn."
    ]
  },
  "매니퓰레이터": {
    "point": "Toàn bộ cấu trúc cánh tay robot với các khớp nối như chuỗi — từ vai đến cổ tay.",
    "why": [
      "Người chỉ nói “cầm chỗ kia” chứ không đọc góc khớp. Nên điều khiển thực tế phải giải động học ngược."
    ],
    "compare": "Cánh tay = manipulator · Bàn tay = end effector · Cơ bắp = actuator."
  },
  "그리퍼": {
    "point": "Bàn tay kẹp vật thể. Khó không phải là kẹp mà là điều chỉnh lực.",
    "why": [
      "Kiểu kẹp là cơ bản, vật trơn dùng hút chân không, kim loại dùng nam châm điện."
    ]
  },
  "자유도(DOF)": {
    "point": "Số hướng có thể chuyển động độc lập. Trong không gian, 6 là đủ.",
    "why": [
      "Từ 7 trục trở lên có thể giữ cùng một điểm bằng nhiều tư thế để tránh vật cản (cobot)."
    ],
    "compare": "Bậc tự do là “số hướng” chuyển động, torque là “lực” xoay. Nhiều trục không có nghĩa là mạnh hơn."
  },
  "인공지능(AI)": {
    "point": "Công nghệ để máy tính tự tìm ra quy luật từ dữ liệu, thay vì người viết luật.",
    "why": [
      "Trước đây viết tri thức chuyên gia thành luật, nhưng không liệt kê hết ngoại lệ nên bế tắc."
    ]
  },
  "딥러닝": {
    "point": "Cách xếp nhiều lớp mạng nơ-ron để mô hình tự học cả việc nên nhìn vào đâu.",
    "why": [
      "Lý thuyết ra đời từ thập niên 1980 nhưng bùng nổ vào thập niên 2010 khi có GPU và dữ liệu lớn."
    ],
    "compare": "Machine learning truyền thống do người chọn đặc trưng để nhìn, deep learning học luôn cả việc đó."
  },
  "피지컬 AI": {
    "point": "AI bước ra khỏi màn hình, dùng thân thể chạm trực tiếp vào thực tế.",
    "compare": "Chatbot sai thì hỏi lại là được, nhưng robot sai động tác là thành tai nạn ngay."
  },
  "프롬프트 엔지니어링": {
    "point": "Càng thêm từng điều kiện vào câu lệnh, câu trả lời càng thu hẹp về đúng ý muốn.",
    "compare": "Fine-tuning thay đổi chính mô hình, còn cái này chỉ thay đổi câu lệnh."
  },
  "롤 프롬프팅": {
    "point": "Cùng một câu hỏi nhưng nói là hỏi ai thì câu trả lời sẽ khác.",
    "compare": "Vai trò là góc nhìn thay một lần, system prompt là luật áp dụng liên tục."
  },
  "퓨샷 프롬프팅": {
    "point": "Cho xem trước ví dụ về khuôn (định dạng) của câu trả lời, không phải đáp án.",
    "compare": "Không cho ví dụ là zero-shot, cho vài ví dụ là few-shot."
  },
  "생각의 사슬": {
    "point": "Không trả lời ngay mà đi qua các bước giải trung gian để tăng độ chính xác.",
    "compare": "Few-shot cho định dạng bằng ví dụ, còn cái này bắt buộc phải qua quá trình giải."
  },
  "네거티브 프롬프트": {
    "point": "Là chỉ thị chỉ rõ thứ cần loại bỏ, thay vì nói thứ mong muốn.",
    "compare": "Prompt thường nói cái được phép, còn cái này nói cái không được phép."
  },
  "시스템 프롬프트": {
    "point": "Luật đặt sẵn trước khi trò chuyện bắt đầu sẽ áp dụng cho mọi lượt.",
    "compare": "Injection là kiểu tấn công lén lật ngược luật này bằng đầu vào của người dùng."
  },
  "프롬프트 인젝션": {
    "point": "Mô hình không phân biệt luật và đầu vào người dùng, mà đọc nối liền nhau.",
    "why": [
      "Vì vậy nếu đầu vào lẫn câu giống như lệnh, nó sẽ được thực thi luôn."
    ],
    "compare": "Giống SQL injection trộn lệnh vào code, cái này trộn lệnh vào câu văn."
  },
  "프롬프트 템플릿": {
    "point": "Cố định khuôn mẫu, chỉ thay giá trị vào chỗ trống để sản xuất lặp lại.",
    "compare": "Template cố định khuôn, few-shot để mô hình tự đoán khuôn qua ví dụ."
  },
  "인터럽트": {
    "point": "Đang làm việc mà có tín hiệu đến thì dừng lại xử lý trước.",
    "compare": "Polling là mình liên tục hỏi, interrupt là bên kia chủ động báo."
  },
  "워치독 타이머": {
    "point": "Nếu không nhận được tín hiệu trong thời gian quy định, thiết bị bị buộc khởi động lại.",
    "compare": "Realtime clock đo thời khắc, watchdog bắt lỗi bị treo."
  },
  "직접 메모리 접근(DMA)": {
    "point": "Thiết bị ngoại vi chuyển dữ liệu thẳng vào bộ nhớ mà không qua CPU.",
    "compare": "Interrupt gọi CPU trong chốc lát, còn DMA thì không đụng đến CPU chút nào."
  },
  "메모리 정렬": {
    "point": "Chèn byte trống giữa các dữ liệu để CPU đọc được trong một lần.",
    "why": [
      "Kích thước tăng lên nhưng đổi lại số lần đọc giảm."
    ]
  },
  "포인터": {
    "point": "Là biến giữ địa chỉ nơi có giá trị, chứ không phải bản thân giá trị.",
    "compare": "Không sao chép nguyên khối dữ liệu lớn, chỉ truyền đúng một địa chỉ."
  },
  "PID 제어": {
    "point": "Cộng ba giá trị sai số hiện tại · sai số tích lũy · tốc độ thay đổi để quyết định đầu ra.",
    "compare": "Chỉ dùng P thì dừng gần mục tiêu, I·D mới bắt được sai số và dao động."
  },
  "이동 평균 필터": {
    "point": "Lấy trung bình vài giá trị gần nhất, dịch cửa sổ để nén nhiễu.",
    "compare": "Cửa sổ càng rộng càng mượt, nhưng theo kịp thay đổi càng chậm."
  },
  "칼만 필터": {
    "point": "Trộn giá trị dự đoán và giá trị đo theo độ tin cậy để tiệm cận giá trị thật.",
    "compare": "Trung bình động chỉ nhìn giá trị quá khứ, Kalman nhìn cả dự đoán lẫn đo lường."
  },
  "비상 정지": {
    "point": "Thiết bị cuối cùng cắt nguồn thẳng qua dây điện, không qua chương trình điều khiển.",
    "compare": "Interlock chặn lẫn nhau, còn nút dừng khẩn cấp bỏ qua cả phần mềm."
  },
  "인터록 회로": {
    "point": "Khi một bên bật thì ngắt vật lý mạch bên kia, không cho cả hai cùng bật.",
    "compare": "Dừng khẩn cấp tắt tất cả, interlock chỉ tách riêng hai thứ không được trùng."
  },
  "교착 상태": {
    "point": "Trạng thái nhiều bên cố chấp mục tiêu riêng, chặn đường nhau khiến không ai di chuyển được.",
    "why": [
      "Chỉ cần một bên nhường để phá vòng lặp, phần còn lại sẽ được giải phóng."
    ]
  },
  "센서 스푸핑": {
    "point": "Không đụng vào code, mà đưa tín hiệu vật lý giả vào cảm biến để đánh lừa chính giá trị đo.",
    "compare": "Hack chặn đường truyền tin, spoofing thay đổi cả thế giới mà cảm biến nhìn thấy."
  },
  "액션 통신": {
    "point": "Gửi mục tiêu cho tác vụ dài, rồi liên tục trao đổi tiến độ và cả lệnh hủy.",
    "compare": "Topic gửi xong là hết, service bị khóa chờ đến khi có phản hồi, chỉ action mới trao đổi giữa chừng."
  },
  "복셀 그리드 다운샘플링": {
    "point": "Chia đám mây điểm thành ô lưới, gộp mỗi ô về một điểm đại diện để giảm số lượng.",
    "why": [
      "Nếu ô quá lớn thì phần mỏng sẽ biến mất trước tiên."
    ]
  },
  "엣지 컴퓨팅": {
    "point": "Xử lý ngay gần đó thay vì gửi dữ liệu lên tận cloud, để giảm thời gian khứ hồi.",
    "compare": "Edge vẫn gửi tới thiết bị lân cận, on-device thì không gửi ra khỏi máy chút nào."
  },
  "디지털 트윈": {
    "point": "Bản sao ảo chuyển động y hệt vật thật — trạng thái và cả kết quả thử nghiệm đều trao đổi qua lại.",
    "compare": "Giám sát đơn thuần chỉ để xem, còn twin thì kết quả chạy thử ở ảo quay trở lại vật thật."
  },
  "온디바이스 AI": {
    "point": "Từ cảm biến đến phán đoán đều hoàn tất trong thiết bị, dữ liệu gốc không đi ra ngoài.",
    "compare": "Edge vẫn còn gửi ra tới gần đó, còn cái này không vượt qua ranh giới thiết bị."
  },
  "예지 보전": {
    "point": "Không dựa vào ngày hay sự cố, mà định thời điểm sửa theo tín hiệu xu hướng từ dữ liệu."
  },
  "처방적 분석": {
    "point": "Bước sau mô tả · chẩn đoán · dự đoán — không dừng ở việc báo cáo mà ra lệnh hành động."
  },
  "액추에이터": {
    "point": "Không thể phán đoán — chỉ chuyển động đúng như tín hiệu nhận được."
  },
  "센서": {
    "point": "Đo xong chưa phải là hết — phải đổi giá trị thành tín hiệu rồi phát ra mới xong."
  },
  "엔코더": {
    "point": "Đếm số xung để biết đã quay bao nhiêu độ, đóng vai trò con mắt của servo.",
    "compare": "Encoder tạo ra con số, servo dùng con số đó để đưa vị trí trở lại đúng."
  },
  "토크": {
    "point": "Cùng một lực nhưng tác dụng càng xa trục thì quay càng mạnh."
  },
  "역기구학": {
    "point": "Người nói bằng tọa độ — đây là phép tính chuyển lời đó thành góc khớp."
  },
  "순기구학": {
    "point": "Chỉ cần biết góc là tính ra ngay vị trí đầu ngón tay."
  },
  "SLAM": {
    "point": "Phải có bản đồ mới biết vị trí, phải biết vị trí mới vẽ được bản đồ — giải cả hai cùng lúc.",
    "compare": "Nối các khoảng cách mà cảm biến như LiDAR đo được sẽ tạo thành bản đồ."
  },
  "라이다(LiDAR)": {
    "point": "Vì đã biết tốc độ ánh sáng, chỉ cần đo thời gian đi về là ra khoảng cách.",
    "compare": "Camera nhìn màu sắc và hình dạng, LiDAR đo thời gian đi và về."
  },
  "자율주행": {
    "point": "Toàn bộ vòng lặp tự vận hành nhận thức · phán đoán · hành động mỗi khắc.",
    "compare": "Lập kế hoạch đường đi chỉ là một phần trong vòng lặp đó, tính \"nên đi đâu\"."
  },
  "경로계획": {
    "point": "Tính trước một đường tránh vật cản trước khi xuất phát.",
    "compare": "Tự lái là toàn bộ vòng lặp thực sự nhận thức · phán đoán để chạy theo đường đó."
  },
  "협동로봇(코봇)": {
    "point": "Không có hàng rào không phải vì hiền, mà vì tự hạ thấp lực và tốc độ.",
    "why": [
      "Người đến gần thì chậm lại, chạm vào thì hạ lực ngay lập tức."
    ]
  },
  "휴머노이드 로봇": {
    "point": "Lý do có hình người — cầu thang · cửa · dụng cụ đều đã được thiết kế theo cơ thể người.",
    "compare": "Kiểu bánh xe chỉ đi được trên nền phẳng, còn chân có thể bước lên cả bậc tiếp theo."
  },
  "촉각 센서": {
    "point": "Đọc áp lực · kết cấu khi chạm vào — phải chạm mới biết.",
    "compare": "Cảm giác bản thể tự biết vị trí khớp của mình mà không cần chạm."
  },
  "자기수용감각": {
    "point": "Không cần nhìn ra ngoài vẫn tự biết khớp của mình đang ở bao nhiêu độ.",
    "compare": "Cảm biến xúc giác phải chạm vào vật ngoài mới biết, còn cái này không chạm vẫn biết."
  },
  "컴플라이언트 제어": {
    "point": "Khi va chạm không chống lại, mà lùi đúng bằng lực đẩy để hấp thụ lực.",
    "compare": "Điều khiển vị trí cố giữ góc nên gây quá tải, còn cái này thì nhường."
  },
  "스와름 로보틱스": {
    "point": "Không có chỉ huy, đội hình tổng thể hình thành chỉ từ luật nhìn vài robot bên cạnh.",
    "why": [
      "Mỗi con chỉ nhìn vị trí hàng xóm rồi phản ứng, không ai vẽ ra bức tranh tổng thể."
    ]
  },
  "신경망": {
    "point": "Nhân mỗi đầu vào với trọng số rồi cộng lại, vượt ngưỡng thì gửi tín hiệu đi tiếp.",
    "compare": "Deep learning là xếp chồng nhiều lớp nơ-ron này lên nhau."
  },
  "지도학습": {
    "point": "Đặt sẵn bảng đáp án bên cạnh, chỉnh dự đoán cho đến khi khớp với đáp án đó.",
    "compare": "Học không giám sát để dữ liệu tự phân chia mà không cần đáp án."
  },
  "비지도학습": {
    "point": "Không có đáp án, dữ liệu tự gom nhóm những gì gần nhau.",
    "compare": "Học có giám sát đối chiếu với đáp án, học không giám sát thì chẳng có gì để đối chiếu."
  },
  "강화학습": {
    "point": "Thử làm, rồi dùng phần thưởng đến sau một khoảng để củng cố lựa chọn đã qua.",
    "compare": "Học bắt chước sao chép quỹ đạo người khác, học tăng cường thì tự mình trải nghiệm."
  },
  "모방학습": {
    "point": "Học bằng cách theo sát từng điểm trong quỹ đạo mà chuyên gia đã làm mẫu.",
    "compare": "Học tăng cường học bằng phần thưởng, học bắt chước sao chép nguyên bản trình diễn."
  },
  "과적합": {
    "point": "Đúng hết với dữ liệu đã có, nhưng sai nặng với dữ liệu chưa từng thấy."
  },
  "트랜스포머": {
    "point": "Không đọc từng chữ theo thứ tự, mà đặt tất cả cùng lúc để tham chiếu lẫn nhau.",
    "compare": "Mô hình trước đây (RNN) chỉ đọc từng chữ theo đúng thứ tự."
  },
  "하이퍼파라미터": {
    "point": "Là giá trị người đặt sẵn trước khi học, thứ mà dữ liệu không tự quyết được.",
    "why": [
      "Chỉ một giá trị có thể làm thay đổi cả tốc độ hội tụ lẫn độ ổn định."
    ]
  },
  "임베디드 AI": {
    "point": "Bộ nhớ · điện năng dùng được trên một thiết bị này đã bị giới hạn cứng ngay từ đầu.",
    "compare": "On-device·edge phân biệt theo vị trí xử lý, embedded phân biệt theo lượng tài nguyên dùng bên trong."
  },
  "실시간 제어": {
    "point": "Dù trung bình nhanh, chỉ cần một lần trễ hạn là coi như thất bại.",
    "compare": "Điều khiển bất đồng bộ chỉ cần xong là được, điều khiển thời gian thực trễ hạn là thất bại ngay."
  },
  "시뮬레이션 투 리얼(Sim-to-Real)": {
    "point": "Cùng chính sách, cùng hành động nhưng lại trượt ở thực tế — khoảng hở đó gọi là reality gap.",
    "compare": "Digital twin là tấm gương phản chiếu vật thật liên tục, sim-to-real là việc chuyển chính sách đã học sang thực tế một lần."
  },
  "VLA 모델": {
    "point": "Ô luật trung gian mà con người từng viết đã biến mất hoàn toàn — thấy và nghe trở thành hành động ngay lập tức.",
    "compare": "Foundation model là dùng chung một gốc cho nhiều việc, VLA là cấu trúc nối từ nhìn·nghe đến hành động."
  },
  "파운데이션 모델": {
    "point": "Chỉ dạy thêm rất ít cho từng việc, dựa trên một gốc đã học lớn một lần.",
    "compare": "VLA là cấu trúc nối từ đầu vào đến hành động, foundation model là gốc đa năng có thể dùng bên trong đó."
  },
  "강건성(Robustness)": {
    "point": "Chỉ mạnh khi điều kiện vừa khít thì không phải là mạnh thật sự.",
    "compare": "Khái quát hóa là khả năng vẫn đúng với dữ liệu mới, robustness là khả năng không sụp đổ dù điều kiện bị xáo trộn."
  },
  "거대언어모델(LLM)": {
    "point": "Việc nó làm chỉ là chọn mảnh tiếp theo. Phần còn lại do quy mô tạo nên.",
    "compare": "Tìm kiếm là lấy về từ đâu đó, còn cái này mỗi lần đều tự tạo mới."
  },
  "토큰": {
    "point": "Không phải chữ cũng không phải từ, mà là mảnh riêng của mô hình. Số lượng này vừa là dung lượng vừa là chi phí.",
    "why": [
      "Tiếng Hàn hay bị cắt theo từng chữ nên cùng một nghĩa lại tốn nhiều mảnh hơn."
    ]
  },
  "컨텍스트 창": {
    "point": "Độ rộng có thể nhìn thấy trong một lần. Phần đầu tràn ra không được tóm tắt mà bị quên.",
    "compare": "Token là đơn vị của một mảnh, còn đây là chứa được bao nhiêu mảnh như thế."
  },
  "임베딩": {
    "point": "Chuyển nghĩa thành tọa độ. Gần nhau thì giống nhau, hướng chứa đựng mối quan hệ.",
    "compare": "Token hóa cắt văn bản thành mảnh, embedding gán tọa độ cho mảnh đó."
  },
  "어텐션 메커니즘": {
    "point": "Quyết định bằng trọng số xem mỗi từ nên nhìn vào đâu ngay lúc này.",
    "why": [
      "Nối liền cả những từ ở xa nhau trong một lần — trái tim của Transformer."
    ]
  },
  "다음 토큰 예측": {
    "point": "Không soạn sẵn cả câu. Gắn một mảnh rồi chọn lại từ đầu.",
    "compare": "Vì vậy cùng một câu hỏi có thể cho ra câu trả lời khác nhau mỗi lần."
  },
  "온도(Temperature)": {
    "point": "Giữ nguyên ứng viên, chỉ làm phân bố nhọn hơn (an toàn) hoặc bẹt hơn (đa dạng).",
    "compare": "Temperature thay đổi hình dạng phân bố, Top-P cắt bớt số lượng ứng viên."
  },
  "탑피(Top-P)": {
    "point": "Cộng dồn theo thứ tự xác suất giảm dần, chỉ giữ ứng viên đến khi chạm p.",
    "compare": "Cắt theo số lượng là Top-K, cắt theo xác suất cộng dồn là cái này."
  },
  "코사인 유사도": {
    "point": "Bỏ qua độ dài, chỉ nhìn góc giữa hai vector. Càng gần 1 thì nghĩa càng giống.",
    "compare": "Khoảng cách Euclid đo độ xa cách, còn đây đo hướng đang nhìn."
  },
  "머신러닝": {
    "point": "Người không viết luật. Tự tìm ranh giới từ các ví dụ.",
    "compare": "Luật do người thêm dần từng cái, học chỉ cần thêm ví dụ."
  },
  "파인튜닝": {
    "point": "Điều chỉnh lại bảng số bên trong mô hình đã học sẵn bằng dữ liệu chuyên ngành.",
    "compare": "RAG thay tài liệu bên ngoài mô hình, fine-tuning sửa bên trong mô hình."
  },
  "RAG": {
    "point": "Giữ nguyên mô hình, tìm tài liệu về gắn làm căn cứ trước khi trả lời.",
    "compare": "Fine-tuning sửa mô hình, RAG chỉ thay tài liệu đặt bên cạnh."
  },
  "환각": {
    "point": "Dù không có căn cứ, chỉ cần xác suất cao thì câu vẫn được tạo ra đến hết.",
    "compare": "Thiên lệch là vấn đề dữ liệu nghiêng một phía, ảo giác là vấn đề bịa ra không căn cứ."
  },
  "편향": {
    "point": "Dữ liệu nghiêng về một phía thì ranh giới phán định cũng nghiêng theo.",
    "compare": "Ảo giác là vấn đề không có căn cứ, thiên lệch là vấn đề dữ liệu bị lệch."
  },
  "RLHF": {
    "point": "Khi người chọn câu trả lời tốt hơn, lựa chọn đó thành điểm số để tinh chỉnh lại mô hình.",
    "compare": "Fine-tuning sửa mô hình bằng dữ liệu đáp án, RLHF sửa bằng sở thích của con người."
  },
  "적대적 공격": {
    "point": "Nhiễu mà mắt người không thấy lại lật ngược phán định của mô hình.",
    "compare": "Ảo giác là bịa ra không căn cứ, tấn công đối kháng là cố tình đánh lừa."
  },
  "사전 학습": {
    "point": "Giai đoạn định hình khung ngôn ngữ đầu tiên bằng cách đọc lượng văn bản khổng lồ, không cần đáp án.",
    "compare": "Tiền huấn luyện là bước nền móng đầu tiên, fine-tuning·RLHF là bước mài giũa sau đó."
  },
  "휴먼 인 더 루프": {
    "point": "Cấu trúc chỉ chuyển sang bước tiếp theo khi người xác nhận kết quả xử lý tự động.",
    "compare": "Có cổng chặn thì giá trị sai bị giữ lại, không có thì đi thẳng ra ngoài."
  },
  "생성형 AI": {
    "point": "Không phải chọn lựa, mà tạo ra thứ chưa từng tồn tại.",
    "why": [
      "Dù sai vẫn tạo ra thứ nghe có vẻ hợp lý — đó chính là ảo giác."
    ]
  },
  "멀티모달": {
    "point": "Biến các loại đầu vào khác nhau thành điểm trên cùng một hệ tọa độ để xử lý cùng nhau.",
    "compare": "Mô hình chỉ có một cổng vào thì không có chỗ để đưa ảnh vào."
  },
  "컴퓨터 비전": {
    "point": "Với máy, ảnh chỉ là lưới số — từ đó rút ra cái gì đang ở đâu.",
    "why": [
      "Phân loại · phát hiện · theo dõi đều được xây trên nền này."
    ]
  },
  "음성인식": {
    "point": "Việc khớp đúng đoạn âm thanh nào ứng với từ nào.",
    "compare": "Nhận dạng khớp theo thời gian, tổng hợp thì tạo ra ngữ điệu."
  },
  "음성합성": {
    "point": "Đổi chữ thành âm thanh thì dễ, khó là ở việc thêm ngữ điệu.",
    "why": [
      "Không có ngữ điệu thì dù nội dung đúng vẫn nghe như giọng robot."
    ]
  },
  "광학문자인식": {
    "point": "Chữ trong ảnh chỉ là hình vẽ — biến nó thành chữ có thể sửa được.",
    "why": [
      "Biển hiệu bị nghiêng hay tối thì ngay từ việc tìm vị trí đã thất bại."
    ]
  },
  "디퓨전": {
    "point": "Thêm nhiễu thì dễ. Chỉ cần học cách đảo ngược từng bước đó.",
    "why": [
      "Không vẽ trong một lần, mà gỡ nhiễu dần dần hàng chục lần."
    ]
  },
  "텍스트-투-이미지": {
    "point": "Dù bắt đầu từ cùng một nhiễu, từ ngữ sẽ quyết định nó đi về đâu.",
    "compare": "Diffusion là cách tạo ra ảnh, text-to-image là dùng từ ngữ để dẫn dắt cách đó."
  },
  "딥페이크": {
    "point": "Chỉ thay lớp vỏ bề ngoài — chuyển động vẫn là của người khác.",
    "why": [
      "Nếu ghép cả giọng nói thì mắt·tai gần như không phân biệt được."
    ]
  },
  "자연어처리(NLP)": {
    "point": "Chia nhỏ lời nói thành dạng mà máy tính đếm được.",
    "compare": "NLP xử lý ngôn ngữ, computer vision xử lý hình ảnh."
  },
  "감정 분석": {
    "point": "Chấm điểm tích cực · tiêu cực dựa trên các từ trong câu."
  },
  "기계번역": {
    "point": "Không thay từng từ, mà gom theo nghĩa rồi diễn đạt lại."
  },
  "비식별화": {
    "point": "Không xóa đi, mà chỉ che phần giúp nhận ra người đó.",
    "compare": "Ẩn danh hóa là che đi, mã hóa là dùng khóa để đọc lại được."
  },
  "구조화 출력": {
    "point": "Bắt trả lời theo đúng khuôn định sẵn thay vì văn xuôi."
  },
  "문맥 요약": {
    "point": "Giữ nguyên kích thước cửa sổ, gấp gọn hội thoại cũ để tạo chỗ trống.",
    "compare": "Cửa sổ ngữ cảnh là kích thước cái hộp, tóm tắt ngữ cảnh là việc gấp gọn bên trong nó."
  },
  "초음파 센서": {
    "point": "Cảm biến đo thời gian rồi đổi ra khoảng cách, chứ không đo trực tiếp khoảng cách.",
    "compare": "Siêu âm dùng âm thanh, LiDAR dùng ánh sáng để đo thời gian khứ hồi."
  },
  "자이로 센서": {
    "point": "Cảm biến đo tốc độ quay (vận tốc góc), không phải góc.",
    "compare": "Gyro đo tốc độ quay, cảm biến gia tốc đo hướng nghiêng."
  },
  "조도 센서": {
    "point": "Đổi độ sáng thành điện áp, xuống dưới ngưỡng thì bật công tắc."
  },
  "펄스 폭 변조": {
    "point": "Giữ nguyên điện áp, chỉ đổi tỷ lệ thời gian bật để điều chỉnh cường độ.",
    "compare": "PWM là cách điều chỉnh đầu ra, driver động cơ là linh kiện truyền tải lực đó."
  },
  "모터 드라이버": {
    "point": "Thiết bị trung chuyển khuếch đại tín hiệu yếu thành dòng điện lớn để truyền cho động cơ."
  },
  "아날로그 신호": {
    "point": "Giá trị liên tục không đứt đoạn. Digital cắt nó thành từng bậc để lưu."
  },
  "빅오 표기법": {
    "point": "Không xem mất bao nhiêu giây, mà xem tăng bao nhiêu lần khi kích thước lớn lên."
  },
  "선택 정렬": {
    "point": "Mỗi lượt, đưa giá trị nhỏ nhất trong phần còn lại lên đầu.",
    "compare": "Selection sort chọn giá trị nhỏ nhất, bubble sort liên tục đổi chỗ hai phần tử liền kề."
  },
  "순차 탐색": {
    "point": "Dữ liệu chưa sắp xếp thì buộc phải xem từng cái từ đầu.",
    "compare": "Nếu đã sắp xếp thì tìm kiếm nhị phân xóa dần một nửa sẽ nhanh hơn nhiều."
  },
  "중첩 루프": {
    "point": "Vòng trong phải chạy hết thì vòng ngoài mới tiến thêm một bước.",
    "why": [
      "Số lần chạy tăng theo phép nhân tương ứng với số vòng lồng nhau."
    ],
    "compare": "Hai lớp vòng lặp lồng nhau tạo thành đường cong N² trong đồ thị Big-O ở trên."
  },
  "AND 연산자": {
    "point": "Chỉ đi qua khi cả hai điều kiện cùng đúng."
  },
  "순서도": {
    "point": "Đường đi rẽ nhánh theo điều kiện tại hình thoi.",
    "why": [
      "Hình elip = bắt đầu·kết thúc, hình chữ nhật = xử lý, hình thoi = phán đoán."
    ]
  },
  "예외 처리": {
    "point": "Là lối tắt đào sẵn để không dừng lại dù có lỗi xảy ra."
  },
  "메시지 방송": {
    "point": "Chỉ cần phát một lần, tất cả những ai đang chờ đều hành động cùng lúc.",
    "compare": "Gọi hàm nhắm đích danh một bên, broadcast thì ai cũng nhận được."
  },
  "합성곱 신경망(CNN)": {
    "point": "Một bộ lọc duy nhất quét khắp ảnh để lặp lại tìm cùng một họa tiết.",
    "compare": "Mạng kết nối đầy đủ dùng trọng số khác nhau cho từng pixel, CNN tái sử dụng nguyên bộ lọc."
  },
  "세그멘테이션": {
    "point": "Vượt ra ngoài có·không, vẽ cả đường viền pixel của vật thể."
  },
  "IoU": {
    "point": "Giá trị lấy diện tích chồng lấp chia cho diện tích hợp lại, càng lớn càng chính xác.",
    "compare": "IoU là độ chính xác của một hộp, mAP là điểm trung bình gộp tất cả lại."
  },
  "혼동 행렬": {
    "point": "Chia đúng sai thành bốn loại, cùng là sai nhưng thiệt hại lại khác nhau."
  },
  "데이터 증강": {
    "point": "Biến dạng ảnh đã có để tăng nhân tạo số lượng mẫu học.",
    "compare": "Học chuyển giao tái sử dụng mô hình đã học, augmentation tăng số lượng ảnh đã có."
  },
  "카메라 캘리브레이션": {
    "point": "Dùng hệ số làm phẳng hình ảnh bị ống kính bẻ cong để khớp với kích thước thực.",
    "why": [
      "Muốn dùng vị trí camera đo được làm tọa độ cho robot, phải hiệu chỉnh cái này trước."
    ]
  },
  "비최대 억제(NMS)": {
    "point": "Xóa dần từ hộp dự đoán chồng lấp có độ tin cậy thấp nhất, chỉ giữ lại một.",
    "compare": "Dùng IoU đo độ chồng lấp, vượt ngưỡng thì NMS sẽ xóa đi."
  },
  "합성 데이터": {
    "point": "Dùng bộ mô phỏng tạo ra cảnh chưa từng được chụp, kèm cả nhãn dán sẵn.",
    "compare": "Data augmentation biến dạng ảnh đã có, synthetic data tạo hẳn cảnh chưa từng tồn tại."
  },
  "양자화": {
    "point": "Giảm độ chia nhỏ vốn đo số chi tiết, để lại giá trị nhẹ hơn nhưng thô hơn.",
    "why": [
      "Không chỉ giảm lưu trữ mà cả tính toán, nên tốc độ suy luận cũng nhanh hơn."
    ],
    "compare": "Lượng tử hóa cắt gọt cùng một mô hình, chưng cất tri thức dạy mới một mô hình nhỏ hơn."
  },
  "지식 증류": {
    "point": "Mô hình nhỏ học theo cả mức độ tự tin của mô hình lớn, chứ không chỉ đáp án."
  },
  "AI 에이전트": {
    "point": "Không dừng sau một câu trả lời, mà dùng công cụ, kiểm tra rồi lặp lại.",
    "compare": "Chatbot kết thúc sau một lượt hội thoại, agent tự lặp lại cho đến khi xong."
  },
  "포지셔널 인코딩": {
    "point": "Đọc cùng lúc thì mất thứ tự, nên gắn thêm số vị trí để khôi phục lại.",
    "compare": "Nếu embedding đổi nghĩa thành tọa độ, thì cái này thêm thứ tự vào tọa độ đó."
  },
  "도메인 랜덤화": {
    "point": "Chỉ trải nghiệm một môi trường sẽ vấp ngã trước thực tế lạ, nên phải xáo trộn mạnh sân huấn luyện.",
    "compare": "Data augmentation thay đổi ảnh, domain randomization thay đổi cả vật lý của sân huấn luyện."
  },
  "그래프 신경망(GNN)": {
    "point": "Trên cấu trúc liên kết không phải lưới hay chuỗi, gom giá trị hàng xóm để sửa giá trị của mình.",
    "compare": "CNN quét theo lưới, GNN gom theo liên kết dù có bao nhiêu hàng xóm."
  },
  "유전 알고리즘": {
    "point": "Chọn hai đáp án tốt để lai, đổi ngẫu nhiên một phần, nâng điểm cao nhất qua từng thế hệ.",
    "compare": "Brute-force thử hết tất cả, còn cái này lai giữa những cái tốt để dần thu hẹp."
  }
}
