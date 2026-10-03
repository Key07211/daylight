import React, { useEffect, useRef } from "react";
import { rainAmount, useRainMotion } from "./GlassRain.jsx";
import { createRainSplash, sampleRainSplash } from "./rain-physics.js";
import "./rain-field.css";

const FRAME_MS = 1000 / 30;

// Bounded canvas rain behind the UI; no timer runs while hidden or disabled.
export default function RainField({ intensity = 0, animated = true, night = false, storm = false }) {
  const amount = rainAmount(intensity);
  const motion = useRainMotion(animated, amount > 0);
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || amount === 0 || motion.forcedColors) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    let timer = null, disposed = false, width = 0, height = 0;
    let lastTime = performance.now(), drops = [], splashes = [], seed = 39173;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const resetDrop = (drop, initial = false) => {
      drop.x = random() * (width + 160) - 35;
      drop.y = initial ? random() * height : -35 - random() * 70;
      drop.floor = height * (.82 + random() * .17);
      drop.length = (10 + random() * 14) * (.7 + drop.depth * .45);
    };
    const draw = (delta = 0) => {
      context.clearRect(0, 0, width, height);
      const wind = storm ? -.26 : -.17;
      for (const drop of drops) {
        if (delta > 0) {
          const distance = (155 + drop.depth * 105 + amount * 64) * delta;
          drop.y += distance;
          drop.x += distance * wind;
          if (drop.y > drop.floor) {
            if (drop.depth > 0 && splashes.length < 14 && random() > .43) {
              splashes.push(createRainSplash(drop.x, drop.floor, random));
            }
            resetDrop(drop);
          } else if (drop.x < -50) resetDrop(drop);
        }
      }
      // Three batches provide depth without expensive per-particle gradients.
      for (let depth = 0; depth < 3; depth += 1) {
        context.beginPath();
        for (const drop of drops) {
          if (drop.depth !== depth) continue;
          context.moveTo(drop.x, drop.y);
          context.lineTo(drop.x + wind * drop.length, drop.y + drop.length);
        }
        context.lineWidth = .6 + depth * .28;
        context.lineCap = "round";
        const alpha = (.1 + depth * .055) * (.58 + amount * .42);
        context.strokeStyle = night ? `rgba(169,204,239,${alpha})` : `rgba(67,111,130,${alpha})`;
        context.stroke();
      }
      splashes = splashes.filter((splash) => splash.age < splash.life);
      for (const splash of splashes) {
        splash.age += delta;
        const state = sampleRainSplash(splash);
        const color = night ? "190,218,248" : "70,113,131";
        // A full elliptical ring and a softer second ring settle onto the floor.
        context.beginPath();
        context.ellipse(splash.x, splash.y, state.radius, state.radius * .2, 0, 0, Math.PI * 2);
        context.lineWidth = .8;
        context.strokeStyle = `rgba(${color},${.36 * state.ringOpacity})`;
        context.stroke();
        if (splash.age > .1) {
          context.beginPath();
          context.ellipse(splash.x, splash.y, state.radius * .65, state.radius * .12, 0, 0, Math.PI * 2);
          context.lineWidth = .55;
          context.strokeStyle = `rgba(${color},${.19 * state.ringOpacity})`;
          context.stroke();
        }
        // The crown is short-lived; droplets continue along independent arcs.
        if (state.crownOpacity > 0) {
          const r = state.crownRadius, h = 2.2 + state.crownOpacity * 3.2;
          context.beginPath();
          context.moveTo(splash.x - r, splash.y);
          context.quadraticCurveTo(splash.x - r * .9, splash.y - h, splash.x - r * .55, splash.y - h * .38);
          context.quadraticCurveTo(splash.x - r * .32, splash.y - h * 1.25, splash.x, splash.y - h * .3);
          context.quadraticCurveTo(splash.x + r * .38, splash.y - h * 1.3, splash.x + r * .6, splash.y - h * .38);
          context.quadraticCurveTo(splash.x + r * .94, splash.y - h, splash.x + r, splash.y);
          context.lineWidth = .95;
          context.strokeStyle = `rgba(${color},${.47 * state.crownOpacity})`;
          context.stroke();
        }
        for (const droplet of state.droplets) {
          context.beginPath();
          context.ellipse(droplet.x, droplet.y, droplet.radius * .72, droplet.radius * 1.22, -.2, 0, Math.PI * 2);
          context.fillStyle = `rgba(${color},${.55 * droplet.opacity})`;
          context.fill();
        }
      }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const count = Math.min(90, Math.max(28, Math.round(width * height / 17500 * (.55 + amount * .85) * (storm ? 1.15 : 1))));
      drops = Array.from({ length: count }, (_, index) => {
        const drop = { depth: index % 3 };
        resetDrop(drop, true);
        return drop;
      });
      splashes = [];
      if (motion.visible) draw();
    };
    const tick = () => {
      if (disposed || !motion.running) return;
      const now = performance.now();
      const delta = Math.min(.065, (now - lastTime) / 1000);
      lastTime = now;
      draw(delta);
      timer = window.setTimeout(tick, FRAME_MS);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (motion.running) timer = window.setTimeout(tick, FRAME_MS);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      observer.disconnect();
      context.clearRect(0, 0, width, height);
    };
  }, [amount, night, storm, motion.running, motion.visible, motion.forcedColors]);
  if (amount === 0) return null;
  return (
    <div className="rain-field" aria-hidden="true" data-night={night ? "true" : "false"}
      data-storm={storm ? "true" : "false"} data-rain-intensity={amount.toFixed(2)}
      data-animated={motion.enabled ? "true" : "false"} data-paused={motion.visible ? "false" : "true"}
      style={{ "--field-rain-intensity": amount }}>
      <canvas ref={canvasRef} className="rain-field-canvas" data-splash-style="crown-droplets-rings" />
      <span className="rain-field-reflection" />
    </div>
  );
}
