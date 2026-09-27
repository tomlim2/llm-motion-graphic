// 재생 장치. 시계는 GSAP이 쥔다 — 열두 움직임을 한 타임라인에 나란히 걸어 두고, 그 타임라인
// 하나를 재생하고 멈추고 손으로 끈다. 무대는 틱마다 GSAP이 옮겨 둔 값을 읽어 그리기만 한다.
//
// 모든 공이 같은 순간에 떠나 같은 순간에 닿는다. 줄마다 다른 것은 오직 그 사이를 어떻게
// 지나가느냐뿐이다. 그것이 곧 곡선의 차이다.

import { gsap } from "gsap";
import { MOTIONS, buildTimeline } from "./motions.js";
import { LOOKS } from "./looks.js";
import { createStage } from "./stage.js";
import { clamp01 } from "./curves.js";

const HOLD_START = 0.35; // 초. 떠나기 전에 잠시 선다
const HOLD_END = 0.6; // 초. 닿고 나서 잠시 선다 — 오버슈트가 가라앉는 것을 보려면 필요하다
const FPS = 60; // 시간 표시의 한 칸. 모션 릴의 타임코드처럼 시:분:초:프레임으로 센다

const host = document.getElementById("stage");
const playButton = document.getElementById("play");
const durationInput = document.getElementById("duration");
const durationOut = document.getElementById("durationOut");
const durationEcho = document.getElementById("durationEcho");
const clockOut = document.getElementById("clock");
const tOut = document.getElementById("t");
const progress = document.getElementById("progress");
const progressBar = progress.querySelector("i");

// 제목의 숫자는 움직임의 수를 따른다. motions.js에 한 줄을 더하면 제목도 따라 바뀐다
const NUMBERS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen"];
document.getElementById("headline").textContent = `${NUMBERS[MOTIONS.length] ?? MOTIONS.length} ways to get from A to B.`;

// GSAP이 움직이는 것은 이 숫자들뿐이다. 공도 그래프도 아니고, 0에서 1로 가는 p 하나씩.
// 그것을 화면의 무엇으로 보여줄지는 무대가 정한다 — 움직임과 룩이 여기서 갈라진다.
const proxies = MOTIONS.map(() => ({ p: 0 }));
const stage = createStage(host, MOTIONS, proxies);

let duration = Number(durationInput.value) / 100;
let master = null;
let scrubbing = null; // 지금 끌고 있는 것 — 무대의 그래프 칸이나 아래의 진행 막대

// 한 바퀴: 쉼 → 열두 움직임이 한꺼번에 → 쉼 → 되풀이.
// 걸리는 시간을 바꾸면 새로 짠다. master.timeScale()로 통째로 늘이면 앞뒤의 쉼까지 같이 늘어나,
// 짧게 돌릴 때 도착한 공을 볼 틈이 없어진다.
function build({ t = null, paused = false } = {}) {
  master?.kill();
  // 트윈은 처음 그려지는 순간에 출발값을 읽는다. 옛 타임라인이 공을 어디 두었든 0에서 읽게 한다
  for (const proxy of proxies) proxy.p = 0;
  master = gsap.timeline({ repeat: -1, repeatDelay: HOLD_END, paused });
  MOTIONS.forEach((motion, i) => master.add(buildTimeline(motion, proxies[i]).duration(duration), HOLD_START));
  if (t !== null) master.time(HOLD_START + t * duration);
}

const now = () => clamp01((master.time() - HOLD_START) / duration);
const seek = (t) => master.time(HOLD_START + t * duration);

const pad2 = (n) => String(n).padStart(2, "0");
function timecode(seconds) {
  const frames = Math.floor(seconds * FPS);
  const s = Math.floor(frames / FPS);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, frames % FPS].map(pad2).join(":");
}

function showDuration() {
  durationOut.textContent = durationEcho.textContent = `${duration.toFixed(2)}s`;
  stage.setDuration(duration);
}

// 틱은 화면 주사율대로 돈다. 무대는 바뀐 것이 있을 때만 그리고, 글자와 막대도 바뀔 때만 쓴다
const shown = { clock: "", t: "", bar: NaN };
gsap.ticker.add(() => {
  const t = now();
  stage.update(t);
  const clock = timecode(master.totalTime());
  if (clock !== shown.clock) clockOut.textContent = shown.clock = clock;
  const text = `t ${t.toFixed(2)}`;
  if (text !== shown.t) tOut.textContent = shown.t = text;
  if (t !== shown.bar) progressBar.style.transform = `scaleX(${(shown.bar = t)})`;
});

function setPlaying(next) {
  master.paused(!next);
  playButton.textContent = next ? "PAUSE" : "PLAY";
  playButton.classList.toggle("on", next);
}

function setLook(key) {
  for (const button of document.querySelectorAll("[data-look]")) button.classList.toggle("on", button.dataset.look === key);
  stage.setLook(LOOKS[key]);
}

// -- 다이얼 ----------------------------------------------------------------------------

playButton.addEventListener("click", () => setPlaying(master.paused()));

durationInput.addEventListener("input", () => {
  const t = now(); // 시간을 늘여도 지금 자리는 그대로 둔다
  duration = Number(durationInput.value) / 100;
  showDuration();
  build({ t, paused: master.paused() });
});

for (const button of document.querySelectorAll("[data-mode]")) {
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-mode]")) other.classList.toggle("on", other === button);
    stage.setMode(button.dataset.mode);
  });
}

for (const button of document.querySelectorAll("[data-toggle]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.toggle;
    const on = !button.classList.contains("on");
    button.classList.toggle("on", on);
    stage.setOptions({ [key]: on });
  });
}

for (const button of document.querySelectorAll("[data-look]")) {
  button.addEventListener("click", () => setLook(button.dataset.look));
}

// 손으로 시간 끌기. 그래프 칸 위를 가로로 끌거나 아래 진행 막대를 끈다. 놓으면 멈춘 채로 남는다 —
// 그 순간을 보려고 끈 것이므로
const localX = (event) => event.clientX - host.getBoundingClientRect().left - host.clientLeft;

function grab(target, event, scrubTo) {
  scrubbing = target;
  setPlaying(false);
  target.setPointerCapture(event.pointerId);
  scrubTo(event);
  const move = (next) => scrubTo(next);
  const drop = () => {
    scrubbing = null;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", drop);
    target.removeEventListener("pointercancel", drop);
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", drop);
  target.addEventListener("pointercancel", drop);
}

host.addEventListener("pointerdown", (event) => {
  const g = stage.geometry;
  const x = localX(event);
  if (scrubbing || !g || x < g.gx0 - 4 || x > g.gx1 + 12) return;
  grab(host, event, (e) => seek(stage.timeAt(localX(e))));
});

progress.addEventListener("pointerdown", (event) => {
  if (scrubbing) return;
  grab(progress, event, (e) => {
    const box = progress.getBoundingClientRect();
    seek(clamp01((e.clientX - box.left) / box.width));
  });
});

const LOOK_KEYS = Object.keys(LOOKS);

addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === " ") {
    event.preventDefault();
    setPlaying(master.paused());
  }
  const look = LOOK_KEYS[Number(event.key) - 1];
  if (look) setLook(look);
});

addEventListener("resize", () => stage.layout());

// -- 시동 ------------------------------------------------------------------------------

// ?look=film&t=0.48 — 룩과 순간을 주소로 건넨다. t가 있으면 그 순간에 멈춘 채로 연다
const query = new URLSearchParams(location.search);
const startLook = LOOKS[query.get("look")] ? query.get("look") : "paper";
const startT = query.has("t") ? clamp01(Number(query.get("t")) || 0) : null;

showDuration();
build({ t: startT, paused: startT !== null });
setLook(startLook);
setPlaying(startT === null);
