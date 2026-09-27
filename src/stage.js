// three.js 무대. 보이는 것은 전부 여기서 정한다 — 움직임은 GSAP이 정하고 여기서는 읽기만 한다.
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
const GRAIN_FPS = 24; // 입자는 필름처럼 초당 24번 바뀐다. 공이 서 있을 때 다시 그리는 빈도도 이것이다

const Y = (y) => -y; // 화면 y → 월드 y

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
  let options = { squash: false, ticks: false, ghosts: false };
  let look = null;
  let viewH = 0;
  let offset = NaN; // 무대 맨 위에서 보이는 띠까지의 거리. 스크롤을 따라 바뀐다
  let dirty = true; // t가 그대로여도 다시 그려야 하는가 — 짓기, 룩, 보조선, 스크롤
  let shownT = NaN;
  let shownGrain = NaN;

  addEventListener("scroll", () => (dirty = true), { passive: true });

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
    const color = new THREE.Color(ink.ink); // 흑백이다. 줄마다 색을 나누지 않고 모두 먹색으로 그린다
    const ballColor = look.ball.color ? new THREE.Color(look.ball.color) : color; // 잔상도 이 색을 따른다
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
        new THREE.MeshBasicMaterial({ color: ballColor, transparent: true, opacity: 0.2 - k * 0.05, depthWrite: false, blending })
      );
      ghost.position.z = 8 - k;
      group.add(ghost);
      ghosts.push(ghost);
    }

    // 공의 겉은 룩이 정한다. 클리어코트를 입히면 반사가 한 겹 위에 따로 얹혀 사탕처럼 읽히고,
    // 반사를 다 끄면 빛을 고르게 먹는 종이가 된다
    const ball = new THREE.Mesh(
      ballGeometry,
      new THREE.MeshPhysicalMaterial({
        color: ballColor,
        roughness: look.ball.roughness,
        metalness: 0,
        clearcoat: look.ball.clearcoat,
        clearcoatRoughness: 0.12,
        specularIntensity: look.ball.specular
      })
    );
    ball.position.z = 10;
    group.add(ball);

    scene.add(group);

    // -- 글자 ----------------------------------------------------------------------------
    const label = document.createElement("div");
    label.className = "label";
    label.style.left = `${g.tx0}px`;
    label.style.top = `${top + 2}px`;
    label.innerHTML = `<b>${motion.name}</b><code>${codeOf(motion)}</code><span>${motion.words}</span>`;
    labels.append(label);

    const peak = document.createElement("div");
    peak.className = "peak";
    peak.style.left = `${g.gx1 + 8}px`;
    peak.style.top = `${gTop - 2}px`;
    const top1 = mode === "speed" ? Math.max(...speeds[index].map(Math.abs)) : Math.max(...values);
    peak.textContent = mode === "speed" ? `peak ${top1.toFixed(1)}×` : top1 > 1.001 ? `max ${top1.toFixed(2)}` : "";
    if (peak.textContent) labels.append(peak);

    return { index, group, ball, ghosts, shadow, ticks, playhead, playDot, mapX, mapY, trackY, values };
  }

  function layout() {
    if (!look) return;
    dispose();
    const W = host.clientWidth;
    // 그래프 칸이 먼저다. 칸은 정사각형이고 한 변은 무대 너비를 따르며, 줄 높이는 거기에 위아래
    // 여백(8, 10)을 더한 만큼이다. 열두 줄이 한 화면에 다 들어오지 않아 스크롤이 생긴다
    const G = Math.round(Math.max(128, Math.min(200, W * 0.24)));
    const row = G + 18;
    const H = TOP * 2 + motions.length * row;
    viewH = Math.min(H, window.innerHeight);

    host.style.height = `${H}px`;
    view.style.height = `${viewH}px`;
    renderer.setSize(W, viewH);
    composer.setSize(W, viewH);
    grade.uniforms.resolution.value.set(W * dpr, viewH * dpr);
    camera.right = W;
    offset = NaN; // 띠의 크기가 바뀌었으니 다음에 그릴 때 카메라를 새로 맞춘다

    const pad = 22;

    // 트랙은 0(출발)과 1(도착)이 아니라 모든 움직임이 닿는 범위를 담는다. 스프링은 목표를
    // 37%나 지나치고 예비 동작은 11% 뒤로 물러난다 — 1을 화면 끝에 붙여 두면 그 넘침이 화면
    // 밖으로 나가, 이 무대가 보여주려는 바로 그 부분이 잘린다.
    let reachLo = 0;
    let reachHi = 1;
    for (const values of samples) for (const f of values) {
      reachLo = Math.min(reachLo, f);
      reachHi = Math.max(reachHi, f);
    }
    const left = pad + G + 84 + RADIUS; // 칸과 트랙 사이에 최고 속도 글자가 들어간다
    const right = W - pad - RADIUS * 1.6;
    const unit = (right - left) / (reachHi - reachLo);
    const tx0 = left - reachLo * unit;
    geometry = { W, H, row, gx0: pad, gx1: pad + G, G, tx0, tx1: tx0 + unit, span: unit, left, right };

    rows = motions.map((motion, index) => buildRow(motion, index, geometry));
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
    timeAt(x) {
      if (!geometry) return null;
      return Math.min(1, Math.max(0, (x - geometry.gx0) / geometry.G));
    },
    get geometry() {
      return geometry;
    }
  };
}
