// 월드 아레나 지구본 — 실사 지구 렌더러(WebGL).
//
// SVG(d3) 는 그대로 두고 **그 뒤에 캔버스 한 장**을 깔아 '지구 껍데기'만 그린다.
// d3 정사영의 파라미터(중심·반지름·회전)를 그대로 uniform 으로 받아 픽셀마다 역투영하므로
// SVG 의 나라 폴리곤과 좌표가 정확히 겹친다 — 드래그 회전·줌·드릴다운 로직은 하나도 안 건드린다.
//
// 그리는 것: 낮면(지형+수심 위성사진 · 램버트) · 밤면(도시 불빛) · 구름 · 바다 윤슬(정반사)
//            · 대기 산란(림 안쪽 + 바깥 헤일로).
//
// ⚠️ 실패하면(WebGL 미지원·텍스처 로드 실패) `null` 을 돌려준다. 호출부는 그때
//    기존 SVG 그라디언트 지구본을 그대로 쓰면 된다(폴백이 곧 예전 화면).

const RAD = Math.PI / 180

/**
 * 텍스처 — public/earth/*.webp (NASA Blue Marble / Black Marble, 퍼블릭 도메인).
 * 낮면만 4096×2048(670KB), 야경·구름은 2048×1024. 낮면은 확대(최대 8배)하면 바로 뭉개지는 게
 * 보여서 해상도를 올렸고, 나머지 둘은 원래 뿌연 그림이라 키워도 차이가 없다.
 */
const TEX = {
  day: '/earth/earth-day.webp',
  night: '/earth/earth-night.webp',
  cloud: '/earth/earth-clouds.webp',
}

/**
 * 태양을 카메라 쪽으로 얼마나 끌어당길지(0=실제 태양, 1=정면 조명).
 *
 * 지구본은 그림이기 전에 **순위를 읽는 지도**다. 실제 태양만 쓰면 한국 시각 밤에 접속한
 * 사람은 자기 나라가 밤면에 들어가 캄캄한 지구를 본다. 그렇다고 정면 조명을 박으면
 * 명암 경계(터미네이터)가 사라져 평평한 공이 된다. 그래서 실제 태양 방향을 카메라 쪽으로
 * 절반쯤 당겨 **경계선은 림 근처에 살려 두되 보이는 면은 항상 밝게** 만든다.
 */
const SUN_TO_CAMERA = 0.45

export interface GlobeView {
  /** 화면(=SVG viewBox) 좌표계의 구 중심 · 반지름. CSS px */
  cx: number
  cy: number
  r: number
  /** d3 projection.rotate() 값 그대로 [λ, φ, γ] (deg) */
  rot: [number, number, number]
  /** 0~1 전체 불투명도(레벨 전환 페이드용) */
  alpha?: number
}

export interface GlobeGL {
  /** 텍스처가 다 로드돼 실제로 그릴 수 있는 상태인가 */
  readonly ready: boolean
  resize(wCss: number, hCss: number): void
  render(v: GlobeView): void
  clear(): void
  destroy(): void
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

// 조각 셰이더 — 픽셀 → 구면 역투영 → 위경도 → 텍스처.
// (deriv = OES_standard_derivatives 사용 가능 여부. 이음매 보정과 밉맵에 쓴다)
const frag = (deriv: boolean) => `${deriv ? '#extension GL_OES_standard_derivatives : enable\n' : ''}
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
${deriv ? '#define HAS_DERIV 1' : ''}

uniform vec2  uCenter;   // 구 중심(CSS px, y 아래로)
uniform float uR;        // 구 반지름(CSS px)
uniform float uDpr;
uniform float uH;        // 캔버스 높이(디바이스 px)
uniform mat3  uInv;      // 뷰 좌표 → 지리 좌표(회전의 역)
uniform vec3  uSun;      // 뷰 좌표계 태양 방향(단위벡터)
uniform float uAlpha;
uniform float uCloudRot; // 구름층 경도 오프셋(0~1)
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform sampler2D uCloud;

const float PI = 3.14159265359;

// 적도원통 텍스처를 구에 감으면 경도 ±180° 이음매에서 u 가 1→0 으로 튀어, 그 픽셀 열만
// 밉맵 레벨이 바닥까지 떨어져 굵은 세로줄이 생긴다. 반 바퀴 어긋난 좌표로 한 번 더 떠서
// **이음매에 걸린 픽셀만** 그쪽 샘플을 쓴다(그쪽은 같은 자리가 연속이라 레벨이 정상).
vec3 eq(sampler2D t, float ux, float v) {
#ifdef HAS_DERIV
  vec3 a = texture2D(t, vec2(ux, v)).rgb;
  vec3 b = texture2D(t, vec2(fract(ux + 0.5), v)).rgb;
  return fwidth(ux) > 0.2 ? b : a;
#else
  return texture2D(t, vec2(ux, v)).rgb;
#endif
}

void main() {
  // gl_FragCoord 는 좌하단 원점 · 디바이스 px → SVG 와 같은 좌상단 원점 · CSS px 로 되돌린다.
  vec2 frag = vec2(gl_FragCoord.x / uDpr, (uH - gl_FragCoord.y) / uDpr);
  vec2 d = (frag - uCenter) / uR;
  float p = d.x;      // 정사영 x (오른쪽)
  float q = -d.y;     // 정사영 y (위쪽) — 화면 y 는 아래로 가므로 뒤집는다
  float r2 = p * p + q * q;
  float rr = sqrt(r2);

  if (rr > 1.0) {
    // ── 원반 바깥: 대기 헤일로. 태양을 등진 쪽은 얇고 마주보는 쪽이 두껍다.
    float t = (rr - 1.0) * uR;
    float halo = exp(-t / max(6.0, uR * 0.085));
    float face = 0.5 + 0.5 * dot(normalize(vec2(p, q) + 1e-6), normalize(uSun.yz + 1e-6));
    float a = halo * (0.08 + 0.5 * face) * uAlpha;
    gl_FragColor = vec4(vec3(0.33, 0.60, 1.0) * a, a);
    return;
  }

  // ── 원반 안쪽: 역정사영. 화면 (p,q) → 뷰 좌표계 단위벡터 n(x=관측자 방향)
  float X = sqrt(max(0.0, 1.0 - r2));
  vec3 n = vec3(X, p, q);
  vec3 g = uInv * n;                       // 지리 좌표계로
  float lon = atan(g.y, g.x);
  float lat = asin(clamp(g.z, -1.0, 1.0));
  float ux = fract(0.5 + lon / (2.0 * PI));
  float v = 0.5 - lat / PI;

  float cs = dot(n, uSun);                 // 태양 입사 코사인
  float lam = max(cs, 0.0);
  float day = smoothstep(-0.16, 0.24, cs); // 낮/밤 혼합(터미네이터 폭)

  vec3 dayT = eq(uDay, ux, v);
  vec3 nightT = eq(uNight, ux, v);
  float cloud = eq(uCloud, fract(ux + uCloudRot), v).r;

  // 바다 판별 = 파랑 우세. 별도 마스크 텍스처를 더 받지 않으려고 낮 사진에서 뽑는다
  // (윤슬·구름 감쇠에만 쓰므로 이 정도 근사로 충분하다).
  float sea = smoothstep(0.02, 0.15, dayT.b - max(dayT.r, dayT.g));

  vec3 col = dayT * (0.18 + 0.92 * lam);

  // 바다 정반사(윤슬) — 관측자는 +x 방향이다
  vec3 hv = normalize(uSun + vec3(1.0, 0.0, 0.0));
  col += vec3(0.55, 0.68, 0.85) * pow(max(dot(n, hv), 0.0), 48.0) * sea * 0.8 * day;

  // 구름층 — 낮면에서만 흰빛, 밤에는 불빛을 가리는 역할만 한다
  col = mix(col, vec3(0.95, 0.97, 1.0) * (0.22 + 0.9 * lam), cloud * 0.88 * day);

  vec3 night = nightT * 1.4 * (1.0 - cloud * 0.7) + vec3(0.012, 0.022, 0.05);
  col = mix(night, col, day);

  // 대기 산란 — 가장자리로 갈수록 푸르게 뜨고, 낮 쪽이 더 강하다
  float rim = pow(1.0 - X, 3.2);
  col += vec3(0.30, 0.55, 1.0) * rim * (0.18 + 0.75 * day);

  // 원반 경계 안티에일리어싱(1.5px)
  float a = clamp((1.0 - rr) * uR / 1.5, 0.0, 1.0) * uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`

/** 행 우선 3×3 곱 */
function mul3(a: number[], b: number[]): number[] {
  const o = new Array<number>(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return o
}

/**
 * d3 회전의 **역행렬**(뷰 → 지리). 행 우선.
 *
 * d3 의 rotate([λ,φ,γ]) 는 지리 좌표에 Rz(λ) → Ry(φ) → Rx(γ) 를 차례로 먹인다
 * (d3-geo/rotation.js 의 rotationLambda · rotationPhiGamma 를 벡터식으로 옮긴 것).
 * 우리는 화면 픽셀에서 시작하므로 그 역인 Rz(−λ)·Ry(−φ)·Rx(−γ) 가 필요하다.
 */
function invRot(rot: [number, number, number]): number[] {
  const l = rot[0] * RAD
  const f = rot[1] * RAD
  const gm = (rot[2] || 0) * RAD
  const cl = Math.cos(l)
  const sl = Math.sin(l)
  const cf = Math.cos(f)
  const sf = Math.sin(f)
  const cg = Math.cos(gm)
  const sg = Math.sin(gm)
  const rz = [cl, sl, 0, -sl, cl, 0, 0, 0, 1] // Rz(−λ)
  const ry = [cf, 0, sf, 0, 1, 0, -sf, 0, cf] // Ry(−φ)
  const rx = [1, 0, 0, 0, cg, sg, 0, -sg, cg] // Rx(−γ)
  return mul3(mul3(rz, ry), rx)
}

/** 남중점(subsolar point) 근사 → 지리 좌표계 단위벡터. 균시차(±4분)는 무시한다. */
function sunGeo(now: Date): [number, number, number] {
  const doy = (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000
  const decl = 23.44 * RAD * Math.sin((2 * Math.PI * (doy - 80.5)) / 365.25)
  const lon = -15 * RAD * (now.getUTCHours() + now.getUTCMinutes() / 60 - 12)
  return [Math.cos(decl) * Math.cos(lon), Math.cos(decl) * Math.sin(lon), Math.sin(decl)]
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[globeGL] shader:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function createGlobeGL(canvas: HTMLCanvasElement, onReady?: () => void): GlobeGL | null {
  const gl = (canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  }) ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  if (!gl) return null

  const deriv = !!gl.getExtension('OES_standard_derivatives')
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag(deriv))
  const prog = vs && fs ? gl.createProgram() : null
  if (!vs || !fs || !prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[globeGL] link:', gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)

  // 화면 전체 삼각형 2개
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const U = {
    center: gl.getUniformLocation(prog, 'uCenter'),
    r: gl.getUniformLocation(prog, 'uR'),
    dpr: gl.getUniformLocation(prog, 'uDpr'),
    h: gl.getUniformLocation(prog, 'uH'),
    inv: gl.getUniformLocation(prog, 'uInv'),
    sun: gl.getUniformLocation(prog, 'uSun'),
    alpha: gl.getUniformLocation(prog, 'uAlpha'),
    cloudRot: gl.getUniformLocation(prog, 'uCloudRot'),
  }
  ;(['uDay', 'uNight', 'uCloud'] as const).forEach((name, i) => {
    gl.uniform1i(gl.getUniformLocation(prog, name), i)
  })

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // 미리 곱해진 알파
  gl.clearColor(0, 0, 0, 0)

  // ── 텍스처 3장 ──
  const texs: WebGLTexture[] = []
  let ready = false
  let dead = false
  let pending = 3
  const urls = [TEX.day, TEX.night, TEX.cloud]
  urls.forEach((url, i) => {
    const tex = gl.createTexture()
    if (!tex) return
    texs[i] = tex
    gl.activeTexture(gl.TEXTURE0 + i)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // 로드 전 임시 픽셀(투명) — 로드 전에 그려도 셰이더가 깨지지 않게
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      if (dead) return
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      // 경도는 한 바퀴 돌아 이어지므로 가로만 REPEAT, 세로(극)는 CLAMP.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      if (deriv) {
        // 밉맵은 파생함수(=화면상 텍셀 밀도)가 있어야 의미가 있다. 없으면 축소 시
        // 지글거리는 대신 그냥 선형 보간으로 둔다.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.generateMipmap(gl.TEXTURE_2D)
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      }
      if (--pending === 0) {
        ready = true
        onReady?.()
      }
    }
    img.onerror = () => {
      console.warn('[globeGL] texture load failed:', url)
    }
    img.src = url
  })

  let cw = 0
  let ch = 0
  let dpr = 1

  return {
    get ready() {
      return ready
    },
    resize(wCss: number, hCss: number) {
      dpr = Math.min(window.devicePixelRatio || 1, 2) // 레티나에서 픽셀 수가 4배가 되므로 상한을 둔다
      cw = Math.max(1, Math.round(wCss * dpr))
      ch = Math.max(1, Math.round(hCss * dpr))
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }
    },
    clear() {
      gl.viewport(0, 0, cw, ch)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
    render(v: GlobeView) {
      if (!ready || !cw || !ch) return
      const inv = invRot(v.rot)
      // 태양: 지리 → 뷰 = 역행렬의 전치(회전이라 역 = 전치).
      const sg = sunGeo(new Date())
      let sx = inv[0] * sg[0] + inv[3] * sg[1] + inv[6] * sg[2]
      let sy = inv[1] * sg[0] + inv[4] * sg[1] + inv[7] * sg[2]
      let sz = inv[2] * sg[0] + inv[5] * sg[1] + inv[8] * sg[2]
      // 카메라(+x) 쪽으로 당겨 보이는 면이 항상 밝게(위 SUN_TO_CAMERA 주석 참고)
      sx = sx * (1 - SUN_TO_CAMERA) + SUN_TO_CAMERA
      sy *= 1 - SUN_TO_CAMERA
      sz *= 1 - SUN_TO_CAMERA
      const sl = Math.hypot(sx, sy, sz) || 1

      gl.viewport(0, 0, cw, ch)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(prog)
      gl.uniform2f(U.center, v.cx, v.cy)
      gl.uniform1f(U.r, v.r)
      gl.uniform1f(U.dpr, dpr)
      gl.uniform1f(U.h, ch)
      gl.uniform1f(U.alpha, v.alpha ?? 1)
      gl.uniform1f(U.cloudRot, 0.13)
      gl.uniform3f(U.sun, sx / sl, sy / sl, sz / sl)
      // WebGL1 은 transpose 를 지원하지 않으므로(=false 고정) 열 우선으로 뒤집어 올린다.
      gl.uniformMatrix3fv(U.inv, false, [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]])
      texs.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i)
        gl.bindTexture(gl.TEXTURE_2D, t)
      })
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
    destroy() {
      dead = true
      texs.forEach((t) => gl.deleteTexture(t))
      gl.deleteBuffer(buf)
      gl.deleteProgram(prog)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      // ⚠️ WEBGL_lose_context 로 컨텍스트를 죽이지 않는다. getContext() 는 같은 캔버스에 대해
      //    **같은 컨텍스트**를 돌려주므로, 개발 모드(StrictMode 이중 마운트)에서 정리 → 재생성
      //    순서를 타면 두 번째 생성이 이미 죽은 컨텍스트를 받아 셰이더 컴파일부터 전부 실패한다.
      //    캔버스 엘리먼트가 언마운트와 함께 사라지므로 GPU 자원은 어차피 회수된다.
    },
  }
}
