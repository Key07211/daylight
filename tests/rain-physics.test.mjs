import test from "node:test";
import assert from "node:assert/strict";
import { createRainSplash, sampleRainSplash } from "../src/rain-physics.js";

test("water ejects from its impact point, rises, and lands without going below the floor", () => {
  const splash = createRainSplash(200, 600, () => .5);
  const initial = sampleRainSplash(splash, 0);
  assert.ok(initial.droplets.length >= 3 && initial.droplets.length <= 5);
  assert.ok(initial.droplets.every((drop) => drop.x === 200 && drop.y === 600));
  const rising = sampleRainSplash(splash, .12);
  assert.ok(rising.droplets.some((drop) => drop.x < 200));
  assert.ok(rising.droplets.some((drop) => drop.x > 200));
  assert.ok(rising.droplets.every((drop) => drop.y < 600));
  for (let t = 0; t < splash.life; t += .02) {
    assert.ok(sampleRainSplash(splash, t).droplets.every((drop) => Number.isFinite(drop.x) && Number.isFinite(drop.y) && drop.y <= 600));
  }
});

test("ripples spread and all splash elements disappear after their lifetime", () => {
  const splash = createRainSplash(10, 20, () => .25);
  const early = sampleRainSplash(splash, .05);
  const late = sampleRainSplash(splash, .4);
  assert.ok(late.radius > early.radius);
  assert.ok(late.ringOpacity < early.ringOpacity);
  assert.equal(late.crownOpacity, 0);
  assert.deepEqual(sampleRainSplash(splash, splash.life + 2).droplets, []);
  assert.equal(sampleRainSplash(splash, splash.life + 2).ringOpacity, 0);
});
