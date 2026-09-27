// 룩. 움직임은 그대로 두고 보이는 것만 바꾼다 — 같은 필름에 다른 현상을 거는 것과 같다.
// 지금은 네 벌 모두 흑백이다. 색은 전부 무채색이고, 룩마다 다른 것은 명암과 번짐과 입자다.
//
// 한 벌은 네 층으로 이뤄진다.
//   무대   — 바탕과 판과 선과 글자의 색. 밝은 룩은 여기부터 달라야 한다
//   빛     — 톤 매핑과 노출, 반사광의 세기, 블룸. 밝은 것이 얼마나 번지는가
//   공     — 공의 겉. 반사가 도는 사탕인가, 빛을 먹는 종이인가. color가 없으면 먹색(ink)을 입는다
//   보정   — 톤 매핑이 끝난 화면 위에서 하는 색보정. 리프트와 게인, 대비, 채도, 비네트, 그레인
//
// 보정을 톤 매핑 뒤에 두는 것은 색보정가가 일하는 순서가 그렇기 때문이다. 선형 공간에서
// 대비를 올리면 밝은 쪽이 톤 매핑에 먹혀 의도한 만큼 서지 않는다.

import * as THREE from "three";

export const LOOKS = {
  clean: {
    name: "CLEAN",
    note: "보정 없음. 곡선을 판단할 때",
    stage: { background: "#121212", panel: "#1d1d1d", grid: "#303030", reference: "#4f4f4f", track: "#3e3e3e", ink: "#ffffff", muted: "#8f8f8f", shadow: 0.32 },
    light: { toneMapping: THREE.NeutralToneMapping, exposure: 1, env: 0.9, bloom: [0, 0, 1], tint: [1, 1, 1] },
    ball: { color: null, roughness: 0.34, clearcoat: 1, specular: 1 },
    grade: { lift: [0, 0, 0], gain: [1, 1, 1], contrast: 1, saturation: 1, vignette: 0, grain: 0 },
    theme: "dark"
  },
  glow: {
    name: "GLOW",
    note: "어둠 속에서 선과 공이 번진다. 모션 그래픽의 흔한 얼굴",
    stage: { background: "#070707", panel: "#101010", grid: "#232323", reference: "#3f3f3f", track: "#2e2e2e", ink: "#ffffff", muted: "#848484", shadow: 0.4 },
    light: { toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.85, env: 0.7, bloom: [0.75, 0.15, 0.1], tint: [1, 1, 1] },
    ball: { color: null, roughness: 0.34, clearcoat: 1, specular: 1 },
    grade: { lift: [0.004, 0.004, 0.004], gain: [1, 1, 1], contrast: 1.08, saturation: 1.18, vignette: 0.38, grain: 0.018 },
    theme: "dark"
  },
  film: {
    name: "FILM",
    note: "들뜬 검정, 넓은 번짐, 굵은 입자. 흑백 필름 스캔 같은 결",
    stage: { background: "#121212", panel: "#1b1b1b", grid: "#2b2b2b", reference: "#525252", track: "#373737", ink: "#e9e9e9", muted: "#949494", shadow: 0.36 },
    light: { toneMapping: THREE.AgXToneMapping, exposure: 1.05, env: 0.85, bloom: [0.5, 0.4, 0.5], tint: [0.629, 0.629, 0.629] },
    ball: { color: null, roughness: 0.34, clearcoat: 1, specular: 1 },
    grade: { lift: [0.025, 0.025, 0.025], gain: [1.003, 1.003, 1.003], contrast: 0.94, saturation: 0.9, vignette: 0.52, grain: 0.075 },
    theme: "dark"
  },
  paper: {
    name: "PAPER",
    note: "밝은 종이 위. 인쇄물이나 슬라이드에 올릴 때",
    stage: { background: "#e6e6e6", panel: "#dadada", grid: "#c3c3c3", reference: "#9b9b9b", track: "#b4b4b4", ink: "#282828", muted: "#727272", shadow: 0.16 },
    light: { toneMapping: THREE.NeutralToneMapping, exposure: 1, env: 1, bloom: [0, 0, 1], tint: [1, 1, 1] },
    ball: { color: "#282828", roughness: 1, clearcoat: 0, specular: 0 },
    grade: { lift: [0.008, 0.008, 0.008], gain: [0.99, 0.99, 0.99], contrast: 1.03, saturation: 0.9, vignette: 0.14, grain: 0.035 },
    theme: "light"
  }
};

// 블룸은 [세기, 반경, 문턱]. 반경을 키우면 가장 흐린 층이 두꺼워져 화면 전체가 뿌옇게 뜬다 —
// 선이 열두 줄이나 있는 화면에서는 번짐을 좁게 쥐어야 선이 선으로 남는다.
// tint는 번짐에 곱하는 색이다. 흑백이라 세 채널이 같고 세기만 다르다 — FILM의 헐레이션(빛이
// 필름 뒷면에 튕겨 두르는 테)은 넓게 퍼지되 GLOW보다 옅게 둔다.
// 흑백 값은 원래 색의 밝기(상대 휘도)를 그대로 옮긴 회색이다. 명암의 짜임은 색이 있을 때와 같다.
//
// 공의 specular는 반사의 세기다. 0이면 거울 같은 반사가 다 빠지고 빛을 고르게 먹는 면만 남는다 —
// 광택이 조금이라도 돌면 종이가 아니라 플라스틱으로 읽힌다. PAPER의 공은 검은 종이다.

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
    seed: { value: 0 }, // 0~1. 바뀔 때마다 입자를 새로 뿌린다
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
    uniform float seed;
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

      // 그레인. 초당 24번 새로 뿌린다 — 멈춰 있으면 먼지가 되고 움직여야 입자가 된다
      color += (hash(vUv * resolution + seed * 97.0) - 0.5) * grain;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), source.a);
    }
  `
};
