// three.js 무대. 보이는 것은 전부 여기서 정한다 — 움직임은 GSAP이 정하고 여기서는 읽기만 한다.
//
// 한 줄은 모션 릴의 한 장면처럼 생겼다. 번호와 이름, 작은 그래프, 그리고 A에서 B로 그은 선 위를
// 지나가는 평평한 공. 모든 공은 같은 거리를 같은 시간에 간다 — 줄마다 다른 것은 그 사이를 어떻게
// 지나가느냐뿐이다.
//
// 좌표는 무대의 CSS 픽셀 그대로 쓴다. 직교 카메라가 픽셀과 같은 크기로 무대를 보게 해 두면 월드
// 좌표가 곧 무대 좌표가 되어, 위에 겹치는 HTML 글자와 어긋날 일이 없다. y만 뒤집힌다.
//
// 캔버스는 무대 전체가 아니라 화면 높이만 하다. 무대를 따라 내려가다 화면 위쪽에 달라붙고(sticky),
// 카메라와 글자를 스크롤만큼 옮겨 지금 보이는 띠만 그린다. 무대가 길어져도 그리는 픽셀은 늘지 않는다.
// 그리고 그림이 바뀔 때만 그린다 — 공이 서 있는 동안에는 입자가 바뀌는 초당 24번뿐이다.
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
import { sampleMotion, codeOf } from "./motions.js";
import { clamp01, readCurve, speedFrom } from "./curves.js";
import { GradeShader } from "./looks.js";

const TOP = 34; // 첫 줄 위. A와 B 글자가 들어간다
const ROW = 52; // 줄 간격. 공 지름의 두 배쯤 — 레퍼런스의 비율이다
const RADIUS = 12; // 공
const THUMB = 40; // 그래프 칸 한 변. 정사각형이다
const INSET = 36; // 무대 왼쪽 끝에서 번호까지. 바깥 틀의 글자 줄과 맞춘다
const NAME = 220; // 번호와 이름, GSAP 표기가 들어가는 칸
const SAMPLES = 240;
const TICKS = 12; // 간격표: 같은 시간 간격으로 찍은 공의 자리
const GHOSTS = 3;
const GHOST_GAP = 0.03;
const GRAIN_FPS = 24; // 입자는 필름처럼 초당 24번 바뀐다. 공이 서 있을 때 다시 그리는 빈도도 이것이다

const Y = (y) => -y; // 화면 y → 월드 y

// 평평한 공과 그 모션 블러. 셔터가 열린 동안 공의 중심이 a에서 b까지 지나간다고 보고, 한 점이
// 공에 덮여 있던 시간의 비율을 그 점의 농도로 칠한다 — 원을 가로 방향 상자 필터에 건 것과 같다.
// 멈춰 있으면 a와 b가 같아 그냥 원이다. 가장자리는 반 픽셀씩 넓혀 재고, 위아래는 두 번 재어
// 계단을 지운다. 판은 공이 지나간 폭만큼만 편다.
const DiscShader = {
  uniforms: {
    color: { value: new THREE.Color() },
    size: { value: new THREE.Vector2(1, 1) }, // 판의 크기(px). mesh.scale과 같게 둔다
    span: { value: new THREE.Vector2(0, 0) }, // 판 가운데에서 잰 a와 b(px)
    squash: { value: new THREE.Vector2(1, 1) }
  },
  vertexShader: /* glsl */ `
    uniform vec2 size;
    varying vec2 vLocal;
    void main() {
      vLocal = position.xy * size;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform vec2 span;
    uniform vec2 squash;
    varying vec2 vLocal;

    const float R = ${RADIUS.toFixed(1)};

    // 높이 y에서 공의 반폭 w. 중심이 [lo, hi]를 지나는 동안 x가 [c - w, c + w] 안에 드는 비율
    float cover(float x, float y, float lo, float hi) {
      float w = sqrt(max(R * R - y * y, 0.0));
      return clamp(min(x + w, hi) - max(x - w, lo), 0.0, hi - lo) / (hi - lo);
    }

    void main() {
      vec2 p = vLocal / squash; // 늘어남을 되돌리면 공은 동그랗다
      float lo = min(span.x, span.y) / squash.x - 0.5;
      float hi = max(span.x, span.y) / squash.x + 0.5;
      float a = 0.5 * (cover(p.x, p.y - 0.25, lo, hi) + cover(p.x, p.y + 0.25, lo, hi));
      if (a <= 0.0) discard;
      gl_FragColor = vec4(color, a);
    }
  `
};

export function createStage(host, motions, proxies) {
  // 전력은 기본값에 맡긴다. high-performance를 달면 그래픽 카드가 둘인 맥에서 외장 GPU를 깨운다
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // 화면에 보이는 띠. 캔버스와 글자를 같이 담아, 스크롤할 때 둘을 같은 틱에 함께 옮긴다 — 글자만
  // 브라우저가 따로 굴리면 한 프레임씩 어긋나 그림 위에서 미끄러진다
  const view = document.createElement("div");
  view.className = "view";
  view.append(renderer.domElement);
  host.append(view);

  const labels = document.createElement("div");
  labels.className = "labels";
  view.append(labels);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -500, 500);

  // 후처리. 다중 샘플 타깃을 직접 넘겨야 안티에일리어싱이 산다 — 컴포저의 기본 타깃에는 없다
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0, 1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const quadGeometry = new THREE.PlaneGeometry(1, 1);
  const circleGeometry = new THREE.CircleGeometry(RADIUS, 48);
  const ringGeometry = new THREE.RingGeometry(RADIUS - 0.75, RADIUS + 0.75, 64);
  const dotGeometry = new THREE.CircleGeometry(2.6, 16);
  const shared = [quadGeometry, circleGeometry, ringGeometry, dotGeometry];

  // 그래프 표본은 룩이나 크기와 상관없다. 한 번만 잰다
  const samples = motions.map((motion) => sampleMotion(motion, SAMPLES));
  const speeds = samples.map((values) => values.map((_, i) => speedFrom(values, i / SAMPLES)));

  // 트랙은 0(출발)과 1(도착)이 아니라 모든 움직임이 닿는 범위를 담는다. 스프링은 목표를
  // 37%나 지나치고 예비 동작은 11% 뒤로 물러난다 — B를 화면 끝에 붙여 두면 그 넘침이 화면
  // 밖으로 나가, 이 무대가 보여주려는 바로 그 부분이 잘린다.
  let reachLo = 0;
  let reachHi = 1;
  for (const values of samples) for (const f of values) {
    reachLo = Math.min(reachLo, f);
    reachHi = Math.max(reachHi, f);
  }

  let rows = [];
  let lineMaterials = [];
  let geometry = null;
  let mode = "value";
  let options = { squash: false, ticks: false, ghosts: false };
  let look = null;
  let duration = 1; // 초. 셔터가 한 번의 움직임에서 얼마를 차지하는지 재려고 안다
  let viewH = 0;
  let offset = NaN; // 무대 맨 위에서 보이는 띠까지의 거리. 스크롤을 따라 바뀐다
  let dirty = true; // t가 그대로여도 다시 그려야 하는가 — 짓기, 룩, 보조선, 길이, 스크롤
  let shownT = NaN;
  let shownGrain = NaN;

  addEventListener("scroll", () => (dirty = true), { passive: true });

  function line(points, color, width, { opacity = 1, dash = 0 } = {}) {
    const geo = new LineGeometry();
    geo.setPositions(points.flatMap(([x, y]) => [x, Y(y), 0]));
    const mat = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity });
    if (dash) Object.assign(mat, { dashed: true, dashSize: dash, gapSize: dash });
    lineMaterials.push(mat);
    const result = new Line2(geo, mat);
    if (dash) result.computeLineDistances();
    return result;
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
    const cy = TOP + index * ROW + ROW / 2; // 줄 가운데. 그래프도 트랙도 공도 이 높이에 선다
    const color = new THREE.Color(look.ball.colors[index % look.ball.colors.length]); // 검정, 파랑, 주황을 돌려 입는다
    const group = new THREE.Group();

    // -- 그래프 --------------------------------------------------------------------------
    // 작은 정사각형. 왼쪽 축과 바닥선, 점선 하나. 값 그래프는 모든 줄이 같은 눈금이라 0은 바닥,
    // 1(도착)은 점선이고 넘침은 그 위로 올라간다. 속도 그래프는 줄마다 최고 속도가 1배에서 35배까지
    // 달라 줄마다 눈금을 맞추고, 점선은 선형의 빠르기(1)다
    const gTop = cy - THUMB / 2;
    const gBottom = cy + THUMB / 2;
    const values = samples[index];
    const series = mode === "speed" ? speeds[index] : values;
    let lo = 0;
    let hi = reachHi;
    if (mode === "speed") {
      lo = Math.min(0, ...series);
      hi = Math.max(1.2, ...series);
      const pad = (hi - lo) * 0.06;
      lo -= pad;
      hi += pad;
    }
    const mapY = (v) => gBottom - ((v - lo) / (hi - lo)) * THUMB;
    const mapX = (t) => g.gx0 + t * THUMB;

    group.add(line([[g.gx0, gTop], [g.gx0, gBottom]], ink.grid, 1));
    group.add(line([[g.gx0, mapY(0)], [g.gx1, mapY(0)]], ink.grid, 1));
    group.add(line([[g.gx0, mapY(1)], [g.gx1, mapY(1)]], ink.reference, 1, { dash: 1.5 }));
    group.add(line(series.map((v, i) => [mapX(i / SAMPLES), mapY(v)]), ink.ink, 1.6));

    const playDot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color }));
    playDot.position.z = 5;
    group.add(playDot);

    // -- 트랙 ----------------------------------------------------------------------------
    // A에서 B까지만 긋는다. 넘치는 공은 선 끝을 지나 빈 종이 위로 나갔다가 돌아온다
    group.add(line([[g.tx0, cy], [g.tx1, cy]], ink.track, 1));
    for (const x of [g.tx0, g.tx1]) group.add(line([[x, cy - 7], [x, cy + 7]], ink.reference, 1.2));

    // 출발점의 링. 공이 떠나면 드러나 어디서 왔는지 남긴다
    const ring = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 }));
    ring.position.set(g.tx0, Y(cy), 2);
    group.add(ring);

    // 간격표. 같은 시간마다 공이 있던 자리 — 속도 그래프가 트랙 위에 떨어진 모양이다.
    // 촘촘하면 느리고 성기면 빠르다. 애니메이터가 종이에 그리던 spacing chart 그대로다.
    const ticks = new THREE.Group();
    const tickMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 });
    for (let k = 0; k <= TICKS; k += 1) {
      const dot = new THREE.Mesh(dotGeometry, tickMaterial);
      dot.position.set(g.tx0 + readCurve(values, k / TICKS) * g.span, Y(cy), 3);
      ticks.add(dot);
    }
    group.add(ticks);

    // 잔상. 어두운 바탕에서는 빛처럼 더해지게 둔다 — 반투명하게 덮으면 검정에 물감을 섞은 듯 탁해진다
    const ghosts = [];
    const blending = look.theme === "light" ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (let k = 1; k <= GHOSTS; k += 1) {
      const ghost = new THREE.Mesh(
        circleGeometry,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 - k * 0.05, depthWrite: false, blending })
      );
      ghost.position.z = 8 - k;
      group.add(ghost);
      ghosts.push(ghost);
    }

    const ball = new THREE.Mesh(
      quadGeometry,
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(DiscShader.uniforms),
        vertexShader: DiscShader.vertexShader,
        fragmentShader: DiscShader.fragmentShader,
        transparent: true,
        depthWrite: false
      })
    );
    ball.material.uniforms.color.value.copy(color);
    ball.position.z = 10;
    group.add(ball);

    scene.add(group);

    // -- 글자 ----------------------------------------------------------------------------
    // 번호, 이름, 그 아래 GSAP 표기. 말로 적은 설명은 이름 위에 올리면 뜬다
    const label = document.createElement("div");
    label.className = "label";
    label.style.left = `${INSET}px`;
    label.style.top = `${cy - 17}px`;
    label.title = motion.words;
    label.innerHTML = `<i>${String(index + 1).padStart(2, "0")}</i><b>${motion.name.toLowerCase().replaceAll(" ", "-")}</b><code>${codeOf(motion)}</code>`;
    labels.append(label);

    return { index, group, ball, ghosts, ticks, playDot, mapX, mapY, cy, values };
  }

  function layout() {
    if (!look) return;
    dispose();
    const W = host.clientWidth;
    const H = TOP + motions.length * ROW + 16;
    viewH = Math.min(H, window.innerHeight);

    host.style.height = `${H}px`;
    view.style.height = `${viewH}px`;
    renderer.setSize(W, viewH);
    composer.setSize(W, viewH);
    grade.uniforms.resolution.value.set(W * dpr, viewH * dpr);
    camera.right = W;
    offset = NaN; // 띠의 크기가 바뀌었으니 다음에 그릴 때 카메라를 새로 맞춘다

    // 가로: 번호·이름 | 그래프 | 넘침 여유 · A ──────── B · 넘침 여유
    const gx0 = INSET + NAME;
    const left = gx0 + THUMB + 40 + RADIUS;
    const right = W - INSET - RADIUS;
    const unit = Math.max(40, (right - left) / (reachHi - reachLo));
    const tx0 = left - reachLo * unit;
    geometry = { W, H, gx0, gx1: gx0 + THUMB, tx0, tx1: tx0 + unit, span: unit };

    rows = motions.map((motion, index) => buildRow(motion, index, geometry));
    for (const [text, x] of [["A", geometry.tx0], ["B", geometry.tx1]]) {
      const end = document.createElement("div");
      end.className = "end";
      end.textContent = text;
      end.style.left = `${x}px`;
      end.style.top = `${TOP - 24}px`;
      labels.append(end);
    }
    for (const material of lineMaterials) material.resolution.set(W, viewH);
    applyOptions();
  }

  function applyOptions() {
    for (const row of rows) {
      row.ticks.visible = options.ticks;
      for (const ghost of row.ghosts) ghost.visible = options.ghosts;
    }
    dirty = true;
  }

  // 띠가 무대 안 어디쯤 붙어 있는지 재서, 카메라와 글자를 그만큼 내려 보낸다. 무대 밖으로 나간
  // 줄은 카메라에 걸리지 않아 three.js가 알아서 건너뛴다
  function place() {
    const next = view.getBoundingClientRect().top - host.getBoundingClientRect().top - host.clientTop;
    if (next === offset) return;
    offset = next;
    camera.top = Y(offset);
    camera.bottom = Y(offset + viewH);
    camera.updateProjectionMatrix();
    labels.style.transform = `translateY(${-offset}px)`;
  }

  function applyLook(next) {
    look = next;
    scene.background = new THREE.Color(look.stage.background);
    renderer.toneMapping = look.light.toneMapping;
    renderer.toneMappingExposure = look.light.exposure;
    const [strength, radius, threshold] = look.light.bloom;
    bloom.enabled = strength > 0;
    bloom.strength = strength;
    bloom.radius = radius;
    bloom.threshold = threshold;
    for (const tint of bloom.bloomTintColors) tint.fromArray(look.light.tint);
    const g = look.grade;
    const u = grade.uniforms;
    u.lift.value.fromArray(g.lift);
    u.gain.value.fromArray(g.gain);
    u.contrast.value = g.contrast;
    u.saturation.value = g.saturation;
    u.vignette.value = g.vignette;
    u.grain.value = g.grain;
    // 아무것도 하지 않는 보정(PAPER)은 화면 한 장을 통째로 건너뛴다
    grade.enabled =
      g.lift.some((v) => v !== 0) || g.gain.some((v) => v !== 1) || g.contrast !== 1 || g.saturation !== 1 || g.vignette > 0 || g.grain > 0;
    // 글자는 HTML이라 셰이더를 거치지 않는다. 페이지 전체가 같은 종이와 먹을 입게 넘겨 준다 —
    // 캔버스 밖과 안이 한 장으로 이어진다
    const css = document.body.style;
    css.setProperty("--bg", look.stage.background);
    css.setProperty("--ink", look.stage.ink);
    css.setProperty("--dim", look.stage.muted);
    css.setProperty("--line", look.stage.grid);
    css.setProperty("--accent", look.stage.accent);
    document.body.dataset.theme = look.theme;
    layout(); // 선과 공의 색이 룩을 따르므로 다시 짓는다
  }

  // 빠를수록 가로로 늘어난다. 서 있을 때(출발 전, 도착 뒤)는 동그랗다 — 도착 순간의 속도를
  // 그대로 쓰면 이즈 인처럼 전속력으로 닿는 곡선이 서 있는 내내 늘어난 채로 남는다.
  function stretch(values, t) {
    if (!options.squash || t <= 0 || t >= 1) return [1, 1];
    const s = Math.min(0.5, Math.abs(speedFrom(values, t)) * 0.11);
    return [1 + s, 1 / Math.sqrt(1 + s)];
  }

  // 셔터가 열린 동안(t를 가운데 두고) 공이 지나간 가장 왼쪽과 오른쪽. 튕기거나 떠는 움직임은
  // 셔터 안에서 방향이 바뀌므로 양 끝만 보지 않고 다섯 번 짚는다. 서 있을 때는 번지지 않는다
  function smear(values, t, x) {
    const open = look.ball.shutter / duration;
    if (open <= 0 || t <= 0 || t >= 1) return [x, x];
    const here = readCurve(values, t);
    let a = x;
    let b = x;
    for (let k = 0; k <= 4; k += 1) {
      const xk = x + (readCurve(values, clamp01(t + (k / 4 - 0.5) * open)) - here) * geometry.span;
      a = Math.min(a, xk);
      b = Math.max(b, xk);
    }
    return [a, b];
  }

  // 한 순간을 그린다. t는 0~1, 공의 자리는 GSAP이 움직여 둔 proxies 에서 읽는다.
  // 모든 공은 t 하나로 자리가 정해진다. t도 입자도 그대로고 달리 바뀐 것도 없으면 그리지 않는다 —
  // 출발 전과 도착 뒤의 쉼, 멈춤 동안이 그렇다
  function update(t) {
    if (!geometry) return;
    const grain = look.grade.grain > 0 ? Math.floor((performance.now() / 1000) * GRAIN_FPS) : 0;
    if (!dirty && t === shownT && grain === shownGrain) return;
    dirty = false;
    shownT = t;
    shownGrain = grain;
    place();

    for (const row of rows) {
      const p = proxies[row.index].p;
      const x = geometry.tx0 + p * geometry.span;
      const [sx, sy] = stretch(row.values, t);
      const [a, b] = smear(row.values, t, x);
      const c = (a + b) / 2;
      const w = b - a + 2 * RADIUS * sx + 4;
      const h = 2 * RADIUS * sy + 4;
      const u = row.ball.material.uniforms;
      u.size.value.set(w, h);
      u.span.value.set(a - c, b - c);
      u.squash.value.set(sx, sy);
      row.ball.scale.set(w, h, 1);
      row.ball.position.set(c, Y(row.cy), 10);

      row.ghosts.forEach((ghost, k) => {
        const tk = t - (k + 1) * GHOST_GAP;
        ghost.visible = options.ghosts && tk >= 0 && t < 1;
        if (!ghost.visible) return;
        const [gx, gy] = stretch(row.values, tk);
        ghost.scale.set(gx, gy, 1);
        ghost.position.set(geometry.tx0 + readCurve(row.values, tk) * geometry.span, Y(row.cy), 8 - k);
      });

      row.playDot.position.set(row.mapX(t), Y(row.mapY(mode === "speed" ? speedFrom(row.values, t) : p)), 6);
    }
    grade.uniforms.seed.value = (grain * 0.618034) % 1; // 황금비 걸음이라 같은 입자가 되풀이되지 않는다
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
    setDuration(seconds) {
      duration = seconds;
      dirty = true;
    },
    timeAt(x) {
      if (!geometry) return null;
      return clamp01((x - geometry.gx0) / THUMB);
    },
    get geometry() {
      return geometry;
    }
  };
}
