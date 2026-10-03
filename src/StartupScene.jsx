import { useId, useRef } from 'react';
import { deriveAtmosphere } from './weather-model.js';
import StartupRain from './StartupRain.jsx';
import './startup-scene.css';

const starShape = 'M0-7 1.8-1.8 7 0 1.8 1.8 0 7-1.8 1.8-7 0-1.8-1.8Z';
const lensShape = 'M299 48C351 45 384 78 386 135C389 193 361 230 303 232C248 234 215 207 214 146C212 90 239 52 299 48Z';
const cloudShape = 'M2 35C-1 26 7 20 15 22C15 8 35 4 42 15C51 8 64 13 66 22C81 18 90 27 86 37L2 37Z';
const stars = [[78,150,1],[113,228,1.6],[157,83,1],[198,213,1.3],[216,42,1.4],[254,267,.9],
  [348,37,1],[378,253,1.5],[413,97,1.1],[445,227,1],[492,96,1.5],[525,169,1.1],[171,177,.8],[392,179,.8],[467,56,.8]];
const hangingStars = [[130,7,143,.88],[432,0,95,.66],[180,13,71,.58],[487,16,163,.94],[375,0,46,.5]];
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

function sceneAtmosphere(atmosphere) {
  const source = atmosphere || deriveAtmosphere();
  const progress = Number.isFinite(source.solarProgress) ? source.solarProgress : (source.sunX - 10) / 80;
  const solarProgress = clamp(Number.isFinite(progress) ? progress : .5);
  const period = source.phase === 'night' ? (source.minutes < 720 ? 'predawn' : 'afterdark') : source.phase;
  return { ...source, solarProgress, period: period || 'noon', rainIntensity: clamp(Number(source.rainIntensity) || 0) };
}

function SunflowerDetail({ paint, x, y, scale, angle, index }) {
  return <g className="startup-sunflower" transform={`translate(${x} ${y}) scale(${scale})`}
    data-light-angle={angle.toFixed(2)} style={{ '--flower-angle': `${angle}deg`, '--flower-delay': `${index * -.65}s`, '--flower-duration': `${4.8 + index * .6}s` }}>
    <g className="startup-flower-sway">
      <path d="M0 10C-11 38 8 63-2 99" stroke="#8C9B66" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M-2 70C-24 67-34 50-32 39C-15 40-3 54-2 70Z" fill="#A6B67D" fillOpacity=".76" />
      <path d="M1 84C20 83 29 67 28 56C14 57 3 70 1 84Z" fill="#93A872" fillOpacity=".7" />
      <g className="startup-flower-follow"><g className="startup-flower-head">
        {Array.from({ length: 16 }, (_, index) => <path key={index} transform={`rotate(${index * 22.5})`}
          d="M-4-12C-12-23-10-38-1-45C9-39 13-24 5-12Z" fill={paint('petal')} stroke="#FFF4C0" strokeWidth=".7" />)}
        <circle r="15.5" fill={paint('heart')} stroke="#E2B462" strokeWidth="2" />
        {Array.from({ length: 17 }, (_, index) => {
          const radius = Math.sqrt(index / 17) * 11, angle = index * 2.399963;
          return <circle key={index} cx={Math.cos(angle) * radius} cy={Math.sin(angle) * radius} r=".9" fill="#E3BD7D" opacity=".64" />;
        })}
      </g></g>
    </g>
  </g>;
}

function Galaxy({ paint, rainy }) {
  return <g className="startup-galaxy">
    <g className="startup-galaxy-bed">
      <path d="M106 328C171 318 187 283 293 296S408 344 501 283" stroke={paint('galaxy-color')} strokeWidth="25" opacity=".22" filter={paint('galaxy')} />
      <path d="M114 326C186 311 196 287 293 299S419 340 490 290" stroke={paint('galaxy-color')} strokeWidth="1" opacity=".45" />
      <path d="M136 339C216 315 231 307 300 314S421 328 467 309" stroke={paint('galaxy-color')} strokeWidth=".6" opacity=".32" />
      {Array.from({ length: 37 }, (_, index) => {
        const x = 114 + index * 10.2, y = 310 + Math.sin(index * .21) * 16 + Math.sin(index * 2.41) * 8;
        return <circle key={index} className="startup-star" cx={x} cy={y} r={index % 7 === 0 ? 1.8 : .65 + (index % 3) * .2}
          fill={index % 4 === 0 ? '#C7BBE8' : '#DBEEFA'} style={{ '--star-delay': `${index * -.31}s`, '--star-duration': `${3 + index % 4}s` }} />;
      })}
    </g>
    {[[160,294,.8],[251,325,.6],[382,287,.8],[454,325,.62]].map(([x,y,scale], index) =>
      <g key={x} transform={`translate(${x} ${y}) scale(${scale})`}>
        <g className="startup-music-note" style={{ '--note-delay': `${.65 + index * .2}s`, '--note-float-delay': `${index * -.8}s`, '--ripple-delay': `${1.45 + index * .18}s` }}>
          <g className="startup-note-symbol">
            {index % 2 ? <><path d="M-5 9V-13L11-17V5M-5-7 11-11" stroke="#C8DCEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <ellipse cx="-8" cy="10" rx="4" ry="2.7" transform="rotate(-20 -8 10)" fill="#C8DCEB" /><ellipse cx="8" cy="6" rx="4" ry="2.7" transform="rotate(-20 8 6)" fill="#C8DCEB" /></>
              : <><path d="M2 8V-16C3-11 15-12 12-3" stroke="#C8DCEB" strokeWidth="1.5" strokeLinecap="round" /><ellipse cx="-1" cy="9" rx="4.5" ry="3" transform="rotate(-20 -1 9)" fill="#C8DCEB" /></>}
          </g>
          {rainy && <g className="startup-note-ripple"><ellipse cy="12" rx="15" ry="3.5" stroke="#B9D9E9" strokeWidth=".85" /><ellipse cy="12" rx="23" ry="5.5" stroke="#B9D9E9" strokeWidth=".6" opacity=".45" /></g>}
        </g>
      </g>)}
  </g>;
}

/** Presentation only. The app owns timing, persistence, focus and dismissal. */
export default function StartupScene({ theme = 'day', lang = 'zh', motion = true, phase = 'enter', atmosphere, onSkip }) {
  const uid = `startup-${useId().replace(/:/g, '')}`;
  const actualPhase = ['pending', 'enter', 'hold', 'exit'].includes(phase) ? phase : 'enter';
  // Freeze the destination when the introduction starts; a weather refresh or
  // enter → hold must not move the destination or replay an animation.
  const captured = useRef(null);
  const started = useRef(false);
  if (!started.current) {
    captured.current = sceneAtmosphere(atmosphere);
    if (actualPhase !== 'pending') started.current = true;
  }
  const sky = captured.current;
  const night = theme === 'night', english = lang === 'en', rainy = sky.rainIntensity > 0;
  const paint = name => `url(#${uid}-${name})`;
  const themeName = english ? (night ? 'Nightlight' : 'Daylight') : (night ? '夜光清单' : '日光清单');
  const skipLabel = english ? 'Skip intro' : '跳过动画';
  const sunAngle = sky.solarProgress * 180 - 90, flowerAngle = sky.solarProgress * 42 - 21;
  return <section className="startup-scene" data-theme={night ? 'night' : 'day'} data-phase={actualPhase}
    data-motion={motion ? 'on' : 'off'} data-weather={rainy ? 'rain' : sky.condition} data-rain-intensity={sky.rainIntensity}
    data-time={sky.timeLabel} data-timezone={sky.timezone} data-solar-progress={sky.solarProgress.toFixed(5)} data-day-period={sky.period}
    data-sun-visible={sky.sunVisible ? 'true' : 'false'} data-testid="startup-scene" role="dialog" aria-modal="true"
    aria-label={english ? 'Daylight introduction' : 'Daylight 开场'}
    style={{ '--solar-angle': `${sunAngle}deg`, '--solar-x': `${50 + Math.sin(sunAngle * Math.PI / 180) * 31}%`, '--cloud-opacity': .34 + clamp((sky.cloudCover || 0) / 100) * .5 }}>
    <div className="startup-background" aria-hidden="true"><span /><span /><span /></div>
    {rainy && <StartupRain night={night} motion={motion} phase={actualPhase} intensity={sky.rainIntensity} />}
    <div className="startup-content" aria-hidden={actualPhase === 'pending' ? 'true' : undefined}>
      <svg className="startup-artwork" viewBox="0 0 600 380" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={`${uid}-halo`}><stop stopColor={night ? '#9BADEB' : '#F3D08F'} stopOpacity={night ? '.23' : '.4'} /><stop offset=".52" stopColor={night ? '#7F9BDD' : '#F7DB9E'} stopOpacity={night ? '.1' : '.16'} /><stop offset="1" stopColor={night ? '#8198D5' : '#F7E4B6'} stopOpacity="0" /></radialGradient>
          <linearGradient id={`${uid}-glass`} x1="236" y1="65" x2="366" y2="227" gradientUnits="userSpaceOnUse"><stop stopColor={night ? '#CAE6FF' : '#FFFFFF'} stopOpacity={night ? '.16' : '.73'} /><stop offset=".32" stopColor={night ? '#A1BADF' : '#FFFFFF'} stopOpacity={night ? '.035' : '.19'} /><stop offset=".67" stopColor={night ? '#6986B4' : '#D8E2D5'} stopOpacity={night ? '.1' : '.19'} /><stop offset="1" stopColor={night ? '#C3DAF6' : '#FFF7D9'} stopOpacity={night ? '.22' : '.54'} /></linearGradient>
          <linearGradient id={`${uid}-rim`} x1="225" y1="63" x2="380" y2="217" gradientUnits="userSpaceOnUse"><stop stopColor={night ? '#E1F0FF' : '#FFFFFF'} stopOpacity=".9" /><stop offset=".36" stopColor={night ? '#90ADDC' : '#C5D7D9'} stopOpacity=".28" /><stop offset=".71" stopColor={night ? '#C5C4F0' : '#F0D8AD'} stopOpacity=".57" /><stop offset="1" stopColor={night ? '#C3E9F4' : '#FFFFFF'} stopOpacity=".92" /></linearGradient>
          <linearGradient id={`${uid}-orbit`}><stop stopColor={night ? '#A9CCF7' : '#DBE6E1'} stopOpacity="0" /><stop offset=".2" stopColor={night ? '#B8D1F5' : '#C7D2C8'} stopOpacity=".67" /><stop offset=".59" stopColor={night ? '#C6BDE9' : '#DDBE83'} stopOpacity=".42" /><stop offset="1" stopColor={night ? '#E2E8FB' : '#E7C79D'} stopOpacity="0" /></linearGradient>
          <radialGradient id={`${uid}-sun`} cx=".35" cy=".26" r=".8"><stop stopColor="var(--startup-sun-core)" /><stop offset=".55" stopColor="var(--startup-sun-mid)" /><stop offset="1" stopColor="var(--startup-sun-edge)" /></radialGradient>
          <radialGradient id={`${uid}-moon`} cx=".28" cy=".22" r=".86"><stop stopColor="#FAFCFF" /><stop offset=".5" stopColor="#D6E5F1" /><stop offset="1" stopColor="#A6BDD5" /></radialGradient>
          <linearGradient id={`${uid}-cloud`} x1="0" y1="0" x2="0" y2="46" gradientUnits="userSpaceOnUse"><stop stopColor={rainy ? '#EDF2F0' : '#FFFFFD'} stopOpacity=".96" /><stop offset="1" stopColor={rainy ? '#A9BEC0' : '#DBE6E2'} stopOpacity={rainy ? '.7' : '.18'} /></linearGradient>
          <linearGradient id={`${uid}-petal`} x1="-5" y1="-42" x2="4" y2="-11" gradientUnits="userSpaceOnUse"><stop stopColor="#FBEAB0" /><stop offset=".55" stopColor="#EBC673" /><stop offset="1" stopColor="#CF9B43" /></linearGradient>
          <radialGradient id={`${uid}-heart`}><stop stopColor="#A78759" /><stop offset="1" stopColor="#71583B" /></radialGradient>
          <linearGradient id={`${uid}-meadow`}><stop stopColor="#B3C39B" stopOpacity="0" /><stop offset=".4" stopColor="#A5BA8A" stopOpacity=".28" /><stop offset=".7" stopColor="#D7CD9A" stopOpacity=".22" /><stop offset="1" stopColor="#BECBA9" stopOpacity="0" /></linearGradient>
          <linearGradient id={`${uid}-galaxy-color`}><stop stopColor="#8BCBD5" stopOpacity="0" /><stop offset=".23" stopColor="#A5D1E6" /><stop offset=".63" stopColor="#BDB0E4" /><stop offset="1" stopColor="#9ABFE5" stopOpacity="0" /></linearGradient>
          <filter id={`${uid}-glow`} x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="12" /></filter>
          <filter id={`${uid}-galaxy`} x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="7" /></filter>
          <mask id={`${uid}-crescent`} maskUnits="userSpaceOnUse" x="250" y="83" width="103" height="110"><circle cx="301" cy="137" r="43" fill="white" /><circle cx="320" cy="119" r="39" fill="black" /></mask>
        </defs>

        <circle className="startup-halo" cx="300" cy="168" r="179" fill={paint('halo')} />
        {night && <g className="startup-sky-stars">{stars.map(([x,y,r], index) => <circle className="startup-star" key={index} cx={x} cy={y} r={r} fill="#D9E8FA" style={{ '--star-delay': `${index * -.67}s`, '--star-duration': `${4 + index % 4}s` }} />)}</g>}
        {night ? <g className="startup-orbit" transform="rotate(-14 300 165)"><ellipse cx="300" cy="165" rx="201" ry="71" stroke={paint('orbit')} strokeWidth="1" /><path className="startup-orbit-trace" d="M101 164C101 203 190 237 300 237C386 237 459 219 489 192" stroke={paint('orbit')} strokeWidth="2.2" strokeLinecap="round" pathLength="1" /></g>
          : <g className="startup-solar-track"><path d="M114 276A186 186 0 0 1 486 276" stroke={paint('orbit')} strokeWidth=".8" strokeDasharray="2 7" /><path className="startup-orbit-trace" d="M114 276A186 186 0 0 1 486 276" stroke={paint('orbit')} strokeWidth="1.2" pathLength="1" /><circle cx="114" cy="276" r="2" fill="#D6BC8D" opacity=".5" /><circle cx="486" cy="276" r="2" fill="#D6BC8D" opacity=".5" /></g>}
        <g className="startup-lens"><path d={lensShape} fill={paint('glass')} stroke={paint('rim')} strokeWidth="1.5" /><path d="M236 106C246 73 272 60 299 60C331 57 355 71 367 94" stroke={night ? '#EFF8FF' : '#FFFFFF'} strokeOpacity={night ? '.29' : '.85'} strokeWidth="2.2" strokeLinecap="round" /><path d="M228 153C226 201 252 222 299 221C339 222 363 209 373 174" stroke={night ? '#A4C1E7' : '#B7CDC2'} strokeOpacity={night ? '.17' : '.27'} strokeWidth="4.5" strokeLinecap="round" /></g>
        {night ? <g className="startup-moon"><circle className="startup-moon-glow" cx="295" cy="142" r="57" fill="#A8C6EB" opacity=".25" filter={paint('glow')} /><g mask={paint('crescent')}><circle cx="301" cy="137" r="43" fill={paint('moon')} /><circle cx="301" cy="137" r="42.5" stroke="#EFF7FF" strokeOpacity=".76" /><ellipse cx="273" cy="144" rx="5" ry="8" fill="#7E9AB9" opacity=".13" /><ellipse cx="296" cy="169" rx="7" ry="4" fill="#7E9AB9" opacity=".16" /><circle cx="278" cy="123" r="3" fill="#7E9AB9" opacity=".13" /></g><path d={starShape} transform="translate(333 160) scale(.62)" fill="#EDF5FD" opacity=".8" /><circle cx="341" cy="142" r="1.1" fill="#DFEDFB" opacity=".75" />{rainy && <path className="startup-moon-refraction" d="M277 193C275 209 304 216 306 232M290 226C289 239 319 241 320 253" stroke="#A7CCE4" strokeWidth="1.2" strokeLinecap="round" />}</g> : <>
          <g transform="translate(300 276)"><g className="startup-solar-arm" data-target-angle={sunAngle.toFixed(2)}><g transform="translate(0 -186)"><g className="startup-sun"><circle r="53" fill="var(--startup-sun-edge)" opacity=".28" filter={paint('glow')} /><circle r="30" fill={paint('sun')} stroke="#FFF9DE" strokeOpacity=".8" /><circle className="startup-sun-ring" r="40" stroke="var(--startup-sun-edge)" strokeOpacity=".3" strokeDasharray="1 8" strokeLinecap="round" /></g></g></g></g>
          <g transform="translate(139 174) scale(.94)"><g className="startup-cloud startup-cloud-front"><path d={cloudShape} fill={paint('cloud')} /><path d="M2 35H85" stroke="#FFFFFF" strokeOpacity=".4" /></g></g>
          <g transform="translate(381 206) scale(.95)"><g className="startup-cloud startup-cloud-back"><path d={cloudShape} fill={paint('cloud')} /></g></g>
          {rainy && <g className="startup-rain-clouds"><g transform="translate(216 95) scale(1.66)"><g className="startup-cloud startup-cloud-back"><path d={cloudShape} fill={paint('cloud')} /></g></g><g transform="translate(285 132) scale(1.1)"><g className="startup-cloud startup-cloud-front"><path d={cloudShape} fill={paint('cloud')} /></g></g></g>}
          <g className="startup-meadow"><ellipse cx="300" cy="336" rx="198" ry="19" fill={paint('meadow')} /><path d="M116 331C184 325 218 339 297 332S420 326 488 337" stroke={paint('meadow')} strokeWidth="1.5" /><g className="startup-meadow-light"><ellipse cx="300" cy="333" rx="130" ry="6" fill="#FFF6CC" opacity={rainy ? '.15' : '.32'} filter={paint('galaxy')} /></g>
            {[147,164,226,242,363,380,431,447].map((x,index) => <path key={x} d={`M${x} ${337 + index % 3}q${index % 2 ? -5 : 5}-${9 + index % 4 * 2} ${index % 2 ? -7 : 8}-${19 + index % 3 * 5}`} stroke="#A5B38C" strokeOpacity=".42" strokeWidth=".8" strokeLinecap="round" />)}
          </g>
          <SunflowerDetail paint={paint} x={193} y={272} scale={.68} angle={flowerAngle} index={0} /><SunflowerDetail paint={paint} x={404} y={298} scale={.43} angle={flowerAngle * .8} index={1} /><SunflowerDetail paint={paint} x={434} y={318} scale={.26} angle={flowerAngle * .7} index={2} /><circle cx="170" cy="140" r="1.4" fill="#D9BF83" opacity=".43" /><circle cx="427" cy="148" r="1.6" fill="#C0D2BF" opacity=".65" />
        </>}
        {night && <><g className="startup-hanging-stars">{hangingStars.map(([x,y,length,scale], index) => <g key={x} transform={`translate(${x} ${y})`}><g className="startup-hanging-star-drop" style={{ '--drop-delay': `${.28 + index * .36}s` }}><g className="startup-hanging-star" style={{ '--thread-delay': `${index * -.8}s`, '--thread-duration': `${7 + index}s` }}><path className="startup-star-thread" d={`M0 0V${length}`} stroke="#BDD4EE" strokeOpacity=".3" strokeWidth=".7" /><circle cy={length + 6} r={scale * 11} fill="#B5D1E8" opacity=".07" /><path d={starShape} transform={`translate(0 ${length + 6}) scale(${scale})`} fill="#D7E6F6" opacity=".88" /></g></g></g>)}</g><Galaxy paint={paint} rainy={rainy} /></>}
      </svg>
      <div className="startup-copy"><p className="startup-brand" data-empty={english && !night ? 'true' : undefined}>{english && !night ? '\u00a0' : 'Daylight'}</p><h1 className="startup-theme-name" id={`${uid}-title`}>{themeName}</h1><span className="startup-hairline" aria-hidden="true" /></div>
    </div>
    <button className="startup-skip" type="button" onClick={onSkip} aria-label={skipLabel}><span>{skipLabel}</span><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" focusable="false"><path d="M3 7h7M7 3.5 10.5 7 7 10.5" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
  </section>;
}
