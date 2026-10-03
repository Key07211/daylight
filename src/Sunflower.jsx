import { useId, useSyncExternalStore } from 'react';
import { useRainMotion } from './GlassRain.jsx';
import './sunflower-rain.css';

const weatherListeners = new Set();
let weatherObserver;
const noSubscription = () => () => {};
const drySnapshot = () => 'day|clear|0';
function weatherSnapshot() {
  if (typeof document === 'undefined') return drySnapshot();
  const { theme = 'day', weather = 'clear' } = document.documentElement.dataset;
  const wet = weather === 'rain' || weather === 'storm';
  const field = document.querySelector('.rain-field[data-rain-intensity]');
  const measured = Number(field?.dataset.rainIntensity);
  const amount = wet ? (field && Number.isFinite(measured) ? Math.min(1, Math.max(0, measured)) : weather === 'storm' ? .9 : .55) : 0;
  return `${theme}|${weather}|${amount}`;
}
function subscribeWeather(listener) {
  weatherListeners.add(listener);
  if (!weatherObserver) {
    weatherObserver = new MutationObserver(() => weatherListeners.forEach(notify => notify()));
    // The weather controller owns html's condition; RainField publishes its precise amount.
    weatherObserver.observe(document.documentElement, {
      attributes: true, subtree: true, attributeFilter: ['data-weather', 'data-theme', 'data-rain-intensity'],
    });
  }
  return () => {
    weatherListeners.delete(listener);
    if (!weatherListeners.size) { weatherObserver?.disconnect(); weatherObserver = null; }
  };
}

function RainContact({ x, y, side }) {
  return <g className={`sunflower-rain-contact sunflower-rain-contact-${side}`} transform={`translate(${x} ${y})`}>
    <g className="sunflower-impact-drop">
      <path d="M.7-7 0-1" stroke="#7096A0" strokeOpacity=".55" strokeWidth="1.05" strokeLinecap="round" />
      <ellipse cy="-1.8" rx="1.65" ry="2.5" fill="#D7EAE9" fillOpacity=".8" stroke="#74969D" strokeOpacity=".55" strokeWidth=".65" />
      <path d="M-.55-3.2-.8-1.8" stroke="#FFFFFF" strokeOpacity=".9" strokeWidth=".65" strokeLinecap="round" />
    </g>
    <g className="sunflower-impact-splash" fill="none" strokeLinecap="round">
      <ellipse cy="1" rx="4" ry="1.1" stroke="#F0FAF7" strokeWidth="1" />
      <path d="M-3 0-5.5-2.5M3.5-.5 5.5-3.2" stroke="#789CA1" strokeOpacity=".8" strokeWidth=".8" />
    </g>
  </g>;
}

/** Original, decorative SVG. The compact form omits the stem for small brand marks. */
export default function Sunflower({ className = '', compact = false, style, ...props }) {
  const id = `sunflower-${useId().replace(/:/g, '')}`;
  const [theme, , amountText] = useSyncExternalStore(compact ? noSubscription : subscribeWeather, weatherSnapshot, drySnapshot).split('|');
  const amount = compact || theme === 'night' ? 0 : Number(amountText);
  const motion = useRainMotion(true, !compact);
  const seed = [...id].reduce((value, letter) => (Math.imul(value, 31) + letter.charCodeAt(0)) >>> 0, 7);
  const small = className.includes('sidebar-sunflower-small');
  const cycle = (small ? 12.2 : 9.8) + (seed % 19) / 10 - amount * 1.2;
  const paint = (name) => `url(#${id}-${name})`;
  const petals = Array.from({ length: 18 }, (_, index) => index * 20);
  const seeds = Array.from({ length: compact ? 21 : 55 }, (_, index) => {
    const angle = index * 2.399963;
    const radius = Math.sqrt(index / (compact ? 21 : 55)) * 20;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });

  return (
    <svg
      className={`sunflower-illustration ${className}`.trim()}
      viewBox={compact ? '10 2 160 160' : '0 0 180 232'}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      data-rain-reactive={!compact && amount > 0 ? 'true' : 'false'}
      data-rain-intensity={amount.toFixed(2)}
      data-animated={motion.enabled ? 'true' : 'false'}
      data-paused={motion.visible ? 'false' : 'true'}
      data-compact={compact ? 'true' : 'false'}
      style={{ '--sunflower-cycle': `${cycle.toFixed(2)}s`, '--sunflower-phase': `${-((seed % 37) / 10).toFixed(2)}s`, '--sunflower-impact': .58 + amount * .42, ...style }}
      {...props}
    >
      <defs>
        <linearGradient id={`${id}-petal`} x1="-9" y1="-72" x2="11" y2="-20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFF4B5" stopOpacity=".98" />
          <stop offset=".35" stopColor="#FFD66E" stopOpacity=".93" />
          <stop offset="1" stopColor="#D98B21" stopOpacity=".9" />
        </linearGradient>
        <linearGradient id={`${id}-inner`} x1="-8" y1="-59" x2="10" y2="-18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFECAF" />
          <stop offset=".48" stopColor="#F2B945" />
          <stop offset="1" stopColor="#C87E1D" />
        </linearGradient>
        <radialGradient id={`${id}-heart`} cx=".32" cy=".26" r=".85">
          <stop stopColor="#987143" />
          <stop offset=".65" stopColor="#634727" />
          <stop offset="1" stopColor="#493621" />
        </radialGradient>
        <linearGradient id={`${id}-leaf`} x1="56" y1="149" x2="112" y2="217" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ADB974" stopOpacity=".92" />
          <stop offset="1" stopColor="#70814A" stopOpacity=".7" />
        </linearGradient>
      </defs>

      <g className="sunflower-stem-response">
      {!compact && (
        <g>
          <path className="sunflower-stem" d="M90 104C83 145 104 179 91 229" stroke="#83935B" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M94 180C80 181 57 167 54 145C76 143 93 157 94 180Z" fill={paint('leaf')} />
          <path d="M95 205C115 201 130 182 126 162C104 167 94 183 95 205Z" fill={paint('leaf')} />
          <path d="M61 151C71 163 81 172 94 180M95 205C105 189 114 178 122 168" stroke="#F4F1BD" strokeOpacity=".46" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      )}

      <g transform="translate(90 82)">
      <g className="sunflower-head-response">
        <g opacity=".83">
          {petals.map((angle) => (
            <g key={angle} transform={`rotate(${angle})`}>
            <g className={`sunflower-petal-response ${angle === 20 || angle === 40 ? 'sunflower-petal-right' : angle === 320 || angle === 340 ? 'sunflower-petal-left' : ''}`}>
            <path
              d="M-4-23C-12-35-17-58-3-73C9-67 17-40 5-23C2-20-1-20-4-23Z"
              fill={paint('petal')}
              stroke="#FFF5C7"
              strokeOpacity=".55"
              strokeWidth=".6"
            />
            </g>
            </g>
          ))}
        </g>
        {petals.map((angle) => (
          <g key={angle} transform={`rotate(${angle + 10})`}>
            <g className={`sunflower-petal-response ${angle === 20 ? 'sunflower-petal-right' : angle === 320 ? 'sunflower-petal-left' : ''}`}>
            <path d="M-5-20C-13-31-12-50-1-60C11-50 14-31 5-20Z" fill={paint('inner')} stroke="#FFE9A0" strokeOpacity=".7" strokeWidth=".65" />
            <path d="M-1-55C-4-47-3-37-1-30" stroke="#FFF8D7" strokeOpacity=".55" strokeWidth=".8" strokeLinecap="round" />
            </g>
          </g>
        ))}
        <circle r="27" fill="#DDA846" />
        <circle r="24" fill={paint('heart')} stroke="#FFD987" strokeOpacity=".45" />
        <g fill="#D8AF67" fillOpacity=".65">
          {seeds.map((seed, index) => (
            <ellipse key={index} cx={seed.x} cy={seed.y} rx={compact ? 1.45 : 1.05} ry={compact ? 1.15 : .85} transform={`rotate(${index * 137.508} ${seed.x} ${seed.y})`} />
          ))}
        </g>
        <path d="M-19-12A23 23 0 0 1 10-20" stroke="#FFF1C1" strokeOpacity=".4" strokeWidth="1.1" strokeLinecap="round" />
      </g>
      </g>
      {!compact && <g className="sunflower-rain-contacts" data-impact-sequence="drop-contact-recoil">
        <RainContact x={114} y={16} side="right" />
        <RainContact x={44} y={26} side="left" />
      </g>}
      </g>
    </svg>
  );
}

export function SunflowerMark(props) {
  return <Sunflower {...props} compact />;
}
