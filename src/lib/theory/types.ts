// DAILY QUIZ 해설의 모양. 예전엔 terms.ts 안에 있었는데, 해설 묶음(batch*.ts)이 여러 파일이 되면서
// 여기로 뺐다 — 묶음이 terms.ts 를 import 하고 terms.ts 가 묶음을 import 하면 서로 물린다.
// ⚠️ `TermTheory` 는 terms.ts 가 그대로 다시 export 한다(옛 import 경로가 안 깨지게).

export interface TermTheory {
  /** 이거 하나만 기억하면 되는 한 줄. 결론을 뒤로 미루지 말 것. */
  point: string
  /** 그림 키 — components/DailyVisual.tsx 의 등록표에 있는 이름. 없으면 글만 나온다. */
  visual?: string
  /** 그림으로 못 말한 것만. **그림이 있으면 비워 두는 게 기본**이다. */
  why?: string[]
  /** 헷갈리는 짝을 대조해 주는 한 줄(선택). 그림이 이미 대조하고 있으면 넣지 말 것. */
  compare?: string
}
