import './startup-rain.css';

// Fixed, asymmetric optics keep the rain calm and reproducible between renders.
const droplets = [
  [7, 17, 38, 23, 1.31, 27, 19, .27, .085, 180, 46],
  [15, 44, 65, 16, 1.46, 68, 26, .19, .035, 410, 55],
  [22, 66, 82, 28, 1.23, 37, 17, .30, .068, 90, 42],
  [4, 72, 89, 14, 1.39, 75, 38, .14, .029, 280, 59],
  [12, 8, 26, 19, 1.18, 48, 32, .21, .049, 520, 48],
  [91, 23, 44, 30, 1.30, 73, 21, .23, .044, 240, 53],
  [79, 48, 71, 18, 1.42, 24, 33, .16, .031, 60, 44],
  [85, 76, 88, 25, 1.21, 58, 15, .32, .074, 350, 57],
  [97, 57, 78, 15, 1.48, 34, 41, .17, .037, 160, 41],
  [87, 9, 29, 21, 1.27, 79, 28, .22, .056, 460, 51],
];

const streaks = [
  [3, 8, 67, 700, -260], [10, 37, 43, 830, -570], [18, 14, 78, 930, -100],
  [25, 70, 51, 740, -430], [5, 54, 46, 890, -180], [20, 87, 63, 1050, -710],
  [77, 30, 57, 920, -390], [83, 6, 81, 790, -610], [94, 74, 44, 870, -230],
  [98, 23, 68, 990, -450], [88, 51, 54, 710, -60], [80, 91, 71, 1100, -840],
];

/** Decorative rain window. StartupScene owns lifecycle, timing and visibility. */
export default function StartupRain({ night = false, motion = true, phase = 'enter', intensity = .65 }) {
  const amount = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
  if (!amount) return null;
  const stage = ['pending', 'enter', 'hold', 'exit'].includes(phase) ? phase : 'enter';
  const count = amount > .7 ? 10 : amount > .35 ? 8 : 6;
  // Interleave the two sides so lighter rain retains balanced composition.
  const selected = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9].slice(0, count);
  return <div className="startup-rain" aria-hidden="true" data-intensity={amount.toFixed(2)}
    data-phase={stage} data-motion={motion ? 'on' : 'off'} data-night={night ? 'true' : 'false'}
    data-edge-behavior="seam-absorb" style={{ '--startup-rain-intensity': amount }}>
    <div className="startup-rain-reflection" />
    <div className="startup-rain-streaks">
      {streaks.slice(0, amount > .5 ? 12 : 8).map(([x, y, length, duration, delay], index) =>
        <i className="startup-rain-streak" key={index} style={{ left: `${x}%`, top: `${y}%`,
          '--streak-length': `${length}px`, '--streak-duration': `${duration}ms`, '--streak-delay': `${delay}ms` }} />)}
    </div>
    {selected.map((index) => {
      const [x, start, end, size, aspect, lightX, lightY, glint, tint, delay, shape] = droplets[index];
      return <div className="startup-rain-lane" key={index} data-optics={index % 3 === 0 ? 'soft' : index % 3 === 1 ? 'clear' : 'refracted'}
        style={{ left: `${x}%`, '--drop-width': `${size}px`, '--drop-height': `${(size * aspect).toFixed(1)}px`,
          '--drop-start': `${start}%`, '--drop-end': `${end}%`, '--drop-delay': `${delay}ms`,
          '--drop-light-x': `${lightX}%`, '--drop-light-y': `${lightY}%`, '--drop-caustic-x': `${100 - lightX}%`,
          '--drop-glint': glint, '--drop-tint': tint, '--drop-opacity': .56 + index % 4 * .105,
          '--drop-light-angle': `${85 + lightX * 1.7}deg`, '--drop-lean': `${(lightX - 50) * .45}deg`,
          '--drop-sway': `${index % 2 ? -3 : 2}px`,
          '--drop-shape': `${shape}% ${100 - shape}% ${57 - index}% ${43 + index}% / ${62 + index}% ${58 - index}% ${42 + index}% ${38 - index}%` }}>
        <span className="startup-rain-drop-track">
          <span className="startup-rain-trace" />
          <span className="startup-rain-lens"><span className="startup-rain-meniscus" /></span>
        </span>
        <span className="startup-rain-seam-pool" />
      </div>;
    })}
    <div className="startup-rain-floor">
      {[13, 25, 74, 91].map((left, index) => <span className="startup-rain-ripple" key={left}
        style={{ left: `${left}%`, '--ripple-delay': `${360 + index * 440}ms`, '--ripple-size': `${31 + index % 3 * 13}px` }} />)}
    </div>
  </div>;
}
