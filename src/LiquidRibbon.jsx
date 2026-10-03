import { useEffect, useId, useRef } from 'react';

const TAU = Math.PI * 2;
const SAMPLES = 72;
const BANDS = [-1, -.955, -.89, -.74, -.45, -.12, .2, .5, .76, .9, .96, 1];

// A twisted sheet, rather than a stroked curve: each edge has its own depth.
// Projection and lighting are original procedural artwork, with no image assets.
function ribbonGeometry(phase) {
  const rows = [];
  for (let index = 0; index <= SAMPLES; index++) {
    const t = index / SAMPLES;
    const angle = TAU * t - .88;
    const x = 160 + 69 * Math.sin(angle) + 17 * Math.sin(TAU * 2 * t + .3)
      + 11 * Math.sin(phase + TAU * t);
    const y = 8 + t * 397 + 6 * Math.sin(phase - TAU * t);
    const dx = TAU * (69 * Math.cos(angle) + 34 * Math.cos(TAU * 2 * t + .3)
      + 11 * Math.cos(phase + TAU * t));
    const dy = 397 - 6 * TAU * Math.cos(phase - TAU * t);
    const length = Math.hypot(dx, dy);
    const twist = .76 + TAU * 1.04 * t + .3 * Math.sin(phase + TAU * t);
    const width = 45 + 19 * Math.sin(Math.PI * t) + 4 * Math.sin(phase - TAU * t);
    const z = 30 * Math.sin(TAU * t + .55) + 8 * Math.sin(phase);
    rows.push(BANDS.map(u => {
      const depth = z + u * width * Math.sin(twist);
      const scale = 800 / (800 - depth);
      const cross = u * width * Math.cos(twist);
      return [160 + (x - 160 - cross * dy / length) * scale,
        210 + (y - 210 + cross * dx / length) * scale];
    }));
  }
  const point = p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const edge = (band, reverse = false) => {
    const points = rows.map(row => row[band]);
    return (reverse ? points.reverse() : points).map(point).join(' L ');
  };
  return {
    sheet: `M ${edge(0)} L ${edge(BANDS.length - 1, true)} Z`,
    bands: BANDS.slice(1).map((_, index) => `M ${edge(index)} L ${edge(index + 1, true)} Z`),
    edges: [0, BANDS.length - 1].map(index => `M ${edge(index)}`),
    seams: [2, 8].map(index => `M ${edge(index)}`),
    glints: [13, 34, 58].map((row, index) => rows[row][index % 2 ? BANDS.length - 1 : 0]),
  };
}

const STILL = ribbonGeometry(.7);
const OPACITIES = [.94, .47, .19, .11, .055, .045, .08, .13, .27, .54, .94];

export default function LiquidRibbon({ night = false, className = '', animated = true }) {
  const svgRef = useRef(null);
  const id = `liquid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const paint = name => `url(#${id}-${name})`;

  useEffect(() => {
    const svg = svgRef.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sheet = svg.querySelector('[data-sheet]');
    const bands = svg.querySelectorAll('[data-band]');
    const edges = svg.querySelectorAll('[data-edge]');
    const seams = svg.querySelectorAll('[data-seam]');
    const glints = svg.querySelectorAll('[data-glint]');
    let frame = 0;
    let elapsed = 0;
    let last = null;
    let lastPaint = -Infinity;
    const draw = phase => {
      const shape = ribbonGeometry(phase);
      sheet.setAttribute('d', shape.sheet);
      bands.forEach((node, index) => node.setAttribute('d', shape.bands[index]));
      edges.forEach(node => node.setAttribute('d', shape.edges[Number(node.dataset.edge)]));
      seams.forEach((node, index) => node.setAttribute('d', shape.seams[index]));
      glints.forEach((node, index) => {
        const [x, y] = shape.glints[index];
        node.setAttribute('transform', `translate(${x} ${y})`);
        node.setAttribute('opacity', String(.28 + .52 * Math.pow((1 + Math.sin(phase + index * 2)) / 2, 3)));
      });
    };
    const tick = now => {
      if (last !== null) elapsed += Math.min(now - last, 80);
      last = now;
      // 30 fps is ample for the 18-second material movement and saves idle CPU.
      if (now - lastPaint >= 32) {
        draw(.7 + elapsed / 18000 * TAU);
        lastPaint = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      last = null;
      if (motion.matches || !animated) draw(.7);
      else if (!document.hidden) frame = requestAnimationFrame(tick);
      svg.dataset.motion = motion.matches || !animated ? 'still' : document.hidden ? 'paused' : 'running';
    };
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [animated]);

  const spectrum = night
    ? ['#f4fcff', '#89edff', '#6878ff', '#d19cff', '#fbcbf3', '#8be9e5', '#f4fcff']
    : ['#fffae6', '#efd29c', '#a6e4e6', '#81bac8', '#e7bce4', '#f5d69f', '#fffbed'];

  return (
    <svg ref={svgRef} className={`liquid-ribbon ${className}`} viewBox="0 0 320 420"
      fill="none" aria-hidden="true" focusable="false" data-renderer="projected-glass-sheet"
      style={{ pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${id}-body`} x1="56" y1="12" x2="248" y2="408" gradientUnits="userSpaceOnUse">
          <stop stopColor={night ? '#add8f7' : '#fff3b9'} stopOpacity=".10" />
          <stop offset=".19" stopColor={night ? '#577aad' : '#9cb4ae'} stopOpacity=".05" />
          <stop offset=".37" stopColor={night ? '#aaa6e0' : '#ffffff'} stopOpacity=".19" />
          <stop offset=".55" stopColor={night ? '#1d2c64' : '#91aeb5'} stopOpacity=".03" />
          <stop offset=".73" stopColor={night ? '#a4dfff' : '#fff9dc'} stopOpacity=".18" />
          <stop offset="1" stopColor={night ? '#8e95f3' : '#e4b876'} stopOpacity=".07" />
        </linearGradient>
        <linearGradient id={`${id}-spectrum`} x1="35" y1="-10" x2="252" y2="428" gradientUnits="userSpaceOnUse">
          {spectrum.map((color, index) => <stop key={index} offset={index / (spectrum.length - 1)} stopColor={color} />)}
        </linearGradient>
        <linearGradient id={`${id}-light`} x1="276" y1="5" x2="34" y2="415" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".98" />
          <stop offset=".14" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".3" stopColor="#fff" stopOpacity=".85" />
          <stop offset=".44" stopColor="#fff" stopOpacity=".06" />
          <stop offset=".66" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".8" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor="#fff" stopOpacity=".9" />
        </linearGradient>
        <filter id={`${id}-bloom`} x="-50%" y="-30%" width="200%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={night ? 2.3 : 1.5} />
        </filter>
      </defs>
      <g className="liquid-ribbon__bloom" opacity={night ? .48 : .19} filter={paint('bloom')}>
        {STILL.edges.map((d, index) => <path key={index} data-edge={index} d={d} stroke={paint('spectrum')} strokeWidth="4.4" />)}
      </g>
      <path data-sheet d={STILL.sheet} fill={paint('body')} />
      <g className="liquid-ribbon__refraction">
        {STILL.bands.map((d, index) => <path key={index} data-band d={d}
          fill={paint('spectrum')} opacity={OPACITIES[index] * (night ? .64 : .53)} />)}
      </g>
      {STILL.edges.map((d, index) => <g key={index}>
        <path data-edge={index} d={d} stroke={night ? '#061426' : '#71837d'} strokeOpacity={night ? .72 : .18} strokeWidth="2.7" />
        <path data-edge={index} d={d} stroke={paint('spectrum')} strokeWidth="1.8" strokeOpacity={night ? .82 : .67} />
        <path data-edge={index} d={d} stroke={paint('light')} strokeWidth=".75" />
      </g>)}
      {STILL.seams.map((d, index) => <path key={index} data-seam d={d}
        stroke={paint('light')} strokeWidth={index ? '.5' : '.8'} opacity={index ? .36 : .5} />)}
      {STILL.glints.map(([x, y], index) => <g key={index} data-glint transform={`translate(${x} ${y})`} opacity=".55">
        <circle r="3.7" fill="#fff" opacity=".14" filter={paint('bloom')} />
        <path d="M-4.5 0H4.5 M0-4.5V4.5" stroke="#fff" strokeWidth=".65" />
        <circle r="1.1" fill="#fff" />
      </g>)}
    </svg>
  );
}
