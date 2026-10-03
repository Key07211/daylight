// Pixel-scale ballistic droplets stay above their impact plane until landing.
export function createRainSplash(x, y, random = Math.random) {
  const gravity = 175;
  const count = 3 + Math.floor(random() * 3);
  return {
    x, y, age: 0, life: .75 + random() * .2, gravity,
    droplets: Array.from({ length: count }, (_, index) => ({
      vx: ((index / (count - 1)) * 2 - 1) * (25 + random() * 28),
      vy: -(37 + random() * 26),
      radius: .7 + random() * .45,
    })),
  };
}

export function sampleRainSplash(splash, age = splash.age) {
  const t = Math.max(0, age);
  const progress = Math.min(1, t / splash.life);
  const ringOpacity = Math.pow(1 - progress, 1.4);
  return {
    radius: 2 + Math.sqrt(progress) * 20,
    ringOpacity,
    crownOpacity: Math.max(0, 1 - t / .2),
    crownRadius: 2.5 + Math.min(t, .2) * 33,
    droplets: t >= splash.life ? [] : splash.droplets.flatMap(({ vx, vy, radius }) => {
      const dy = vy * t + .5 * splash.gravity * t * t;
      if (dy > 0) return [];
      return [{ x: splash.x + vx * t, y: splash.y + dy, radius, opacity: ringOpacity }];
    }),
  };
}
