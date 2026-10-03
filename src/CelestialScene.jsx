import React, { useId } from "react";
import "./celestial-scene.css";

// Decorative daylight and moonlight, isolated from all interactive header content.
export default function CelestialScene({ night = false, animated = true, className = "" }) {
  const uid = `celestial-${useId().replace(/:/g, "")}`;
  const fill = name => `url(#${uid}-${name})`;
  return (
    <div
      className={`celestial-scene ${night ? "celestial-night" : "celestial-day"} ${className}`.trim()}
      data-animated={animated ? "true" : "false"}
      aria-hidden="true"
    >
      <svg viewBox="0 0 240 150" fill="none" focusable="false">
        <defs>
          <radialGradient id={`${uid}-moon-halo`}>
            <stop stopColor="#BBD9FF" stopOpacity=".48" />
            <stop offset=".42" stopColor="#8FB4E8" stopOpacity=".18" />
            <stop offset="1" stopColor="#89ABDD" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-moon`} cx=".67" cy=".30" r=".91">
            <stop stopColor="#F5F5E8" />
            <stop offset=".44" stopColor="#DEE8EA" />
            <stop offset=".78" stopColor="#ADBDCF" />
            <stop offset="1" stopColor="#7D95B3" />
          </radialGradient>
          <radialGradient id={`${uid}-crater`} cx=".4" cy=".75">
            <stop stopColor="#748DAA" stopOpacity=".24" />
            <stop offset=".72" stopColor="#9AB0C5" stopOpacity=".12" />
            <stop offset="1" stopColor="#9AB0C5" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-sun-halo`}>
            <stop stopColor="#F2C87A" stopOpacity=".55" />
            <stop offset=".43" stopColor="#EDCB88" stopOpacity=".26" />
            <stop offset="1" stopColor="#EDCB88" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}-sun`} cx=".39" cy=".31" r=".78">
            <stop stopColor="#FFF5C9" />
            <stop offset=".62" stopColor="#F3D48C" />
            <stop offset="1" stopColor="#DDAF5F" />
          </radialGradient>
          <linearGradient id={`${uid}-cloud`} x1="122" y1="69" x2="117" y2="113" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFC" stopOpacity=".98" />
            <stop offset=".52" stopColor="#F9FAF4" stopOpacity=".96" />
            <stop offset="1" stopColor="#E2E8DF" stopOpacity=".77" />
          </linearGradient>
          <linearGradient id={`${uid}-cloud-small`} x1="160" y1="51" x2="169" y2="86" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFEF3" stopOpacity=".9" />
            <stop offset="1" stopColor="#EAECE1" stopOpacity=".64" />
          </linearGradient>
          <filter id={`${uid}-cloud-shadow`} x="-30%" y="-50%" width="160%" height="210%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#9DAD98" floodOpacity=".12" />
          </filter>
        </defs>
        {night ? (
          <>
            <ellipse className="celestial-halo celestial-moon-halo" cx="124" cy="72" rx="79" ry="69" fill={fill("moon-halo")} />
            <g className="celestial-stars" fill="#D8E8F9">
              <circle cx="77" cy="99" r=".85" opacity=".48" />
              <circle cx="187" cy="47" r=".95" opacity=".62" />
              <circle cx="176" cy="110" r=".9" opacity=".47" />
              <circle cx="62" cy="102" r=".7" opacity=".40" />
              <path d="M176 71L177 75L181 76L177 77L176 81L175 77L171 76L175 75Z" opacity=".57" />
              <path d="M85 29L85.7 31.3L88 32L85.7 32.7L85 35L84.3 32.7L82 32L84.3 31.3Z" opacity=".5" />
            </g>
            <g className="celestial-hanging-stars">
              <g className="hanging-star hanging-star-one">
                <path className="star-thread" d="M59 0C59 20 59.7 33 60 51" />
                <path className="hanging-star-shape" d="M60 51L62 57L68 59L62 61L60 67L58 61L52 59L58 57Z" />
              </g>
              <g className="hanging-star hanging-star-two">
                <path className="star-thread" d="M187 0C187 32 186.3 60 187 83" />
                <path className="hanging-star-shape" d="M187 83L189.1 89.9L196 92L189.1 94.1L187 101L184.9 94.1L178 92L184.9 89.9Z" />
              </g>
              <g className="hanging-star hanging-star-three">
                <path className="star-thread" d="M166 0C166 8 166 15 166 21" />
                <path className="hanging-star-shape" d="M166 21L167.5 26L172.5 27.5L167.5 29L166 34L164.5 29L159.5 27.5L164.5 26Z" />
              </g>
            </g>
            <g className="celestial-moon">
              <circle cx="124" cy="72" r="33" fill={fill("moon")} stroke="#DCECF9" strokeOpacity=".57" strokeWidth=".75" />
              <path d="M120 39.5C105 47 99 57 99 72C99 84 104 95 115 103" stroke="#738FAA" strokeOpacity=".16" strokeWidth="5" strokeLinecap="round" />
              <path d="M128 40C143 42 154 54 156 66" stroke="#FFFDF0" strokeOpacity=".45" strokeWidth="1.3" strokeLinecap="round" />
              <ellipse cx="111" cy="67" rx="9" ry="11" fill={fill("crater")} transform="rotate(-18 111 67)" />
              <ellipse cx="135" cy="84" rx="8" ry="6" fill={fill("crater")} transform="rotate(25 135 84)" />
              <circle cx="128" cy="55" r="5.5" fill={fill("crater")} />
              <circle cx="112" cy="86" r="4.2" fill={fill("crater")} />
              <circle cx="143" cy="65" r="3.2" fill={fill("crater")} />
              <path d="M107 66C108 62 112 61 115 64M131 84C135 82 138 83 140 85" stroke="#EEF5F3" strokeOpacity=".23" strokeWidth=".8" strokeLinecap="round" />
            </g>
          </>
        ) : (
          <>
            <ellipse className="celestial-halo celestial-sun-halo" cx="121" cy="64" rx="82" ry="64" fill={fill("sun-halo")} />
            <g className="celestial-sun">
              <circle cx="121" cy="61" r="27" fill={fill("sun")} stroke="#F3D693" strokeOpacity=".4" strokeWidth=".8" />
              <path d="M107 40C115 35 126 35 134 40" stroke="#FFF6D4" strokeOpacity=".68" strokeWidth="1.2" strokeLinecap="round" />
            </g>
            <g className="celestial-cloud celestial-cloud-back">
              <path d="M151 84C142 84 138 80 138 74C138 68 144 64 150 65C154 52 171 50 178 63C187 61 195 67 195 75C195 81 190 85 183 85L151 84Z" fill={fill("cloud-small")} stroke="#FFFFF5" strokeOpacity=".67" strokeWidth=".75" />
            </g>
            <g className="celestial-cloud celestial-cloud-front" filter={fill("cloud-shadow")}>
              <path d="M62 111C52 111 47 106 48 99C49 92 55 87 63 88C65 77 74 71 83 73C91 60 111 63 115 77C125 70 138 76 140 87C152 83 163 90 163 100C163 107 157 112 149 112L62 111Z" fill={fill("cloud")} stroke="#FFFFFB" strokeOpacity=".87" strokeWidth=".9" />
              <path d="M62 109H148" stroke="#C8D2C3" strokeOpacity=".2" strokeWidth=".75" strokeLinecap="round" />
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
