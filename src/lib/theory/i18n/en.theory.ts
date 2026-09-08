// DAILY QUIZ 해설 글 — en. 키는 한국어 정답 용어 그대로.
export const THEORY: Record<string, { point: string; why?: string[]; compare?: string }> = {
  "엔드 이펙터": {
    point: "The arm stays the same — only the tip swaps. The catch: the reference point (TCP) moves with it.",
    compare: "End effector = the whole tool at the tip · gripper = just the hand that grips.",
  },
  "서보모터": {
    point: "A motor that checks its own angle and corrects itself if it's off.",
    why: ["Used where position can't drift — robot joints, CNC. The encoder that makes this possible also makes it pricier."],
  },
  "매니퓰레이터": {
    point: "The whole robot-arm structure, joints linked like a chain — shoulder to wrist.",
    why: ["People say “grab that,” not joint angles. So control actually means solving inverse kinematics."],
    compare: "Arm = manipulator · hand = end effector · muscle = actuator.",
  },
  "그리퍼": {
    point: "The hand that grips objects. The hard part isn't grabbing — it's controlling the force.",
    why: ["Pincer types are the default; smooth surfaces get vacuum suction; metal gets an electromagnet."],
  },
  "자유도(DOF)": {
    point: "The number of directions it can move independently. Six is enough in 3D space.",
    why: ["From 7 axes on, the same point can be reached in multiple poses to dodge obstacles (cobots)."],
    compare: "DOF is the “number of directions,” torque is the “turning force.” More axes don't mean more strength.",
  },
  "인공지능(AI)": {
    point: "Technology where the computer finds the rules from data, instead of a person writing them.",
    why: ["Old systems wrote in expert rules by hand, but hit a wall — you can't write down every exception."],
  },
  "딥러닝": {
    point: "Stacks neural network layers so the model learns even what to look at.",
    why: ["The theory dates to the 1980s, but it took off in the 2010s once GPUs and big data arrived."],
    compare: "Classic ML: a human picks the features to look at. Deep learning learns those too.",
  },
  "피지컬 AI": {
    point: "AI that steps off the screen and touches reality with a body.",
    compare: "A chatbot's mistake just gets asked again; a robot's wrong move is already an accident.",
  },
  "프롬프트 엔지니어링": {
    point: "Add conditions to the instruction one by one, and the answer narrows toward what you want.",
    compare: "Fine-tuning changes the model itself; this only changes the instruction.",
  },
  "롤 프롬프팅": {
    point: "The same question gets a different answer depending on who you say you're asking.",
    compare: "A role is a viewpoint swapped in once; a system prompt is a rule that stays underneath the whole time.",
  },
  "퓨샷 프롬프팅": {
    point: "Shows the format of the answer through examples — not the answer itself.",
    compare: "No examples is zero-shot; a few examples is few-shot.",
  },
  "생각의 사슬": {
    point: "Raises accuracy by forcing it through intermediate steps instead of answering in one shot.",
    compare: "Few-shot gives the format through examples; this forces the reasoning steps themselves.",
  },
  "네거티브 프롬프트": {
    point: "An instruction that names only what to block, not what you want.",
    compare: "A normal prompt says what's allowed; this says what isn't.",
  },
  "시스템 프롬프트": {
    point: "A rule set before the conversation starts, applied to every turn after.",
    compare: "Injection is an attack that tries to sneak past this rule through user input.",
  },
  "프롬프트 인젝션": {
    point: "The model doesn't tell rules and user input apart — it just reads them stitched together.",
    why: ["So if a command-shaped sentence slips into the input, it just gets executed."],
    compare: "SQL injection mixes commands into code; this mixes commands into sentences.",
  },
  "프롬프트 템플릿": {
    point: "Fix the frame, swap in values for the blanks, and mass-produce.",
    compare: "A template fixes the frame outright; few-shot lets the frame be guessed from examples.",
  },
  "인터럽트": {
    point: "Drops whatever it's doing the moment a signal arrives, and handles that first.",
    compare: "Polling means you keep asking; an interrupt means the other side tells you.",
  },
  "워치독 타이머": {
    point: "Forces a reboot if no signal arrives within a set time.",
    compare: "A real-time clock tracks the time of day; a watchdog catches when something's frozen.",
  },
  "직접 메모리 접근(DMA)": {
    point: "A peripheral moves data straight to memory, without going through the CPU.",
    compare: "An interrupt briefly calls on the CPU; DMA skips the CPU entirely.",
  },
  "메모리 정렬": {
    point: "Pads empty bytes between data so the CPU can read it in one go.",
    why: ["Costs some size, but cuts the number of reads."],
  },
  "포인터": {
    point: "A variable that carries the address of a value, not the value itself.",
    compare: "Hands over just one address, instead of copying a whole block of data.",
  },
  "PID 제어": {
    point: "Sets the output by adding up three things: the current error, the accumulated error, and the rate of change.",
    compare: "P alone stalls near the target; I and D clean up the leftover error and the wobble.",
  },
  "이동 평균 필터": {
    point: "Slides a window, averaging the last few values, to smother noise.",
    compare: "Widen the window and it smooths more, but lags further behind real changes.",
  },
  "칼만 필터": {
    point: "Blends the predicted value and the measured value by how much to trust each, landing close to the truth.",
    compare: "A moving average only looks at past values; Kalman weighs prediction and measurement together.",
  },
  "비상 정지": {
    point: "The last-resort device that cuts power straight through the wiring, bypassing the control program entirely.",
    compare: "An interlock blocks one thing against another; an e-stop skips even the software.",
  },
  "인터록 회로": {
    point: "When one side turns on, it physically cuts the other circuit so both can't be on at once.",
    compare: "An e-stop shuts everything down; an interlock only keeps two things that must not overlap apart.",
  },
  "교착 상태": {
    point: "Each side holds its own goal so hard that they block each other's path — nobody can move.",
    why: ["One side yields, breaks the cycle, and the rest comes loose."],
  },
  "센서 스푸핑": {
    point: "Never touches the code — feeds the sensor a fake physical signal and fools the reading itself.",
    compare: "Hacking intercepts the communication; spoofing changes the world the sensor sees.",
  },
  "액션 통신": {
    point: "Sends a goal for a long task, and keeps exchanging progress and cancellation the whole time.",
    compare: "A topic is fire-and-forget, a service blocks until the reply comes back — only an action keeps talking in between.",
  },
  "복셀 그리드 다운샘플링": {
    point: "Splits the point cloud into grid cells and folds each cell down to one representative point.",
    why: ["Make the cells too big, and the thin parts vanish first."],
  },
  "엣지 컴퓨팅": {
    point: "Processes data nearby instead of sending it all the way to the cloud, cutting round-trip time.",
    compare: "Edge still sends to nearby equipment; on-device never leaves the machine at all.",
  },
  "디지털 트윈": {
    point: "A virtual copy that moves exactly like the real thing — state and test results flow both ways.",
    compare: "Plain monitoring just watches; a twin feeds results run in simulation back into the real thing.",
  },
  "온디바이스 AI": {
    point: "Everything from sensing to decision happens inside the device — raw data never leaves.",
    compare: "Edge still sends data as far as nearby equipment; this never crosses the device's own wall.",
  },
  "예지 보전": {
    point: "Not a fixed date, not a breakdown — the trend signal in the data decides when to fix it.",
  },
  "처방적 분석": {
    point: "The step after descriptive, diagnostic, and predictive — it doesn't just inform, it orders the action.",
  },
  "액추에이터": {
    point: "It can't decide anything — a signal comes in, it just moves.",
  },
  "센서": {
    point: "Measuring isn't the end — it has to turn the value into a signal and send it out.",
  },
  "엔코더": {
    point: "Counts pulses to know how many degrees it turned — the servo's eyes.",
    compare: "The encoder produces the number; the servo uses that number to correct its position.",
  },
  "토크": {
    point: "The same force spins harder the farther it's applied from the axis.",
  },
  "역기구학": {
    point: "People talk in coordinates — this is the math that turns that into joint angles.",
  },
  "순기구학": {
    point: "Know the angles, and the fingertip position falls right out of the math.",
  },
  "SLAM": {
    point: "You need the map to know your position, and your position to draw the map — it solves both at once.",
    compare: "String together the distances a sensor like lidar measures, and it becomes a map.",
  },
  "라이다(LiDAR)": {
    point: "Since the speed of light is known, timing the round trip alone gives the distance.",
    compare: "A camera sees color and shape; lidar times the round trip.",
  },
  "자율주행": {
    point: "The whole loop — perceive, decide, act — running on its own, every instant.",
    compare: "Path planning is just the piece of that loop that computes \"where to go.\"",
  },
  "경로계획": {
    point: "Computing, before you even start, a single line that dodges every obstacle.",
    compare: "Autonomous driving is the whole loop that actually perceives and decides while running that path.",
  },
  "협동로봇(코봇)": {
    point: "No fence not because it's gentle, but because it throttles its own force and speed.",
    why: ["Slows down when a person gets close, and drops force sharply on contact."],
  },
  "휴머노이드 로봇": {
    point: "Why it's shaped like a person — stairs, doors, and tools are already built for a human body.",
    compare: "Wheels only go as far as flat ground; legs can still plant a foot on the next step.",
  },
  "촉각 센서": {
    point: "Reads pressure and texture on contact — it only knows once it touches.",
    compare: "Proprioception knows its own joint position without touching anything.",
  },
  "자기수용감각": {
    point: "Knows its own joint angle right now, without ever looking outside.",
    compare: "A tactile sensor has to touch something outside to know; this knows without touching anything.",
  },
  "컴플라이언트 제어": {
    point: "On impact, it doesn't hold firm — it gives ground exactly as much as it's pushed, absorbing the force.",
    compare: "Position control insists on the angle and strains against it; this one steps aside instead.",
  },
  "스와름 로보틱스": {
    point: "No conductor — the whole formation emerges from a rule that only watches a few nearby robots.",
    why: ["Each one only reacts to its neighbors' positions — nobody is drawing the big picture."],
  },
  "신경망": {
    point: "Multiplies each input by a weight, sums them, and fires a signal onward once it clears the threshold.",
    compare: "Deep learning is just this neuron, stacked in many layers.",
  },
  "지도학습": {
    point: "Keeps the answer key alongside, adjusting predictions until they match it.",
    compare: "Unsupervised learning has no answer key — the data sorts itself out.",
  },
  "비지도학습": {
    point: "No answer key — the data groups whatever is close together, on its own.",
    compare: "Supervised learning checks against an answer; unsupervised has no answer to check against.",
  },
  "강화학습": {
    point: "Tries things, and a reward arriving much later reinforces the choices that led there.",
    compare: "Imitation learning copies someone else's path; reinforcement learning lives through it directly.",
  },
  "모방학습": {
    point: "Learns by copying the expert's demonstrated path, point by point.",
    compare: "Reinforcement learning learns from reward; imitation learning just copies the demonstration.",
  },
  "과적합": {
    point: "Nails every point it's already seen, but badly misses on anything new.",
  },
  "트랜스포머": {
    point: "Doesn't read one token at a time in order — lays everything out at once and lets it all cross-reference.",
    compare: "The earlier model (RNN) only ever read one token at a time, in order.",
  },
  "하이퍼파라미터": {
    point: "A value data can't decide — a human sets it by hand, before training even starts.",
    why: ["One single value can flip both convergence speed and stability entirely."],
  },
  "임베디드 AI": {
    point: "The memory and power available are nailed down from the start, to this one device.",
    compare: "On-device and edge describe where the processing happens; embedded describes how much resource it gets to use there.",
  },
  "실시간 제어": {
    point: "The average can be fast — but miss even one deadline, and that's it, it's over.",
    compare: "Asynchronous control just has to finish eventually; real-time control fails the instant it misses a deadline.",
  },
  "시뮬레이션 투 리얼(Sim-to-Real)": {
    point: "Same policy, same action — yet it slips in reality. That gap is called the reality gap.",
    compare: "A digital twin is a mirror that keeps reflecting the real thing; sim-to-real is the one-time move of a learned policy into reality.",
  },
  "VLA 모델": {
    point: "The whole middle layer of hand-written rules is gone — what's seen and heard becomes action directly.",
    compare: "A foundation model is one base shared across many tasks; VLA is the structure that connects perception straight through to action.",
  },
  "파운데이션 모델": {
    point: "One base, trained big just once — each task only needs a little extra teaching on top.",
    compare: "VLA is the structure connecting input to action; a foundation model is the general-purpose base that can sit inside it.",
  },
  "강건성(Robustness)": {
    point: "Looking strong only when conditions are exactly right isn't real strength.",
    compare: "Generalization is holding up on new data; robustness is not collapsing when conditions shake.",
  },
  "거대언어모델(LLM)": {
    point: "All it really does is pick the next single piece. Scale did the rest.",
    compare: "Search fetches something from somewhere; this makes something new, every time.",
  },
  "토큰": {
    point: "Not a letter, not a word — a piece the model defines. Its count is both the length and the bill.",
    why: ["Korean often gets cut character by character, so the same meaning eats up more pieces."],
  },
  "컨텍스트 창": {
    point: "The width it can see at once. What overflows isn't summarized — it's forgotten.",
    compare: "A token is the unit of one piece; this is how many of those pieces fit at once.",
  },
  "임베딩": {
    point: "Turns meaning into coordinates. Close means similar, and direction carries the relationship.",
    compare: "Tokenizing cuts text into pieces; embedding gives those pieces coordinates.",
  },
  "어텐션 메커니즘": {
    point: "Decides, with a weight, where each word should be looking right now.",
    why: ["Connects even far-apart words in one step — the heart of the transformer."],
  },
  "다음 토큰 예측": {
    point: "The sentence isn't planned in advance. Attach one piece, then choose again from scratch.",
    compare: "That's why the same question can produce a different sentence every time.",
  },
  "온도(Temperature)": {
    point: "Leaves the candidates alone — only sharpens the distribution (safe) or flattens it (varied).",
    compare: "Temperature reshapes the distribution; top-p cuts down the number of candidates.",
  },
  "탑피(Top-P)": {
    point: "Stacks candidates by probability, highest first, keeping only enough to reach p.",
    compare: "Cut by count and it's top-k; cut by cumulative probability and it's this.",
  },
  "코사인 유사도": {
    point: "Ignores length, looks only at the angle between them. Closer to 1 means closer in meaning.",
    compare: "Euclidean distance is how far apart they are; this is which way they're facing.",
  },
  "머신러닝": {
    point: "No human writes the rules. It finds the boundary from examples on its own.",
    compare: "Rules grow one by one, by hand; learning just needs more examples.",
  },
  "파인튜닝": {
    point: "Retunes the internal numbers of an already-trained model, using domain-specific data.",
    compare: "RAG swaps in documents from outside the model; fine-tuning fixes the inside of the model.",
  },
  "RAG": {
    point: "Leaves the model untouched — fetches a document before answering and attaches it as evidence.",
    compare: "Fine-tuning fixes the model; RAG swaps in documents alongside it.",
  },
  "환각": {
    point: "Even with no evidence, the sentence still gets finished as long as the probability is high.",
    compare: "Bias is data skewed one way; hallucination is making something up with no evidence at all.",
  },
  "편향": {
    point: "When the data leans one way, the decision boundary leans with it.",
    compare: "Hallucination is a lack-of-evidence problem; bias is a skewed-data problem.",
  },
  "RLHF": {
    point: "A person picks the better answer, and that choice becomes a score that retunes the model.",
    compare: "Fine-tuning fixes the model with labeled data; RLHF fixes it with human preference.",
  },
  "적대적 공격": {
    point: "Noise invisible to the human eye flips only the model's verdict.",
    compare: "Hallucination is making things up with no evidence; an adversarial attack is deliberately deceiving it.",
  },
  "사전 학습": {
    point: "The stage where it first shapes its sense of language, reading vast text with no answer key.",
    compare: "Pretraining lays the first foundation; fine-tuning and RLHF polish what comes after.",
  },
  "휴먼 인 더 루프": {
    point: "A structure where a human must check the automated result before it moves to the next step.",
    compare: "With the gate, a wrong value gets caught; without it, the wrong value just goes right through.",
  },
  "생성형 AI": {
    point: "It doesn't pick — it makes something that didn't exist and hands it over.",
    why: ["It makes things sound plausible even when they're wrong — that's hallucination."],
  },
  "멀티모달": {
    point: "Turns inputs of different kinds into points on the same coordinate system and handles them together.",
    compare: "A model with only one entrance has no slot to put a photo in.",
  },
  "컴퓨터 비전": {
    point: "To a machine, a photo is just a grid of numbers — this pulls out what's where inside it.",
    why: ["Classification, detection, and tracking all sit on top of this."],
  },
  "음성인식": {
    point: "Matching up which stretch of sound belongs to which word.",
    compare: "Transcription lines up timing; synthesis builds the intonation.",
  },
  "음성합성": {
    point: "Turning text into sound is easy; laying intonation on top is hard.",
    why: ["Without intonation, even correct content sounds like a robot talking."],
  },
  "광학문자인식": {
    point: "Text in a photo is just a picture — this turns it into text you can actually edit.",
    why: ["If a sign is tilted or dark, it can't even find where the text is."],
  },
  "디퓨전": {
    point: "Adding noise is easy. It only ever learns how to undo one step of it.",
    why: ["It doesn't draw the image in one go — it strips noise away, a little at a time, dozens of times over."],
  },
  "텍스트-투-이미지": {
    point: "Even starting from the same noise, the words decide where it goes.",
    compare: "Diffusion is the method of making it; text-to-image is that method steered by words.",
  },
  "딥페이크": {
    point: "Only the face gets swapped — the motion still belongs to someone else.",
    why: ["Add the voice on top, and eyes and ears can barely tell anymore."],
  },
  "자연어처리(NLP)": {
    point: "Breaking speech into small pieces and turning it into something a computer can count.",
    compare: "NLP handles language; computer vision handles images.",
  },
  "감정 분석": {
    point: "Scores a sentence as positive or negative based on the words inside it.",
  },
  "기계번역": {
    point: "Doesn't swap word for word — it bundles the meaning and lays it out again.",
  },
  "비식별화": {
    point: "Doesn't delete — it just covers the fields that identify a person.",
    compare: "De-identification covers it up; encryption can still be read back with a key.",
  },
  "구조화 출력": {
    point: "Makes it answer into fixed fields, instead of free-flowing prose.",
  },
  "문맥 요약": {
    point: "Leaves the window size alone, and folds up past conversation to make room.",
    compare: "The context window is the size of the container; summarizing is folding up what's inside it.",
  },
  "초음파 센서": {
    point: "A sensor that measures time, not distance, and converts it into distance.",
    compare: "Ultrasonic times the round trip with sound; lidar does it with light.",
  },
  "자이로 센서": {
    point: "A sensor that measures rotation speed (angular velocity), not angle.",
    compare: "A gyro measures rotation speed; an accelerometer measures which way it's tilted.",
  },
  "조도 센서": {
    point: "Converts brightness into voltage, and switches on once it drops below a threshold.",
  },
  "펄스 폭 변조": {
    point: "Leaves the voltage alone and controls intensity purely by the ratio of on-time.",
    compare: "PWM is the method of controlling output; the motor driver is the part that supplies the muscle for it.",
  },
  "모터 드라이버": {
    point: "A relay device that amplifies a weak signal into a strong current and hands it to the motor.",
  },
  "아날로그 신호": {
    point: "A value that flows unbroken. Digital slices it into steps to store it.",
  },
  "빅오 표기법": {
    point: "Not how many seconds it takes — how many times it multiplies as things grow.",
  },
  "선택 정렬": {
    point: "Every pass, sends the smallest of what's left to the front.",
    compare: "Selection sort picks the minimum; bubble sort keeps swapping neighbors.",
  },
  "순차 탐색": {
    point: "Unsorted data leaves no choice but to check it one by one, from the start.",
    compare: "If it's sorted, binary search — cutting it in half each time — is far faster.",
  },
  "중첩 루프": {
    point: "The inner loop has to finish completely before the outer one moves one step.",
    why: ["Each layer of nesting multiplies the number of runs."],
    compare: "Two layers of nesting is exactly the N² curve from the big-O graph.",
  },
  "AND 연산자": {
    point: "Passes only when both conditions are true at the same time.",
  },
  "순서도": {
    point: "The diamond is where the path splits, depending on the condition.",
    why: ["Oval = start/end, rectangle = process, diamond = decision."],
  },
  "예외 처리": {
    point: "A side path dug in advance so an error doesn't bring everything to a halt.",
  },
  "메시지 방송": {
    point: "Fire it once, and everyone waiting moves at the same time.",
    compare: "A function call names exactly who to call; a broadcast is picked up by anyone listening.",
  },
  "합성곱 신경망(CNN)": {
    point: "One filter sweeps the whole image, hunting for the same pattern over and over.",
    compare: "A fully connected net uses a different weight per pixel; a CNN reuses the same filter everywhere.",
  },
  "세그멘테이션": {
    point: "Goes beyond present-or-not — it draws the object's outline down to the pixel.",
  },
  "IoU": {
    point: "The overlapping area divided by the combined area — bigger means a better match.",
    compare: "IoU is the accuracy of one box; mAP is the average score across all of them.",
  },
  "혼동 행렬": {
    point: "Split right and wrong into four buckets, and even the same wrong answer costs something different.",
  },
  "데이터 증강": {
    point: "Warps the photos you already have to artificially swell the training set.",
    compare: "Transfer learning reuses a trained model; augmentation inflates the number of photos you have.",
  },
  "카메라 캘리브레이션": {
    point: "Uses coefficients to straighten out what the lens bent, matching it back to real-world dimensions.",
    why: ["Before a robot can use a camera-measured position as a coordinate, this correction has to come first."],
  },
  "비최대 억제(NMS)": {
    point: "Among overlapping predicted boxes, erases the least confident first until only one remains.",
    compare: "IoU measures the overlap; once it crosses the threshold, NMS erases it.",
  },
  "합성 데이터": {
    point: "Builds scenes that were never shot, in a simulator, complete with labels attached.",
    compare: "Data augmentation warps photos that exist; synthetic data builds scenes that never did, from scratch.",
  },
  "양자화": {
    point: "Coarsens the fine scale numbers used to be measured on, leaving values that are lighter but blunter.",
    why: ["Cuts not just storage but computation too, so inference speeds up as well."],
    compare: "Quantization shaves down the same model; distillation teaches a new, smaller one.",
  },
  "지식 증류": {
    point: "The small model learns to copy not just the answer, but how confident the big model was.",
  },
  "AI 에이전트": {
    point: "Doesn't stop after one answer — it tries a tool, checks the result, then loops again.",
    compare: "A chatbot ends after one exchange; an agent keeps looping on its own until it's done.",
  },
  "포지셔널 인코딩": {
    point: "Reading everything at once erases order, so a position number gets added back on top.",
    compare: "If embedding turns meaning into coordinates, this adds order on top of those coordinates.",
  },
  "도메인 랜덤화": {
    point: "Train in only one environment and it misses in an unfamiliar reality — so the training ground gets shaken up hard.",
    compare: "Data augmentation changes the photo; domain randomization changes the physics of the training ground itself.",
  },
  "그래프 신경망(GNN)": {
    point: "On a structure that's neither a grid nor a line — a network — it updates its own value by gathering its neighbors'.",
    compare: "A CNN sweeps a grid; a GNN gathers along the connections, however many neighbors there are.",
  },
  "유전 알고리즘": {
    point: "Picks two good answers, mixes them, randomly flips one slot — raising the top score generation after generation.",
    compare: "Brute force tries everything; this narrows in by mixing the best performers together.",
  },
};
