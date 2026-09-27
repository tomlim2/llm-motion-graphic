// 움직임 목록. 이 파일이 Claude와 모션이 만나는 자리다.
//
// 한 줄 한 줄이 "말로 적은 움직임"과 "그것을 GSAP으로 옮긴 것"의 짝이다. 대부분은 이즈 이름
// 하나로 끝난다 — GSAP이 거의 모든 느낌에 이름을 붙여 두었기 때문이다. 이름이 없는 느낌은
// 둘 중 하나다. 이야기로 설명되면 타임라인으로 이어 붙이고, 물리로 설명되면 함수로 푼다.
//
// 모든 움직임은 target.p 를 0에서 1로 옮기고 길이는 1이다. 실제 초는 바깥 시계가 정한다.

import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { spring, stepped } from "./curves.js";

gsap.registerPlugin(CustomEase);

export const MOTIONS = [
  {
    id: "linear",
    name: "LINEAR",
    words: "처음부터 끝까지 같은 빠르기. 기계가 움직이는 느낌",
    ease: "none"
  },
  {
    id: "ease-in",
    name: "EASE IN",
    words: "천천히 출발해서 점점 빨라진다. 떨어지는 물건처럼",
    ease: "power2.in"
  },
  {
    id: "ease-out",
    name: "EASE OUT",
    words: "빠르게 들어와서 부드럽게 멈춘다. 화면에 들어오는 것들의 기본",
    ease: "power2.out"
  },
  {
    id: "ease-in-out",
    name: "EASE IN-OUT",
    words: "천천히 떠나 가운데서 가장 빠르고 천천히 닿는다. 가장 흔한 기본값",
    ease: "power2.inOut"
  },
  {
    id: "anticipation",
    name: "ANTICIPATION",
    words: "반대쪽으로 살짝 당겼다가 튀어 나간다. 캐릭터가 뛰기 직전",
    ease: "back.in(1.8)"
  },
  {
    id: "overshoot",
    name: "OVERSHOOT",
    words: "목표를 지나쳤다가 되돌아와 앉는다. 탄력 있는 도착",
    ease: "back.out(1.8)"
  },
  {
    id: "elastic",
    name: "ELASTIC",
    words: "고무줄에 매달린 듯 목표 근처에서 몇 번 떨다 멈춘다",
    ease: "elastic.out(1, 0.32)"
  },
  {
    id: "bounce",
    name: "BOUNCE",
    words: "벽에 부딪혀 통통 튕기다가 멈춘다. 튈 때마다 작아진다",
    ease: "bounce.out"
  },
  {
    id: "spring",
    name: "SPRING",
    words: "진짜 스프링. 모양을 흉내 내지 않고 질량과 감쇠로 푼다",
    ease: spring(0.3),
    code: "spring(0.3)" // GSAP에 없다 — 엘라스틱은 공식이고 이건 물리다
  },
  {
    id: "emphasized",
    name: "EMPHASIZED",
    words: "번개처럼 나와서 아주 길게 내려앉는다. 핸들 두 개로 정한 곡선",
    ease: CustomEase.create("emphasized", "0.05,0.7,0.1,1"),
    code: 'CustomEase("0.05,0.7,0.1,1")'
  },
  {
    id: "hesitate",
    name: "HESITATE",
    words: "가다가 한 번 멈칫하고, 마음을 고쳐먹은 듯 다시 간다",
    // 곡선 하나가 아니라 트윈 둘과 쉼 하나다. 이야기는 타임라인으로 쓴다
    timeline: (tl, target) =>
      tl
        .to(target, { p: 0.46, duration: 0.38, ease: "power2.out" })
        .to(target, { p: 1, duration: 0.44, ease: "power2.inOut" }, "+=0.18"),
    code: "timeline: out → 쉼 → inOut"
  },
  {
    id: "on-twos",
    name: "ON TWOS",
    words: "스톱모션처럼 여덟 장만 찍는다. 부드러운 곡선을 시간만 계단으로 끊는다",
    ease: stepped(gsap.parseEase("power2.inOut"), 8),
    code: 'stepped("power2.inOut", 8)' // steps(8)은 직선을 끊는다 — 곡선을 살리려면 함수로
  }
];

// 화면에 적을 GSAP 표기
export const codeOf = (motion) => motion.code ?? (typeof motion.ease === "string" ? motion.ease : "fn");

// 한 움직임을 GSAP 타임라인으로. 길이를 1로 맞춰, 타임라인으로 짠 움직임도 같은 시계에 선다.
export function buildTimeline(motion, target, vars = {}) {
  const tl = gsap.timeline(vars);
  if (motion.timeline) motion.timeline(tl, target);
  else tl.to(target, { p: 1, duration: 1, ease: motion.ease });
  if (Math.abs(tl.duration() - 1) > 1e-6) tl.duration(1);
  return tl;
}

// 그래프용 표본. 멈춘 타임라인을 처음부터 끝까지 끌며 값을 읽는다 — 이즈 이름이든 함수든
// 타임라인이든 같은 방법으로 잰다. 그래프에 그려지는 것이 곧 GSAP이 실제로 움직이는 것이다.
export function sampleMotion(motion, samples) {
  const target = { p: 0 };
  const tl = buildTimeline(motion, target, { paused: true });
  const values = [];
  for (let i = 0; i <= samples; i += 1) {
    tl.progress(i / samples);
    values.push(target.p);
  }
  tl.kill();
  return values;
}
