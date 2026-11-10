import test from "node:test";
import assert from "node:assert/strict";
import "../docs/slime-sim.js";

const { createSlimeSim, PRESETS } = globalThis.SlimeSim;
const WIDTH = 640;
const HEIGHT = 470;

function settle(preset, steps, seed = 7) {
  const sim = createSlimeSim({ width: WIDTH, height: HEIGHT, seed });
  sim.applyPreset(preset);
  sim.spawnBlob(WIDTH / 2, 190, 500);
  for (let step = 0; step < steps; step += 1) sim.step();
  return sim;
}

function allInside(sim) {
  for (let i = 0; i < sim.count; i += 1) {
    if (!Number.isFinite(sim.x[i]) || !Number.isFinite(sim.y[i])) return false;
    if (sim.x[i] < 0 || sim.x[i] > sim.width || sim.y[i] < 0 || sim.y[i] > sim.height) return false;
  }
  return true;
}

test("every material stays finite, inside the tank, and comes to rest", () => {
  for (const preset of Object.keys(PRESETS)) {
    const sim = settle(preset, 1500);
    assert.equal(sim.count, 500, preset);
    assert.ok(allInside(sim), `${preset} left the tank`);
    assert.ok(sim.measure().maxSpeed < 1, `${preset} is still moving at ${sim.measure().maxSpeed}`);
  }
});

test("slime holds a mound while water spreads into a puddle", () => {
  const slime = settle("slime", 1800).measure();
  const water = settle("water", 1800).measure();
  const slimeHeight = slime.maxY - slime.minY;
  const waterHeight = water.maxY - water.minY;
  assert.ok(slimeHeight > waterHeight * 1.5, `slime ${slimeHeight} vs water ${waterHeight}`);
  assert.ok(slime.maxX - slime.minX < WIDTH * .7);
  assert.ok(water.maxX - water.minX > WIDTH * .9);
});

test("only elastic materials keep springs, and no spring outlives the interaction radius", () => {
  const slime = settle("slime", 600);
  assert.ok(slime.springCount > slime.count * 4);
  for (let s = 0; s < slime.springCount; s += 1) {
    assert.ok(slime.springA[s] < slime.springB[s]);
    assert.ok(slime.springRest[s] > 0 && slime.springRest[s] <= slime.radius);
  }
  assert.equal(settle("water", 600).springCount, 0);
  slime.applyPreset("honey");
  slime.step();
  assert.equal(slime.springCount, 0);
});

test("pulling lifts the slime, stretches it, and lets go on release", () => {
  const sim = settle("slime", 1500);
  const before = sim.measure();
  assert.ok(sim.grab(before.centerX, before.minY + 12, 30) > 5);
  for (let step = 0; step < 240; step += 1) {
    sim.moveGrab(before.centerX, before.minY + 12 - step * .7);
    sim.step();
  }
  const pulled = sim.measure();
  assert.ok(pulled.minY < before.minY - 100, `top only moved from ${before.minY} to ${pulled.minY}`);
  assert.ok(pulled.maxY - pulled.minY > (before.maxY - before.minY) * 1.2);
  assert.ok(allInside(sim));
  sim.release();
  assert.equal(sim.grabbed, 0);
  for (let step = 0; step < 1500; step += 1) sim.step();
  assert.ok(sim.measure().minY > pulled.minY + 80);
});

test("the pusher clears a hole and the tank can shrink around the slime", () => {
  const sim = settle("slime", 900);
  const centre = sim.measure();
  Object.assign(sim.pusher, { active: true, x: centre.centerX, y: centre.centerY, radius: 26 });
  for (let step = 0; step < 30; step += 1) sim.step();
  for (let i = 0; i < sim.count; i += 1) {
    assert.ok(Math.hypot(sim.x[i] - centre.centerX, sim.y[i] - centre.centerY) > 24);
  }
  sim.pusher.active = false;
  sim.setBounds(300, 300);
  for (let step = 0; step < 300; step += 1) sim.step();
  assert.ok(allInside(sim));
});

test("the same seed replays the same motion and the particle cap holds", () => {
  const first = settle("slime", 400, 11);
  const second = settle("slime", 400, 11);
  assert.deepEqual(Array.from(first.x.subarray(0, first.count)), Array.from(second.x.subarray(0, second.count)));
  assert.deepEqual(Array.from(first.y.subarray(0, first.count)), Array.from(second.y.subarray(0, second.count)));
  const small = createSlimeSim({ width: 200, height: 200, maxParticles: 40 });
  assert.equal(small.spawnBlob(100, 100, 100), 40);
  assert.equal(small.addParticle(50, 50), -1);
  small.clear();
  assert.equal(small.count, 0);
});
