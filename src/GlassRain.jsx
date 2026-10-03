import React, { useId, useSyncExternalStore } from "react";
import "./glass-rain.css";

const beads = [
  [6, 23, 4.2, 6.4, 19, -8], [93, 68, 3.2, 5, 24, -17],
  [28, 13, 3.5, 5.5, 22, -4], [79, 39, 5.2, 7.5, 17, -12],
  [48, 86, 3, 4.6, 27, -9], [16, 73, 4.3, 6, 21, -16],
  [67, 18, 3.2, 4.8, 25, -2], [39, 48, 3.4, 5.3, 18, -11],
  [85, 88, 4.1, 6.3, 23, -19],
];
const trails = [
  [12, 16, -8, -2], [72, 23, -17, 1.5], [94, 19, -3, -1],
];
const mist = [
  [4, 67, 1.8], [12, 11, 1.3], [22, 91, 1.7], [31, 65, 1.5],
  [37, 6, 1.3], [45, 31, 1.7], [54, 78, 1.4], [61, 46, 1.5],
  [69, 89, 1.2], [77, 8, 1.8], [84, 60, 1.3], [91, 22, 1.7],
  [96, 90, 1.5], [58, 8, 1.2],
];

function dropOptics(seed, index) {
  let state = (seed + Math.imul(index + 1, 2654435761)) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const lightX = 17 + random() * 65;
  const lightY = 12 + random() * 34;
  const lean = 39 + random() * 22;
  const glint = .13 + random() * .31;
  return {
    "--drop-opacity": (.48 + random() * .37).toFixed(3),
    "--drop-glint": glint.toFixed(3),
    "--drop-refraction": (.025 + random() * .075).toFixed(3),
    "--drop-shadow": (.14 + random() * .18).toFixed(3),
    "--drop-light-x": `${lightX.toFixed(1)}%`,
    "--drop-light-y": `${lightY.toFixed(1)}%`,
    "--drop-caustic-x": `${(96 - lightX).toFixed(1)}%`,
    "--drop-glint-angle": `${(-42 + random() * 88).toFixed(1)}deg`,
    "--drop-light-angle": `${(95 + random() * 155).toFixed(1)}deg`,
    "--drop-highlight-size": `${(17 + random() * 24).toFixed(1)}%`,
    "--drop-shape": `${lean.toFixed(1)}% ${(100 - lean).toFixed(1)}% ${(39 + random() * 18).toFixed(1)}% ${(44 + random() * 16).toFixed(1)}% / ${(54 + random() * 18).toFixed(1)}% ${(52 + random() * 14).toFixed(1)}% ${(35 + random() * 14).toFixed(1)}% ${(31 + random() * 16).toFixed(1)}%`,
  };
}

// All glass surfaces share one visibility/preference subscription.
const subscribers = new Set();
let stopEnvironment = null;
let reducedMedia = null;
let colorsMedia = null;
function environmentSnapshot() {
  if (typeof document === "undefined") return "0000";
  const reduced = reducedMedia || window.matchMedia("(prefers-reduced-motion: reduce)");
  const colors = colorsMedia || window.matchMedia("(forced-colors: active)");
  return `${document.visibilityState === "hidden" ? 0 : 1}${reduced.matches ? 0 : 1}${document.documentElement.dataset.glassMotion === "off" ? 0 : 1}${colors.matches ? 1 : 0}`;
}
function subscribeEnvironment(listener) {
  subscribers.add(listener);
  if (!stopEnvironment) {
    reducedMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    colorsMedia = window.matchMedia("(forced-colors: active)");
    const update = () => subscribers.forEach((notify) => notify());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-glass-motion"] });
    document.addEventListener("visibilitychange", update);
    reducedMedia.addEventListener("change", update);
    colorsMedia.addEventListener("change", update);
    stopEnvironment = () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      reducedMedia.removeEventListener("change", update);
      colorsMedia.removeEventListener("change", update);
      reducedMedia = null;
      colorsMedia = null;
      stopEnvironment = null;
    };
  }
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) stopEnvironment?.();
  };
}
const noSubscription = () => () => {};
const serverSnapshot = () => "0000";

export function useRainMotion(animated = true, active = true) {
  const state = useSyncExternalStore(active ? subscribeEnvironment : noSubscription, environmentSnapshot, serverSnapshot);
  const enabled = !!(active && animated && state[1] === "1" && state[2] === "1" && state[3] === "0");
  return { enabled, visible: state[0] === "1", running: enabled && state[0] === "1", forcedColors: state[3] === "1" };
}

export const rainAmount = (intensity) => typeof intensity === "number" && Number.isFinite(intensity)
  ? Math.min(1, Math.max(0, intensity)) : 0;

// A span is intentional: this surface is also used inside navigation buttons.
export default function GlassRain({ intensity = 0, animated = true, className = "" }) {
  const amount = rainAmount(intensity);
  const motion = useRainMotion(animated, amount > 0);
  const instanceId = useId();
  const seed = [...instanceId].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
  const phase = seed % 103 / 7;
  if (amount === 0) return null;
  return (
    <span className={`glass-rain ${className}`.trim()} aria-hidden="true"
      data-rain-intensity={amount.toFixed(2)} data-animated={motion.enabled ? "true" : "false"}
      data-paused={motion.visible ? "false" : "true"} data-edge-behavior="seam-absorb"
      style={{ "--rain-intensity": amount }}>
      {mist.slice(0, Math.ceil(8 + amount * 6)).map(([left, top, size], index) => <span className="rain-condensation" key={`mist-${index}`}
        style={{ left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px`, opacity: .26 + ((seed + index * 17) % 31) / 100 }} />)}
      {beads.slice(0, Math.ceil(3 + amount * 4)).map(([left, top, width, height, duration, delay], index) => <span className="rain-bead" key={`bead-${index}`}
        data-drop-optics={index % 3 === 0 ? "soft" : index % 3 === 1 ? "clear" : "tonal"}
        style={{ ...dropOptics(seed, index), left: `${left + (phase % 4) - 2}%`, top: `${top + (phase % 7) - 3}%`, "--bead-width": `${Math.max(3.6, width)}px`, "--bead-height": `${Math.max(5.2, height)}px`, animationDuration: `${duration + phase * .17}s`, animationDelay: `${delay - phase}s` }} />)}
      {trails.slice(0, amount > .55 ? 3 : 2).map(([left, duration, delay, sway], index) => (
        <span className="rain-runner-path" key={`trail-${index}`} data-rain-cycle="gather-slide-absorb"
          style={{ ...dropOptics(seed, index + 23), left: `${left - phase % 5}%`, top: `${9 + (index * 7 + phase) % 17}%`,
            "--rain-duration": `${duration + phase * .13}s`, "--rain-delay": `${delay - phase}s`, "--rain-sway": `${sway}px` }}>
          <span className="rain-runner rain-trail"><span className="rain-runner-drop" /></span>
          <span className="rain-edge-pool" />
        </span>
      ))}
    </span>
  );
}
