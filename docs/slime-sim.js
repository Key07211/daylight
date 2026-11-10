// Daylight slime lab: a particle-based viscoelastic fluid.
//
// The model follows Clavet, Beaudoin & Poulin, "Particle-based Viscoelastic
// Fluid Simulation" (2005): double density relaxation keeps the volume and
// gives surface tension, pairwise impulses give viscosity, and a network of
// springs whose rest lengths creep under strain gives elasticity and plasticity.
//
// This is a classic script on purpose. It defines globalThis.SlimeSim so the
// page keeps working when docs/slime.html is opened straight from disk, and
// the tests load it with a bare import.
(function (root) {
  "use strict";

  // All values are per simulation step. A step is 1/180 s in the page.
  const PRESETS = {
    slime: {
      viscosity: .1, drag: .02, elasticity: .2, plasticity: .003, yieldRatio: .2, breakStrain: 0,
      stiffness: .5, nearStiffness: .6, restDensity: 3, gravity: .02, wallFriction: .08,
    },
    jelly: {
      viscosity: .03, drag: .01, elasticity: .25, plasticity: 0, yieldRatio: 0, breakStrain: 1.4,
      stiffness: .5, nearStiffness: .6, restDensity: 3, gravity: .02, wallFriction: .02,
    },
    honey: {
      viscosity: .25, drag: .02, elasticity: 0, plasticity: 0, yieldRatio: 0, breakStrain: 0,
      stiffness: .5, nearStiffness: .6, restDensity: 3, gravity: .02, wallFriction: .05,
    },
    water: {
      viscosity: .004, drag: .02, elasticity: 0, plasticity: 0, yieldRatio: 0, breakStrain: 0,
      stiffness: .5, nearStiffness: .6, restDensity: 3, gravity: .02, wallFriction: 0,
    },
  };

  const MAX_PARTICLES = 4096;
  const SPRING_SCAN_INTERVAL = 3;

  function createSlimeSim(options) {
    const opt = options || {};
    const h = opt.radius || 16;
    const h2 = h * h;
    const maxParticles = Math.max(1, Math.min(opt.maxParticles || 2400, MAX_PARTICLES));
    const pad = h * .25;
    const maxSpeed = h * .45;
    const params = Object.assign({}, PRESETS.slime, opt.params);

    let width = 0;
    let height = 0;
    let count = 0;
    let tick = 0;
    let seed = (opt.seed >>> 0) || 0x9e3779b9;

    const x = new Float32Array(maxParticles);
    const y = new Float32Array(maxParticles);
    const px = new Float32Array(maxParticles);
    const py = new Float32Array(maxParticles);
    const vx = new Float32Array(maxParticles);
    const vy = new Float32Array(maxParticles);
    const rho = new Float32Array(maxParticles);
    const rhoNear = new Float32Array(maxParticles);

    // Uniform grid, one cell per interaction radius.
    let cols = 1;
    let rows = 1;
    let cellStart = new Int32Array(2);
    let cellFill = new Int32Array(1);
    const cellOf = new Int32Array(maxParticles);
    const sorted = new Int32Array(maxParticles);

    let pairCapacity = 8192;
    let pairCount = 0;
    let pairI = new Int32Array(pairCapacity);
    let pairJ = new Int32Array(pairCapacity);
    let pairA = new Float32Array(pairCapacity);
    let pairNx = new Float32Array(pairCapacity);
    let pairNy = new Float32Array(pairCapacity);

    let springCapacity = 8192;
    let springCount = 0;
    let springA = new Int32Array(springCapacity);
    let springB = new Int32Array(springCapacity);
    let springRest = new Float32Array(springCapacity);
    const springIndex = new Map();

    const grabIndex = new Int32Array(maxParticles);
    const grabOx = new Float32Array(maxParticles);
    const grabOy = new Float32Array(maxParticles);
    const grabWeight = new Float32Array(maxParticles);
    let grabCount = 0;
    let grabX = 0;
    let grabY = 0;

    const pusher = { active: false, x: 0, y: 0, radius: h * 1.6 };

    function random() {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function setBounds(nextWidth, nextHeight) {
      width = Math.max(h * 4, nextWidth);
      height = Math.max(h * 4, nextHeight);
      cols = Math.ceil(width / h) + 1;
      rows = Math.ceil(height / h) + 1;
      cellStart = new Int32Array(cols * rows + 1);
      cellFill = new Int32Array(cols * rows);
      for (let i = 0; i < count; i += 1) {
        x[i] = Math.min(width - pad, Math.max(pad, x[i]));
        y[i] = Math.min(height - pad, Math.max(pad, y[i]));
      }
    }

    function addParticle(ax, ay, avx, avy) {
      if (count >= maxParticles) return -1;
      const i = count;
      x[i] = px[i] = Math.min(width - pad, Math.max(pad, ax));
      y[i] = py[i] = Math.min(height - pad, Math.max(pad, ay));
      vx[i] = avx || 0;
      vy[i] = avy || 0;
      count += 1;
      return i;
    }

    // A hexagonally packed disc, filled from the centre outwards.
    function spawnBlob(cx, cy, amount, spacing) {
      const s = spacing || h * .44;
      const rowHeight = s * Math.sqrt(3) / 2;
      const reach = Math.sqrt(amount * s * rowHeight / Math.PI) * 1.2 + s;
      const points = [];
      for (let row = -Math.ceil(reach / rowHeight); row * rowHeight <= reach; row += 1) {
        const shift = (row & 1) * s * .5;
        for (let col = -Math.ceil(reach / s); col * s <= reach; col += 1) {
          const dx = col * s + shift;
          const dy = row * rowHeight;
          points.push([dx * dx + dy * dy, dx, dy]);
        }
      }
      points.sort((a, b) => a[0] - b[0]);
      let added = 0;
      for (let k = 0; k < points.length && added < amount; k += 1) {
        const jitterX = (random() - .5) * s * .08;
        const jitterY = (random() - .5) * s * .08;
        if (addParticle(cx + points[k][1] + jitterX, cy + points[k][2] + jitterY, 0, 0) < 0) break;
        added += 1;
      }
      return added;
    }

    function clear() {
      count = 0;
      pairCount = 0;
      clearSprings();
      release();
    }

    function clearSprings() {
      springCount = 0;
      springIndex.clear();
    }

    function growPairs() {
      pairCapacity *= 2;
      const grow = (source, Type) => { const next = new Type(pairCapacity); next.set(source); return next; };
      pairI = grow(pairI, Int32Array);
      pairJ = grow(pairJ, Int32Array);
      pairA = grow(pairA, Float32Array);
      pairNx = grow(pairNx, Float32Array);
      pairNy = grow(pairNy, Float32Array);
    }

    function testPair(i, j) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      if (dx * dx + dy * dy >= h2) return;
      if (pairCount === pairCapacity) growPairs();
      pairI[pairCount] = i;
      pairJ[pairCount] = j;
      pairCount += 1;
    }

    function findPairs() {
      const cells = cols * rows;
      cellStart.fill(0);
      for (let i = 0; i < count; i += 1) {
        const cx = Math.min(cols - 1, Math.max(0, (x[i] / h) | 0));
        const cy = Math.min(rows - 1, Math.max(0, (y[i] / h) | 0));
        const cell = cy * cols + cx;
        cellOf[i] = cell;
        cellStart[cell + 1] += 1;
      }
      for (let c = 0; c < cells; c += 1) {
        cellStart[c + 1] += cellStart[c];
        cellFill[c] = cellStart[c];
      }
      for (let i = 0; i < count; i += 1) {
        sorted[cellFill[cellOf[i]]] = i;
        cellFill[cellOf[i]] += 1;
      }
      pairCount = 0;
      for (let cy = 0; cy < rows; cy += 1) {
        for (let cx = 0; cx < cols; cx += 1) {
          const cell = cy * cols + cx;
          const start = cellStart[cell];
          const end = cellStart[cell + 1];
          if (start === end) continue;
          for (let a = start; a < end; a += 1) {
            const i = sorted[a];
            for (let b = a + 1; b < end; b += 1) testPair(i, sorted[b]);
            // Forward half of the neighbourhood, so each pair is visited once.
            if (cx + 1 < cols) {
              for (let b = cellStart[cell + 1], e = cellStart[cell + 2]; b < e; b += 1) testPair(i, sorted[b]);
            }
            if (cy + 1 < rows) {
              const below = cell + cols;
              if (cx > 0) {
                for (let b = cellStart[below - 1], e = cellStart[below]; b < e; b += 1) testPair(i, sorted[b]);
              }
              for (let b = cellStart[below], e = cellStart[below + 1]; b < e; b += 1) testPair(i, sorted[b]);
              if (cx + 1 < cols) {
                for (let b = cellStart[below + 1], e = cellStart[below + 2]; b < e; b += 1) testPair(i, sorted[b]);
              }
            }
          }
        }
      }
    }

    // Radial impulses that pull the velocities of close particles together.
    function applyViscosity() {
      const sigma = Math.min(1, params.viscosity);
      const beta = params.drag;
      if (sigma <= 0 && beta <= 0) return;
      for (let k = 0; k < pairCount; k += 1) {
        const i = pairI[k];
        const j = pairJ[k];
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const r2 = dx * dx + dy * dy;
        if (r2 < 1e-8 || r2 >= h2) continue;
        const r = Math.sqrt(r2);
        const nx = dx / r;
        const ny = dy / r;
        const closing = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
        let impulse = sigma * closing;
        if (closing > 0) impulse = Math.min(closing, impulse + beta * closing * closing);
        impulse *= (1 - r / h) * .5;
        vx[i] -= impulse * nx;
        vy[i] -= impulse * ny;
        vx[j] += impulse * nx;
        vy[j] += impulse * ny;
      }
    }

    function addSpring(i, j, rest) {
      if (springCount === springCapacity) {
        springCapacity *= 2;
        const grow = (source, Type) => { const next = new Type(springCapacity); next.set(source); return next; };
        springA = grow(springA, Int32Array);
        springB = grow(springB, Int32Array);
        springRest = grow(springRest, Float32Array);
      }
      springA[springCount] = i;
      springB[springCount] = j;
      springRest[springCount] = rest;
      springIndex.set(i * MAX_PARTICLES + j, springCount);
      springCount += 1;
    }

    function removeSpring(s) {
      springIndex.delete(springA[s] * MAX_PARTICLES + springB[s]);
      springCount -= 1;
      if (s !== springCount) {
        springA[s] = springA[springCount];
        springB[s] = springB[springCount];
        springRest[s] = springRest[springCount];
        springIndex.set(springA[s] * MAX_PARTICLES + springB[s], s);
      }
    }

    // Particles that touch bond at their current distance.
    function bondNeighbours() {
      for (let k = 0; k < pairCount; k += 1) {
        const i = pairI[k];
        const j = pairJ[k];
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const r2 = dx * dx + dy * dy;
        if (r2 >= h2) continue;
        const a = i < j ? i : j;
        const b = i < j ? j : i;
        if (!springIndex.has(a * MAX_PARTICLES + b)) addSpring(a, b, Math.sqrt(r2));
      }
    }

    // Springs pull back within the yield band and creep beyond it. A spring
    // that has crept past the interaction radius lets go, so strands can tear.
    function relaxSprings() {
      const stiffness = params.elasticity;
      const creep = params.plasticity;
      const yieldRatio = params.yieldRatio;
      const breakStrain = params.breakStrain;
      for (let s = springCount - 1; s >= 0; s -= 1) {
        const i = springA[s];
        const j = springB[s];
        const dx = x[j] - x[i];
        const dy = y[j] - y[i];
        const r = Math.sqrt(dx * dx + dy * dy);
        let rest = springRest[s];
        if (creep > 0) {
          const tolerance = yieldRatio * rest;
          if (r > rest + tolerance) rest += creep * (r - rest - tolerance);
          else if (r < rest - tolerance) rest -= creep * (rest - tolerance - r);
          springRest[s] = rest;
        }
        if (rest > h || (breakStrain > 0 && r > rest * (1 + breakStrain))) {
          removeSpring(s);
          continue;
        }
        if (r < 1e-6) continue;
        const shift = stiffness * (1 - rest / h) * (rest - r) * .5 / r;
        x[i] -= shift * dx;
        y[i] -= shift * dy;
        x[j] += shift * dx;
        y[j] += shift * dy;
      }
    }

    // Double density relaxation: the far pressure pulls the fluid to its rest
    // density (cohesion and surface tension), the near pressure stops clumping.
    function relaxDensity() {
      rho.fill(0, 0, count);
      rhoNear.fill(0, 0, count);
      for (let k = 0; k < pairCount; k += 1) {
        const i = pairI[k];
        const j = pairJ[k];
        let dx = x[j] - x[i];
        let dy = y[j] - y[i];
        let r2 = dx * dx + dy * dy;
        if (r2 >= h2) { pairA[k] = 0; continue; }
        if (r2 < 1e-8) {
          const angle = random() * Math.PI * 2;
          dx = Math.cos(angle) * 1e-3;
          dy = Math.sin(angle) * 1e-3;
          r2 = 1e-6;
        }
        const r = Math.sqrt(r2);
        const a = 1 - r / h;
        pairA[k] = a;
        pairNx[k] = dx / r;
        pairNy[k] = dy / r;
        rho[i] += a * a;
        rho[j] += a * a;
        rhoNear[i] += a * a * a;
        rhoNear[j] += a * a * a;
      }
      const k1 = params.stiffness;
      const k2 = params.nearStiffness;
      const rest2 = params.restDensity * 2;
      for (let k = 0; k < pairCount; k += 1) {
        const a = pairA[k];
        if (a <= 0) continue;
        const i = pairI[k];
        const j = pairJ[k];
        const pressure = k1 * (rho[i] + rho[j] - rest2);
        const nearPressure = k2 * (rhoNear[i] + rhoNear[j]);
        const shift = (pressure * a + nearPressure * a * a) * .5;
        x[i] -= shift * pairNx[k];
        y[i] -= shift * pairNy[k];
        x[j] += shift * pairNx[k];
        y[j] += shift * pairNy[k];
      }
    }

    function applyGrab() {
      for (let g = 0; g < grabCount; g += 1) {
        const i = grabIndex[g];
        const pull = grabWeight[g] * .3;
        x[i] += (grabX + grabOx[g] - x[i]) * pull;
        y[i] += (grabY + grabOy[g] - y[i]) * pull;
      }
    }

    function collide() {
      const keep = 1 - Math.min(1, Math.max(0, params.wallFriction));
      const right = width - pad;
      const bottom = height - pad;
      if (pusher.active) {
        const reach = pusher.radius;
        const reach2 = reach * reach;
        for (let i = 0; i < count; i += 1) {
          const dx = x[i] - pusher.x;
          const dy = y[i] - pusher.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= reach2) continue;
          if (d2 < 1e-6) { y[i] -= reach; continue; }
          const scale = reach / Math.sqrt(d2);
          x[i] = pusher.x + dx * scale;
          y[i] = pusher.y + dy * scale;
        }
      }
      for (let i = 0; i < count; i += 1) {
        if (x[i] < pad) { x[i] = pad; y[i] = py[i] + (y[i] - py[i]) * keep; }
        else if (x[i] > right) { x[i] = right; y[i] = py[i] + (y[i] - py[i]) * keep; }
        if (y[i] < pad) { y[i] = pad; x[i] = px[i] + (x[i] - px[i]) * keep; }
        else if (y[i] > bottom) { y[i] = bottom; x[i] = px[i] + (x[i] - px[i]) * keep; }
        if (x[i] < pad) x[i] = pad; else if (x[i] > right) x[i] = right;
      }
    }

    function step() {
      const gravity = params.gravity;
      for (let i = 0; i < count; i += 1) vy[i] += gravity;
      findPairs();
      applyViscosity();
      for (let i = 0; i < count; i += 1) {
        px[i] = x[i];
        py[i] = y[i];
        x[i] += vx[i];
        y[i] += vy[i];
      }
      if (params.elasticity > 0) {
        if (tick % SPRING_SCAN_INTERVAL === 0) bondNeighbours();
        relaxSprings();
      } else if (springCount > 0) {
        clearSprings();
      }
      relaxDensity();
      applyGrab();
      collide();
      for (let i = 0; i < count; i += 1) {
        let nvx = x[i] - px[i];
        let nvy = y[i] - py[i];
        const speed2 = nvx * nvx + nvy * nvy;
        if (speed2 > maxSpeed * maxSpeed) {
          const scale = maxSpeed / Math.sqrt(speed2);
          nvx *= scale;
          nvy *= scale;
        }
        vx[i] = nvx;
        vy[i] = nvy;
      }
      tick += 1;
    }

    function grab(gx, gy, reach) {
      release();
      const reach2 = reach * reach;
      for (let i = 0; i < count; i += 1) {
        const dx = x[i] - gx;
        const dy = y[i] - gy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= reach2) continue;
        grabIndex[grabCount] = i;
        grabOx[grabCount] = dx * .7;
        grabOy[grabCount] = dy * .7;
        grabWeight[grabCount] = Math.max(.2, 1 - Math.sqrt(d2) / reach);
        grabCount += 1;
      }
      grabX = gx;
      grabY = gy;
      return grabCount;
    }

    function moveGrab(gx, gy) {
      grabX = gx;
      grabY = gy;
    }

    function release() {
      grabCount = 0;
    }

    function impulse(ix, iy) {
      for (let i = 0; i < count; i += 1) {
        vx[i] += ix;
        vy[i] += iy;
      }
    }

    function measure() {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let sumX = 0, sumY = 0, kinetic = 0, fastest = 0;
      for (let i = 0; i < count; i += 1) {
        if (x[i] < minX) minX = x[i];
        if (x[i] > maxX) maxX = x[i];
        if (y[i] < minY) minY = y[i];
        if (y[i] > maxY) maxY = y[i];
        sumX += x[i];
        sumY += y[i];
        const speed2 = vx[i] * vx[i] + vy[i] * vy[i];
        kinetic += speed2;
        if (speed2 > fastest) fastest = speed2;
      }
      const n = Math.max(1, count);
      return {
        count, minX, maxX, minY, maxY,
        centerX: sumX / n, centerY: sumY / n,
        meanKinetic: kinetic / n, maxSpeed: Math.sqrt(fastest),
      };
    }

    setBounds(opt.width || 540, opt.height || 360);

    return {
      radius: h, particleRadius: pad, maxParticles, params, pusher,
      x, y, vx, vy, density: rho,
      get count() { return count; },
      get width() { return width; },
      get height() { return height; },
      get springCount() { return springCount; },
      get springA() { return springA; },
      get springB() { return springB; },
      get springRest() { return springRest; },
      get grabbed() { return grabCount; },
      setBounds, addParticle, spawnBlob, clear, step, grab, moveGrab, release, impulse, measure,
      applyPreset(name) { if (PRESETS[name]) Object.assign(params, PRESETS[name]); return params; },
    };
  }

  root.SlimeSim = { PRESETS, createSlimeSim };
})(typeof globalThis !== "undefined" ? globalThis : this);
