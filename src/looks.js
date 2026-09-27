// 룩. 움직임은 그대로 두고 보이는 것만 바꾼다 — 같은 필름에 다른 현상을 거는 것과 같다.
//
// 한 벌은 세 층으로 이뤄진다.
//   무대   — 바탕과 판과 선과 글자의 색. 밝은 룩은 여기부터 달라야 한다
//   빛     — 톤 매핑과 노출, 반사광의 세기, 블룸. 밝은 것이 얼마나 번지는가
//   보정   — 톤 매핑이 끝난 화면 위에서 하는 색보정. 리프트와 게인, 대비, 채도, 비네트, 그레인
//
// 보정을 톤 매핑 뒤에 두는 것은 색보정가가 일하는 순서가 그렇기 때문이다. 선형 공간에서
// 대비를 올리면 밝은 쪽이 톤 매핑에 먹혀 의도한 만큼 서지 않는다.

import * as THREE from "three";

export const LOOKS = {
  clean: {
    name: "CLEAN",
    note: "보정 없음. 곡선을 판단할 때",
    stage: { background: "#111215", panel: "#1b1d22", grid: "#2c3038", reference: "#4a4f5a", track: "#3a3e47", ink: "#ffffff", muted: "#8a8f99", shadow: 0.32 },
    light: { toneMapping: THREE.NeutralToneMapping, exposure: 1, env: 0.9, bloom: [0, 0, 1], tint: [1, 1, 1] },
    grade: { lift: [0, 0, 0], gain: [1, 1, 1], contrast: 1, saturation: 1, vignette: 0, grain: 0 },
    theme: "dark"
  },
  glow: {
    name: "GLOW",
    note: "어둠 속에서 선과 공이 번진다. 모션 그래픽의 흔한 얼굴",
    stage: { background: "#06070b", panel: "#0e1016", grid: "#1f232c", reference: "#3a3f4b", track: "#2a2e38", ink: "#ffffff", muted: "#7d8494", shadow: 0.4 },
    light: { toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.85, env: 0.7, bloom: [0.75, 0.15, 0.1], tint: [1, 1, 1] },
    grade: { lift: [0, 0.004, 0.02], gain: [0.98, 1, 1.05], contrast: 1.08, saturation: 1.18, vignette: 0.38, grain: 0.018 },
    theme: "dark"
  },
  film: {
    name: "FILM",
    note: "따뜻하게 들뜬 검정, 빠진 채도, 입자. 필름 스캔 같은 결",
    stage: { background: "#15120e", panel: "#1e1a15", grid: "#302a22", reference: "#5a5145", track: "#3d362c", ink: "#f4e8d4", muted: "#a0927d", shadow: 0.36 },
    light: { toneMapping: THREE.AgXToneMapping, exposure: 1.05, env: 0.85, bloom: [0.5, 0.4, 0.5], tint: [1, 0.55, 0.32] },
    grade: { lift: [0.035, 0.024, 0.006], gain: [1.05, 1, 0.9], contrast: 0.94, saturation: 0.9, vignette: 0.52, grain: 0.075 },
    theme: "dark"
  },
  paper: {
    name: "PAPER",
    note: "밝은 종이 위. 인쇄물이나 슬라이드에 올릴 때",
    stage: { background: "#ece6d9", panel: "#e1d9c9", grid: "#cbc2b0", reference: "#a39a88", track: "#bcb3a1", ink: "#2b2724", muted: "#7a7163", shadow: 0.16 },
    light: { toneMapping: THREE.NeutralToneMapping, exposure: 1, env: 1, bloom: [0, 0, 1], tint: [1, 1, 1] },
    grade: { lift: [0.01, 0.008, 0], gain: [1, 0.99, 0.96], contrast: 1.03, saturation: 0.9, vignette: 0.14, grain: 0.035 },
    theme: "light"
  }
};

// 블룸은 [세기, 반경, 문턱]. 반경을 키우면 가장 흐린 층이 두꺼워져 화면 전체가 뿌옇게 뜬다 —
// 선이 열두 줄이나 있는 화면에서는 번짐을 좁게 쥐어야 선이 선으로 남는다.
// tint는 번짐의 색이다. FILM은 붉게 번진다 — 필름의 헐레이션, 빛이 필름 뒷면에 튕겨 붉은 테를 두르는 것.
// AgX는 채도를 이미 한 번 뺀다. 보정에서 더 빼면 열두 줄의 색이 한 색으로 뭉개진다.

// 톤 매핑 뒤의 색보정. 화면 공간에서 돈다.
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    contrast: { value: 1 },
    saturation: { value: 1 },
    vignette: { value: 0 },
    grain: { value: 0 },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 lift;
    uniform vec3 gain;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    uniform float grain;
    uniform float time;
    uniform vec2 resolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = source.rgb;

      // 리프트는 어두운 쪽을, 게인은 밝은 쪽을 민다
      color = color * gain + lift * (1.0 - color);

      // 대비는 가운데 회색을 축으로
      color = (color - 0.5) * contrast + 0.5;

      // 채도는 밝기를 지키며
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, saturation);

      // 비네트. 가로세로 비를 맞춰 동그랗게 떨어진다
      vec2 away = vUv - 0.5;
      away.x *= resolution.x / resolution.y;
      color *= 1.0 - vignette * smoothstep(0.35, 1.05, length(away));

      // 그레인. 매 프레임 새로 뿌린다 — 멈춰 있으면 먼지가 되고 움직여야 입자가 된다
      color += (hash(vUv * resolution + fract(time) * 97.0) - 0.5) * grain;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), source.a);
    }
  `
};
