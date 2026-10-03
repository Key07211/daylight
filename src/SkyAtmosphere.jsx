import React, { useEffect, useId, useState } from "react";
import "./sky-atmosphere.css";

const phases = new Set(["dawn", "morning", "noon", "afternoon", "sunset", "twilight", "night"]);
const conditions = new Set(["clear", "cloudy", "rain", "snow", "fog", "storm", "unknown"]);
const clamp = (value, fallback, min, max) => typeof value === "number" && Number.isFinite(value)
  ? Math.min(max, Math.max(min, value)) : fallback;
const stars = [
  [4, 12, 2], [12, 36, 3], [8, 70, 2], [18, 88, 2], [25, 21, 3],
  [29, 57, 2], [34, 83, 3], [38, 10, 2], [43, 38, 2], [47, 70, 3],
  [52, 8, 2], [58, 49, 2], [61, 89, 3], [66, 30, 2], [72, 9, 3],
  [76, 62, 2], [83, 43, 3], [87, 84, 2], [92, 24, 3], [97, 69, 2],
  [22, 48, 5], [41, 19, 6], [56, 79, 5], [79, 21, 7], [94, 51, 5],
];
const hangingStars = [
  [18, 152, 14, 17, -8], [37, 90, 11, 20, -4],
  [70, 201, 18, 22, -13], [87, 133, 13, 18, -6], [96, 242, 12, 25, -18],
];

// The sky is one continuous background. Content stays above it and receives no input here.
export default function SkyAtmosphere({ atmosphere = {}, animated = true, night = false }) {
  const uid = `sky-${useId().replace(/:/g, "")}`;
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);
  const phase = phases.has(atmosphere.phase) ? atmosphere.phase : "morning";
  const condition = conditions.has(atmosphere.condition) ? atmosphere.condition : "unknown";
  const cloudCover = clamp(atmosphere.cloudCover, 20, 0, 100);
  const daylight = clamp(atmosphere.daylight, .65, 0, 1);
  const warmth = clamp(atmosphere.warmth, .4, 0, 1);
  const rainIntensity = clamp(atmosphere.rainIntensity, 0, 0, 1);
  const wet = condition === "rain" || condition === "storm";
  const rainObscuresSun = condition === "storm" || (condition === "rain" && (rainIntensity >= .45 || cloudCover >= 85));
  const sunVisible = !night && atmosphere.sunVisible !== false && phase !== "night" && phase !== "twilight" && !rainObscuresSun;
  const sunWeatherOpacity = condition === "rain" ? .22 * (1 - cloudCover / 140) : 1;
  const cloudOpacity = Math.min(.59, .055 + cloudCover * .0048 + rainIntensity * .06) * (night ? .74 : 1);
  const moonOpacity = condition === "storm" ? .035 : wet
    ? Math.max(.055, .50 - cloudCover * .003 - rainIntensity * .30)
    : Math.max(.20, .92 - cloudCover * .006 - (condition === "fog" ? .35 : 0));
  const starOpacity = Math.max(.06, .78 - cloudCover * .0058 - rainIntensity * .28 - (condition === "fog" ? .32 : 0));
  const fill = name => `url(#${uid}-${name})`;
  const cloud = className => (
    <svg className={`sky-cloud ${className}`} viewBox="0 0 300 106" fill="none" focusable="false">
      <path d="M26 93C12 93 5 84 7 73C9 61 20 55 33 57C35 39 50 29 65 34C78 14 106 17 116 37C130 28 152 35 157 51C170 45 187 52 191 64C203 51 225 54 232 68C250 61 271 70 272 81C272 89 265 95 253 95L26 93Z" fill={fill("cloud-fill")} />
    </svg>
  );
  return (
    <div className={`sky-atmosphere ${night ? "sky-night" : "sky-day"}`}
      data-theme={night ? "night" : "day"} data-phase={phase} data-condition={condition}
      data-cloudiness={Math.round(cloudCover)} data-animated={animated && documentVisible ? "true" : "false"}
      data-sun-visible={sunVisible ? "true" : "false"} data-moon-visible={night ? "true" : "false"}
      aria-hidden="true" style={{
        "--sun-x": `${clamp(atmosphere.sunX, 52, 0, 100)}%`,
        "--sun-y": `${9 + clamp(atmosphere.sunY, 36, 0, 100) * .25}%`,
        "--sky-daylight": daylight, "--sky-warmth": warmth,
        "--sky-cloud-opacity": cloudOpacity,
        "--sky-sun-opacity": (.40 + daylight * .31 - cloudCover * .0018) * sunWeatherOpacity,
        "--sky-moon-opacity": moonOpacity, "--sky-star-opacity": starOpacity,
      }}>
      <svg className="sky-definitions" width="0" height="0" focusable="false">
        <defs>
          <linearGradient id={`${uid}-cloud-fill`} x1="0" y1="15" x2="0" y2="102" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--sky-cloud-highlight)" stopOpacity=".82" />
            <stop offset=".55" stopColor="var(--sky-cloud-color)" stopOpacity=".84" />
            <stop offset="1" stopColor="var(--sky-cloud-color)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${uid}-moon-fill`} cx=".32" cy=".25" r=".86">
            <stop stopColor="#F7FAF5" />
            <stop offset=".43" stopColor="#DBE7EF" />
            <stop offset=".79" stopColor="#A9BBD6" />
            <stop offset="1" stopColor="#8CA2C3" />
          </radialGradient>
          <radialGradient id={`${uid}-moon-crater`}>
            <stop stopColor="#6581A4" stopOpacity=".27" />
            <stop offset="1" stopColor="#9DB2CE" stopOpacity="0" />
          </radialGradient>
          <mask id={`${uid}-crescent`} maskUnits="userSpaceOnUse" x="48" y="48" width="145" height="145">
            <circle cx="120" cy="120" r="65" fill="#FFF" />
            <circle cx="145" cy="101" r="58" fill="#000" />
          </mask>
        </defs>
      </svg>
      <div className="sky-wash" />
      <div className="sky-horizon" />
      {sunVisible && <div className="sky-sun-position"><div className="sky-sun-halo" /><div className="sky-sun" /></div>}
      {night && (
        <>
          <div className="sky-stars">
            {stars.map(([left, top, size], index) => <span className={`sky-star ${size > 3 ? "sky-star-point" : ""}`}
              key={index} style={{ left: `${left}%`, top: `${top}%`, width: `${size}px`, height: `${size}px`,
                animationDelay: `${index * -1.7}s`, animationDuration: `${11 + index % 7}s` }} />)}
          </div>
          <div className="sky-hanging-stars">
            {hangingStars.map(([left, length, size, duration, delay], index) => (
              <span className="sky-hanging-star hanging-star" key={index} style={{ left: `${left}%`,
                "--thread-length": `${length}px`, "--hanging-star-size": `${size}px`,
                animationDuration: `${duration}s`, animationDelay: `${delay}s` }}>
                <span className="sky-star-thread star-thread" />
                <svg className="sky-hanging-star-shape" viewBox="0 0 24 24" fill="none" focusable="false">
                  <path d="M12 1L14.6 9.4L23 12L14.6 14.6L12 23L9.4 14.6L1 12L9.4 9.4Z" />
                </svg>
              </span>
            ))}
          </div>
          <div className="sky-moon-position">
            <div className="sky-moon-halo" />
            <svg className="sky-moon celestial-moon" viewBox="0 0 240 240" fill="none" focusable="false">
              <g mask={fill("crescent")}>
                <circle cx="120" cy="120" r="65" fill={fill("moon-fill")} />
                <circle cx="120" cy="120" r="64.3" stroke="#F2F8FB" strokeOpacity=".50" strokeWidth="1.2" />
                <ellipse cx="75" cy="109" rx="8" ry="12" fill={fill("moon-crater")} transform="rotate(-15 75 109)" />
                <ellipse cx="95" cy="159" rx="10" ry="7" fill={fill("moon-crater")} transform="rotate(20 95 159)" />
                <circle cx="129" cy="173" r="6" fill={fill("moon-crater")} />
                <circle cx="69" cy="133" r="4" fill={fill("moon-crater")} />
                <path d="M66 96C72 76 91 62 106 58" stroke="#FFFFF9" strokeOpacity=".4" strokeWidth="1.3" strokeLinecap="round" />
              </g>
            </svg>
          </div>
        </>
      )}
      <div className="sky-cloud-layer">{cloud("sky-cloud-one")}{cloud("sky-cloud-two")}{cloud("sky-cloud-three")}</div>
      {(condition === "fog" || condition === "snow") && <div className="sky-haze"><i /><i /><i /></div>}
      {condition === "snow" && <div className="sky-snow">
        {[6, 16, 27, 38, 49, 60, 71, 82, 94].map((left, index) => <i key={left} className="sky-snowflake"
          style={{ left: `${left}%`, top: `${12 + (index % 4) * 21}%`, animationDelay: `${index * -3.7}s` }} />)}
      </div>}
    </div>
  );
}
