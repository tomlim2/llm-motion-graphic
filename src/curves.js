// GSAP에 없는 곡선만 여기 둔다. 나머지 — 거듭제곱, 백, 엘라스틱, 바운스, 베지어 — 는 GSAP이
// 이름 하나로 준다. GSAP은 이즈 자리에 함수를 그대로 받으므로 여기 것도 똑같이 꽂힌다.

export const clamp01 = (t) => Math.min(1, Math.max(0, t));

// 진짜 스프링. GSAP의 엘라스틱은 떨림을 공식으로 흉내 낸 것이고, 이건 감쇠 진동을 푼다.
//
//   x(t) = 1 - e^(-ζωt) · (cos ω_d t + (ζω/ω_d) sin ω_d t),   ω_d = ω √(1-ζ²)
//
// ζ는 감쇠비다. 작을수록 오래 떤다. ω는 포락선이 t=1에서 천분의 일이 되게 골라 한 바퀴 안에
// 가라앉게 한다.
export function spring(zeta = 0.35) {
  const omega = Math.log(1000) / zeta;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return (t) => {
    if (t >= 1) return 1;
    const envelope = Math.exp(-zeta * omega * t);
    return 1 - envelope * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
  };
}

// 스톱모션. GSAP의 steps(n)은 직선을 계단으로 끊는다. 이건 곡선을 두고 시간만 끊어서, 칸과 칸
// 사이의 간격에 원래 곡선의 가속이 남는다 — 손으로 그린 애니메이션의 투스가 그렇다.
export const stepped = (ease, frames) => (t) => ease(Math.min(1, Math.floor(t * frames + 1e-9) / frames));

// 표본 배열에서 t의 값을 읽는다. 잔상처럼 지금이 아닌 순간의 자리가 필요할 때 쓴다.
export function readCurve(values, t) {
  const n = values.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return values[i] + (values[i + 1] - values[i]) * (x - i);
}

// 표본 배열에서 속도. 1이면 선형과 같은 빠르기다.
export function speedFrom(values, t) {
  const n = values.length - 1;
  const i = Math.round(clamp01(t) * n);
  const a = Math.max(0, i - 1);
  const b = Math.min(n, i + 1);
  return b === a ? 0 : ((values[b] - values[a]) * n) / (b - a);
}
