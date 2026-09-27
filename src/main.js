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

const host = document.getElementById("stage");
const playButton = document.getElementById("play");
const durationInput = document.getElementById("duration");
const durationOut = document.getElementById("durationOut");
const clockOut = document.getElementById("clock");
const lookNote = document.getElementById("lookNote");

// GSAP이 움직이는 것은 이 숫자들뿐이다. 공도 그래프도 아니고, 0에서 1로 가는 p 하나씩.
// 그것을 화면의 무엇으로 보여줄지는 무대가 정한다 — 움직임과 룩이 여기서 갈라진다.
const proxies = MOTIONS.map(() => ({ p: 0 }));
const stage = createStage(host, MOTIONS, proxies);

let duration = Number(durationInput.value) / 100;
let master = null;
let scrubbing = false;

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

gsap.ticker.add(() => {
  const t = now();
  stage.update(t);
  clockOut.textContent = `t ${t.toFixed(2)}`;
});

function setPlaying(next) {
  master.paused(!next);
  playButton.textContent = next ? "PAUSE" : "PLAY";
  playButton.classList.toggle("on", next);
}

function setLook(key) {
  const look = LOOKS[key];
  for (const button of document.querySelectorAll("[data-look]")) button.classList.toggle("on", button.dataset.look === key);
  lookNote.textContent = `${look.name} — ${look.note}`;
  stage.setLook(look);
}

// -- 다이얼 ----------------------------------------------------------------------------

playButton.addEventListener("click", () => setPlaying(master.paused()));

durationInput.addEventListener("input", () => {
  const t = now(); // 시간을 늘여도 지금 자리는 그대로 둔다
  duration = Number(durationInput.value) / 100;
  durationOut.textContent = `${duration.toFixed(1)}s`;
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

// 그래프 칸 위를 끌면 타임라인의 재생 헤드를 손으로 옮긴다. 놓으면 멈춘 채로 남는다 — 그 순간을
// 보려고 끈 것이므로
const localX = (event) => event.clientX - host.getBoundingClientRect().left - host.clientLeft;

host.addEventListener("pointerdown", (event) => {
  const g = stage.geometry;
  if (!g || localX(event) > g.gx1 + 8) return;
  scrubbing = true;
  setPlaying(false);
  host.setPointerCapture(event.pointerId);
  scrubTo(event);
});

host.addEventListener("pointermove", (event) => {
  if (scrubbing) scrubTo(event);
});

host.addEventListener("pointerup", () => {
  scrubbing = false;
});

function scrubTo(event) {
  master.time(HOLD_START + stage.timeAt(localX(event)) * duration);
}

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
const startLook = LOOKS[query.get("look")] ? query.get("look") : "glow";
const startT = query.has("t") ? clamp01(Number(query.get("t")) || 0) : null;

durationOut.textContent = `${duration.toFixed(1)}s`;
build({ t: startT, paused: startT !== null });
setLook(startLook);
setPlaying(startT === null);
