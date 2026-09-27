// three.js 무대. 보이는 것은 전부 여기서 정한다 — 움직임은 GSAP이 정하고 여기서는 읽기만 한다.
//
// 좌표는 CSS 픽셀 그대로 쓴다. 직교 카메라가 화면과 같은 크기의 판을 보게 해 두면 월드 좌표가
// 곧 화면 좌표가 되어, 위에 겹치는 HTML 글자와 어긋날 일이 없다. y만 뒤집힌다.
//
// 그리는 순서: 장면 → 블룸 → 톤 매핑 → 색보정. 색보정을 톤 매핑 뒤에 두는 이유는 looks.js 에.

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { sampleMotion, codeOf } from "./motions.js";
import { readCurve, speedFrom } from "./curves.js";
import { GradeShader } from "./looks.js";

const TOP = 14;
const RADIUS = 12;
const SAMPLES = 240;
const TICKS = 12; // 간격표: 같은 시간 간격으로 찍은 공의 자리
const GHOSTS = 3;
const GHOST_GAP = 0.03;

const Y = (y) => -y; // 화면 y → 월드 y

// 줄마다의 색. HSL로 색상만 돌리면 노랑은 밝고 파랑은 어둡게 보여, 밝은 종이 위에서는 노랑 줄
// 이름이 사라지고 어두운 바탕에서는 파랑 줄이 가라앉는다. OKLCH는 사람 눈에 같은 밝기로 보이게
// 짠 색 공간이라 색상만 돌려도 밝기가 고르다. OKLab → 선형 sRGB 행렬은 Björn Ottosson의 것.
function oklch(L, C, hue) {
  const h = (hue * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v) => Math.min(1, Math.max(0, v));
  return new THREE.Color().setRGB(
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    THREE.LinearSRGBColorSpace
  );
}

const rowColor = (index, count, theme) =>
  theme === "light" ? oklch(0.6, 0.14, 20 + (index / (count - 1)) * 300) : oklch(0.8, 0.12, 20 + (index / (count - 1)) * 300);

export function createStage(host, motions, proxies) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);

  const labels = document.createElement("div");
  labels.className = "labels";
  host.append(labels);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -500, 500);

  // 반사. 공이 비칠 방이 있어야 광택이 광택으로 읽힌다 — 빛만 있으면 플라스틱이 된다
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-240, 320, 520);
  scene.add(sun);

  // 후처리. 다중 샘플 타깃을 직접 넘겨야 안티에일리어싱이 산다 — 컴포저의 기본 타깃에는 없다
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0, 1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const ballGeometry = new THREE.SphereGeometry(RADIUS, 48, 32);
  const dotGeometry = new THREE.CircleGeometry(2.6, 16);
  const shadowGeometry = new THREE.CircleGeometry(RADIUS, 32);
  const shared = [ballGeometry, dotGeometry, shadowGeometry];

  // 그래프 표본은 룩이나 크기와 상관없다. 한 번만 잰다
  const samples = motions.map((motion) => sampleMotion(motion, SAMPLES));
  const speeds = samples.map((values) => values.map((_, i) => speedFrom(values, i / SAMPLES)));

  let rows = [];
  let lineMaterials = [];
  let geometry = null;
  let mode = "speed";
  let options = { squash: true, ticks: true, ghosts: true };
  let look = null;

  function line(points, color, width, opacity = 1) {
    const geo = new LineGeometry();
    geo.setPositions(points.flatMap(([x, y]) => [x, Y(y), 0]));
    const mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity });
    lineMaterials.push(mat);
    return new Line2(geo, mat);
  }

  function rect(x, y, w, h, color) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x + w / 2, Y(y + h / 2), -10);
    return mesh;
  }

  function dispose() {
    for (const row of rows) {
      scene.remove(row.group);
      row.group.traverse((object) => {
        if (object.geometry && !shared.includes(object.geometry)) object.geometry.dispose();
        if (object.material) object.material.dispose();
      });
    }
    rows = [];
    lineMaterials = [];
    labels.replaceChildren();
  }

  function buildRow(motion, index, g) {
    const ink = look.stage;
    const top = TOP + index * g.row;
    const color = rowColor(index, motions.length, look.theme);
    const group = new THREE.Group();

    // -- 그래프 --------------------------------------------------------------------------
    const gTop = top + 8;
    const gBottom = top + g.row - 10;
    const gHeight = gBottom - gTop;
    group.add(rect(g.gx0, gTop, g.G, gHeight, ink.panel));

    const values = samples[index];
    const series = mode === "speed" ? speeds[index] : values;
    let lo = Math.min(0, ...series);
    let hi = mode === "speed" ? Math.max(1.2, ...series) : Math.max(1, ...series);
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const mapY = (v) => gBottom - ((v - lo) / (hi - lo)) * gHeight;
    const mapX = (t) => g.gx0 + t * g.G;

    // 기준선. 속도 그래프에는 0과 선형의 빠르기(1)를, 값 그래프에는 출발(0)과 도착(1)을
    group.add(line([[g.gx0, mapY(0)], [g.gx1, mapY(0)]], ink.grid, 1));
    if (mode === "speed") {
      group.add(line([[g.gx0, mapY(1)], [g.gx1, mapY(1)]], ink.reference, 1, 0.8));
    } else {
      group.add(line([[g.gx0, mapY(1)], [g.gx1, mapY(1)]], ink.grid, 1));
      group.add(line([[g.gx0, mapY(0)], [g.gx1, mapY(1)]], ink.reference, 1, 0.6));
    }

    group.add(line(series.map((v, i) => [mapX(i / SAMPLES), mapY(v)]), color, 2.4));

    const playhead = line([[0, gTop], [0, gBottom]], ink.ink, 1, 0.35);
    group.add(playhead);
    const playDot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: ink.ink }));
    playDot.position.z = 5;
    group.add(playDot);

    // -- 트랙 ----------------------------------------------------------------------------
    // 줄이 좁아지면 공 머리가 이름 글자에 닿는다. 트랙을 아래로 내려 둘 사이를 벌린다
    const trackY = top + g.row * 0.76;
    group.add(line([[g.left, trackY], [g.right, trackY]], ink.track, 1.5));
    for (const x of [g.tx0, g.tx1]) group.add(line([[x, trackY - 8], [x, trackY + 8]], ink.reference, 1.5));

    // 간격표. 같은 시간마다 공이 있던 자리 — 속도 그래프가 트랙 위에 떨어진 모양이다.
    // 촘촘하면 느리고 성기면 빠르다. 애니메이터가 종이에 그리던 spacing chart 그대로다.
    const ticks = new THREE.Group();
    const tickMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
    for (let k = 0; k <= TICKS; k += 1) {
      const dot = new THREE.Mesh(dotGeometry, tickMaterial);
      dot.position.set(g.tx0 + readCurve(values, k / TICKS) * g.span, Y(trackY), 1);
      ticks.add(dot);
    }
    group.add(ticks);

    const shadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: ink.shadow }));
    shadow.position.z = 2;
    group.add(shadow);

    // 잔상은 빛을 받지 않는 납작한 원이다. 음영을 주면 반투명한 공이 되어 탁한 구슬처럼 보인다.
    // 어두운 바탕에서는 빛처럼 더해지게 둔다 — 반투명하게 덮으면 검정에 물감을 섞은 듯 탁해진다
    const ghosts = [];
    const blending = look.theme === "light" ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (let k = 1; k <= GHOSTS; k += 1) {
      const ghost = new THREE.Mesh(
        ballGeometry,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 - k * 0.05, depthWrite: false, blending })
      );
      ghost.position.z = 8 - k;
      group.add(ghost);
      ghosts.push(ghost);
    }

    // 클리어코트를 입힌 공. 반사가 한 겹 위에 따로 얹혀 사탕처럼 읽힌다
    const ball = new THREE.Mesh(
      ballGeometry,
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.34, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12 })
    );
    ball.position.z = 10;
    group.add(ball);

    scene.add(group);

    // -- 글자 ----------------------------------------------------------------------------
    const label = document.createElement("div");
    label.className = "label";
    label.style.left = `${g.tx0}px`;
    label.style.top = `${top + 2}px`;
    label.innerHTML = `<b style="color:#${color.getHexString()}">${motion.name}</b><code>${codeOf(motion)}</code><span>${motion.words}</span>`;
    labels.append(label);

    const peak = document.createElement("div");
    peak.className = "peak";
    peak.style.left = `${g.gx1 - 4}px`;
    peak.style.top = `${gTop + 3}px`;
    const top1 = mode === "speed" ? Math.max(...speeds[index].map(Math.abs)) : Math.max(...values);
    peak.textContent = mode === "speed" ? `peak ${top1.toFixed(1)}×` : top1 > 1.001 ? `max ${top1.toFixed(2)}` : "";
    if (peak.textContent) labels.append(peak);

    return { index, group, ball, ghosts, shadow, ticks, playhead, playDot, mapX, mapY, trackY, values };
  }

  function layout() {
    if (!look) return;
    dispose();
    const W = host.clientWidth;
    const room = window.innerHeight - host.getBoundingClientRect().top - 12;
    const row = Math.round(Math.max(62, Math.min(94, (room - TOP * 2) / motions.length)));
    const H = TOP * 2 + motions.length * row;

    host.style.height = `${H}px`;
    renderer.setSize(W, H);
    composer.setSize(W, H);
    grade.uniforms.resolution.value.set(W * dpr, H * dpr);
    camera.right = W;
    camera.bottom = -H;
    camera.updateProjectionMatrix();

    const pad = 22;
    const G = Math.round(Math.max(170, Math.min(300, W * 0.24)));

    // 트랙은 0(출발)과 1(도착)이 아니라 모든 움직임이 닿는 범위를 담는다. 스프링은 목표를
    // 37%나 지나치고 예비 동작은 11% 뒤로 물러난다 — 1을 화면 끝에 붙여 두면 그 넘침이 화면
    // 밖으로 나가, 이 무대가 보여주려는 바로 그 부분이 잘린다.
    let reachLo = 0;
    let reachHi = 1;
    for (const values of samples) for (const f of values) {
      reachLo = Math.min(reachLo, f);
      reachHi = Math.max(reachHi, f);
    }
    const left = pad + G + 40 + RADIUS;
    const right = W - pad - RADIUS * 1.6;
    const unit = (right - left) / (reachHi - reachLo);
    const tx0 = left - reachLo * unit;
    geometry = { W, H, row, gx0: pad, gx1: pad + G, G, tx0, tx1: tx0 + unit, span: unit, left, right };

    rows = motions.map((motion, index) => buildRow(motion, index, geometry));
    for (const material of lineMaterials) material.resolution.set(W, H);
    applyOptions();
  }

  function applyOptions() {
    for (const row of rows) {
      row.ticks.visible = options.ticks;
      for (const ghost of row.ghosts) ghost.visible = options.ghosts;
    }
  }

  function applyLook(next) {
    look = next;
    scene.background = new THREE.Color(look.stage.background);
    renderer.toneMapping = look.light.toneMapping;
    renderer.toneMappingExposure = look.light.exposure;
    scene.environmentIntensity = look.light.env;
    const [strength, radius, threshold] = look.light.bloom;
    bloom.enabled = strength > 0;
    bloom.strength = strength;
    bloom.radius = radius;
    bloom.threshold = threshold;
    for (const tint of bloom.bloomTintColors) tint.fromArray(look.light.tint);
    const u = grade.uniforms;
    u.lift.value.fromArray(look.grade.lift);
    u.gain.value.fromArray(look.grade.gain);
    u.contrast.value = look.grade.contrast;
    u.saturation.value = look.grade.saturation;
    u.vignette.value = look.grade.vignette;
    u.grain.value = look.grade.grain;
    // 글자는 HTML이라 셰이더를 거치지 않는다. 색만이라도 룩을 따라가게 넘겨 준다
    host.style.setProperty("--stage-ink", look.stage.ink);
    host.style.setProperty("--stage-muted", look.stage.muted);
    host.style.setProperty("--stage-panel", look.stage.panel);
    host.style.setProperty("--stage-line", look.stage.reference);
    document.body.dataset.theme = look.theme;
    layout(); // 판과 선의 색이 룩을 따르므로 다시 짓는다
  }

  // 빠를수록 가로로 늘어난다. 서 있을 때(출발 전, 도착 뒤)는 동그랗다 — 도착 순간의 속도를
  // 그대로 쓰면 이즈 인처럼 전속력으로 닿는 곡선이 서 있는 내내 늘어난 채로 남는다.
  function stretch(values, t) {
    if (!options.squash || t <= 0 || t >= 1) return [1, 1];
    const s = Math.min(0.5, Math.abs(speedFrom(values, t)) * 0.11);
    return [1 + s, 1 / Math.sqrt(1 + s)];
  }

  // 한 순간을 그린다. t는 0~1, 공의 자리는 GSAP이 움직여 둔 proxies 에서 읽는다
  function update(t) {
    if (!geometry) return;
    for (const row of rows) {
      const p = proxies[row.index].p;
      const [sx, sy] = stretch(row.values, t);
      const x = geometry.tx0 + p * geometry.span;
      row.ball.scale.set(sx, sy, sy);
      row.ball.position.set(x, Y(row.trackY) + RADIUS * sy, 10);
      row.shadow.position.set(x, Y(row.trackY) + 1, 2);
      row.shadow.scale.set(sx * 1.05, 0.22, 1);

      row.ghosts.forEach((ghost, k) => {
        const tk = t - (k + 1) * GHOST_GAP;
        ghost.visible = options.ghosts && tk >= 0 && t < 1;
        if (!ghost.visible) return;
        const [gx, gy] = stretch(row.values, tk);
        ghost.scale.set(gx, gy, gy);
        ghost.position.x = geometry.tx0 + readCurve(row.values, tk) * geometry.span;
        ghost.position.y = Y(row.trackY) + RADIUS * gy;
      });

      const px = row.mapX(t);
      row.playhead.position.x = px;
      row.playDot.position.set(px, Y(row.mapY(mode === "speed" ? speedFrom(row.values, t) : p)), 6);
    }
    grade.uniforms.time.value = performance.now() / 1000;
    composer.render();
  }

  return {
    layout,
    update,
    setLook: applyLook,
    setMode(next) {
      mode = next;
      layout();
    },
    setOptions(next) {
      options = { ...options, ...next };
      applyOptions();
    },
    timeAt(x) {
      if (!geometry) return null;
      return Math.min(1, Math.max(0, (x - geometry.gx0) / geometry.G));
    },
    get geometry() {
      return geometry;
    }
  };
}
