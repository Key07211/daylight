import React, { useId } from "react";
import "./milky-way.css";

// Fixed stellar positions keep the sky still when the surrounding UI updates.
function makeStars() {
  let seed = 271828;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const normal = () => (random() + random() + random() - 1.5) / 1.5;
  const colors = ["#CBDCF7", "#E3E3FC", "#B6D1F5", "#CFBAEF", "#EAE4E7"];
  const stars = [];
  for (let i = 0; i < 310; i += 1) {
    const inBand = i >= 64;
    const x = inBand ? -18 + random() * 300 : random() * 260;
    const spine = 242 - x * .88 + Math.sin(x * .025) * 12;
    const y = inBand ? spine + normal() * (i > 205 ? 26 : 59) : random() * 280;
    stars.push({
      x,
      y,
      radius: inBand ? .23 + random() * .72 : .35 + random() * .68,
      opacity: inBand ? .22 + random() * .59 : .16 + random() * .39,
      color: colors[Math.floor(random() * colors.length)],
      layer: i % 3,
    });
  }
  return stars;
}

const stars = makeStars();
const brightStars = [
  { x: 54, y: 208, size: 2.4 },
  { x: 92, y: 168, size: 2.1 },
  { x: 151, y: 99, size: 1.5 },
  { x: 210, y: 58, size: 2.6 },
  { x: 229, y: 181, size: 1.4 },
  { x: 35, y: 91, size: 1.5 },
];

export default function MilkyWay({ className = "", animated = true }) {
  const uid = `milky-way-${useId().replace(/:/g, "")}`;
  const paint = (name) => `url(#${uid}-${name})`;

  return (
    <div
      className={`milky-way ${className}`.trim()}
      data-animated={animated ? "true" : "false"}
      aria-hidden="true"
    >
      <svg viewBox="0 0 260 280" fill="none" focusable="false">
        <defs>
          <radialGradient id={`${uid}-nebula`}>
            <stop stopColor="#B6C6F2" stopOpacity=".31" />
            <stop offset=".36" stopColor="#888FE2" stopOpacity=".18" />
            <stop offset=".7" stopColor="#597EC5" stopOpacity=".065" />
            <stop offset="1" stopColor="#597EC5" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-violet`}>
            <stop stopColor="#D1B3EB" stopOpacity=".3" />
            <stop offset=".45" stopColor="#9691D9" stopOpacity=".13" />
            <stop offset="1" stopColor="#8C8DD7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-core`}>
            <stop stopColor="#EDE5ED" stopOpacity=".32" />
            <stop offset=".32" stopColor="#C9C2E5" stopOpacity=".21" />
            <stop offset=".64" stopColor="#A0AEE0" stopOpacity=".09" />
            <stop offset="1" stopColor="#A0AEE0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-star-glow`}>
            <stop stopColor="#DBE8FF" stopOpacity=".53" />
            <stop offset=".25" stopColor="#B6CDFB" stopOpacity=".22" />
            <stop offset="1" stopColor="#9AB9F3" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${uid}-band`} x1="16" y1="249" x2="245" y2="23" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8192D5" stopOpacity="0" />
            <stop offset=".21" stopColor="#9799D5" stopOpacity=".3" />
            <stop offset=".5" stopColor="#D4CEEC" stopOpacity=".45" />
            <stop offset=".73" stopColor="#A8BBE8" stopOpacity=".3" />
            <stop offset="1" stopColor="#739DDF" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}-edge-fade`}>
            <stop offset=".45" stopColor="white" />
            <stop offset=".8" stopColor="white" stopOpacity=".82" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id={`${uid}-edges`}>
            <ellipse cx="132" cy="139" rx="153" ry="161" fill={paint("edge-fade")} />
          </mask>
          <filter id={`${uid}-cloud-softness`} x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="3.1" />
          </filter>
          <filter id={`${uid}-dust-softness`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="1.7" />
          </filter>
        </defs>

        <g mask={paint("edges")}>
          <g className="galaxy-drift">
            <g className="galactic-glow">
              <ellipse cx="136" cy="140" rx="54" ry="183" transform="rotate(45 136 140)" fill={paint("nebula")} />
              <ellipse cx="87" cy="190" rx="29" ry="71" transform="rotate(32 87 190)" fill={paint("violet")} />
              <ellipse cx="176" cy="90" rx="28" ry="94" transform="rotate(40 176 90)" fill={paint("nebula")} />
              <ellipse cx="126" cy="145" rx="35" ry="76" transform="rotate(54 126 145)" fill={paint("core")} />
              <ellipse cx="150" cy="141" rx="27" ry="52" transform="rotate(64 150 141)" fill={paint("violet")} />

              <g filter={paint("cloud-softness")}>
                <path d="M-16 277C31 237 43 203 82 179C116 158 137 149 162 123C194 91 223 74 270-4" stroke={paint("band")} strokeWidth="23" strokeLinecap="round" />
                <path d="M-5 261C40 231 44 196 90 169C126 149 159 146 187 102C207 72 229 49 258 15" stroke={paint("band")} strokeWidth="8" strokeLinecap="round" opacity=".75" />
                <path d="M36 219C59 207 61 195 84 187M91 172C110 163 126 163 145 144M161 119C187 99 191 85 210 69" stroke="#BAC2EA" strokeWidth="7" strokeLinecap="round" opacity=".15" />
              </g>

              <g filter={paint("dust-softness")} opacity=".43">
                <path d="M18 252C45 230 60 191 85 180C109 169 111 156 135 151C154 148 174 127 187 107C211 70 226 69 246 36" stroke="#15213D" strokeWidth="5" strokeLinecap="round" />
                <path d="M72 188C92 173 99 168 122 167C142 166 165 145 179 125" stroke="#17223E" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M130 152C138 138 157 126 168 114M48 220L60 200" stroke="#18213B" strokeWidth="2" strokeLinecap="round" />
              </g>
            </g>

            {[0, 1, 2].map((layer) => (
              <g className={`galaxy-stars galaxy-stars-${layer}`} key={layer}>
                {stars.filter((star) => star.layer === layer).map((star, index) => (
                  <circle
                    key={index}
                    cx={star.x}
                    cy={star.y}
                    r={star.radius}
                    fill={star.color}
                    opacity={star.opacity}
                  />
                ))}
              </g>
            ))}

            <g className="galaxy-beacons">
              {brightStars.map(({ x, y, size }) => (
                <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
                  <circle className="galactic-glow" r={size * 4.5} fill={paint("star-glow")} />
                  <path d={`M0 ${-size}L${size * .22} ${-size * .22}L${size} 0L${size * .22} ${size * .22}L0 ${size}L${-size * .22} ${size * .22}L${-size} 0L${-size * .22} ${-size * .22}Z`} fill="#DDE8FC" opacity=".65" />
                  <circle r=".65" fill="#F0EEFC" opacity=".87" />
                </g>
              ))}
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
