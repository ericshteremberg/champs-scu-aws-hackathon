"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import "./evidence-hero.css";

const aperture = "M382 102H285Q270 102 261 117L204 207Q195 221 204 235L261 325Q270 339 285 339H382V281H301L264 221L301 161H382Z";
const lens = "M301 161H382L418 221L382 281H301L264 221Z";
const inputs = [
  "M-24 106C91 106 107 178 185 193S240 212 286 221",
  "M-30 229C83 229 143 221 286 221",
  "M17 382C125 382 138 291 200 266S244 232 286 221",
];

function Fragment({ variant, fill }: { variant: number; fill: string }) {
  return <>
    <path d="M4 0H60L76 16V65L71 61L66 65L61 61L56 65L51 61L46 65L41 61L36 65L31 61L26 65L21 61L16 65L11 61L6 65L0 61V4Q0 0 4 0Z" fill={fill} stroke="#DDCDBE" strokeWidth=".8" />
    <path d="M60 0V13Q60 16 63 16H76" fill="#FFF7EC" stroke="#E9D6C4" strokeWidth=".8" />
    {variant === 0 ? <g fill="none" stroke="#E5782C" strokeWidth="1.4"><rect x="12" y="13" width="19" height="13" rx="3" /><path d="M12 18H31M16 22H20" /></g> : variant === 1 ? <g fill="none" stroke="#E5782C" strokeWidth="1.4"><rect x="12" y="13" width="19" height="14" rx="2" /><path d="M13 15L21.5 21L30 15" /></g> : <g fill="none" stroke="#E5782C" strokeWidth="1.4"><ellipse cx="21.5" cy="15" rx="9.5" ry="3" /><path d="M12 15V25C12 29 31 29 31 25V15M12 20C12 24 31 24 31 20" /></g>}
    <path d="M12 37H58M12 43H51M12 49H40" stroke="#A7A09A" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M51 53V58M54 53V58M58 53V58M62 53V58M64 53V58" stroke="#8E8781" strokeWidth="1" />
  </>;
}

export function EvidenceHero() {
  const id = `evidence-${useId().replaceAll(":", "")}`;
  const figure = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updatePreference();
    updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "80px" });
    if (figure.current) observer.observe(figure.current);
    return () => {
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
    };
  }, []);

  const url = (name: string) => `url(#${id}-${name})`;
  return (
    <figure ref={figure} className="landing-hero-visual causality-evidence-hero" data-running={!paused && inView && !reducedMotion && pageVisible}>
      <div className="ceh-art">
        <svg className="ceh-scene" viewBox="0 0 636 460" role="img" aria-labelledby={`${id}-title ${id}-description`}>
          <title id={`${id}-title`}>Scattered evidence becomes one connected case</title>
          <desc id={`${id}-description`}>Payment, conversation, and company record fragments follow separate paths into an orange, sculptural C aperture. The paths align through its center and emerge as an organized, source-linked evidence bundle.</desc>
          <defs>
            <radialGradient id={`${id}-atmosphere`}><stop stopColor="#FFB16E" stopOpacity=".23" /><stop offset=".55" stopColor="#FFD8B4" stopOpacity=".11" /><stop offset="1" stopColor="#FFF" stopOpacity="0" /></radialGradient>
            <radialGradient id={`${id}-grid-mask`}><stop stopColor="#FFF" stopOpacity=".6" /><stop offset=".73" stopColor="#FFF" stopOpacity=".17" /><stop offset="1" stopColor="#FFF" stopOpacity="0" /></radialGradient>
            <linearGradient id={`${id}-face`} x1=".13" y1="0" x2=".82" y2="1"><stop stopColor="#FFD39D" /><stop offset=".26" stopColor="#FFA244" /><stop offset=".65" stopColor="#FF821E" /><stop offset="1" stopColor="#EA5D05" /></linearGradient>
            <linearGradient id={`${id}-side`} x1="0" y1="0" x2=".5" y2="1"><stop stopColor="#FF9A36" /><stop offset=".52" stopColor="#ED6509" /><stop offset="1" stopColor="#B94100" /></linearGradient>
            <linearGradient id={`${id}-bevel`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFF2D6" /><stop offset=".43" stopColor="#FFD098" /><stop offset="1" stopColor="#F98225" /></linearGradient>
            <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#FFF" stopOpacity=".9" /><stop offset=".48" stopColor="#FFF8EB" stopOpacity=".42" /><stop offset="1" stopColor="#FFD0A4" stopOpacity=".6" /></linearGradient>
            <linearGradient id={`${id}-paper`} x1="0" y1="0" x2=".8" y2="1"><stop stopColor="#FFF" /><stop offset="1" stopColor="#FFF9F2" /></linearGradient>
            <linearGradient id={`${id}-beam`}><stop stopColor="#FFB25F" stopOpacity="0" /><stop offset=".4" stopColor="#FFB25F" stopOpacity=".15" /><stop offset="1" stopColor="#FFB25F" stopOpacity="0" /></linearGradient>
            <linearGradient id={`${id}-scan`}><stop stopColor="#FFF" stopOpacity="0" /><stop offset=".5" stopColor="#FFF" stopOpacity=".9" /><stop offset="1" stopColor="#FFF" stopOpacity="0" /></linearGradient>
            <filter id={`${id}-ground`} x="-50%" y="-150%" width="200%" height="400%"><feGaussianBlur stdDeviation="14" /></filter>
            <filter id={`${id}-object-shadow`} x="-50%" y="-30%" width="200%" height="190%"><feDropShadow dx="2" dy="15" stdDeviation="13" floodColor="#AF6938" floodOpacity=".19" /></filter>
            <filter id={`${id}-paper-shadow`} x="-60%" y="-50%" width="230%" height="230%"><feDropShadow dx="1" dy="8" stdDeviation="7" floodColor="#6B4A31" floodOpacity=".12" /></filter>
            <pattern id={`${id}-grid`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#D7CFC6" strokeWidth=".6" /></pattern>
            <mask id={`${id}-grid-fade`}><ellipse cx="337" cy="300" rx="350" ry="192" fill={url("grid-mask")} /></mask>
            <clipPath id={`${id}-lens-clip`}><path d={lens} /></clipPath>
          </defs>

          <ellipse cx="340" cy="252" rx="324" ry="225" fill={url("atmosphere")} />
          <g mask={url("grid-fade")} opacity=".8"><path d="M-50 185L650 5V387L-50 567Z" fill={url("grid")} transform="matrix(1 .12 -.24 1 63 -41)" /></g>
          <ellipse cx="330" cy="375" rx="147" ry="16" fill="#AF7545" opacity=".16" filter={url("ground")} />
          <ellipse cx="514" cy="351" rx="67" ry="9" fill="#7B6652" opacity=".1" filter={url("ground")} />

          <g className="ceh-input-paths" fill="none" strokeLinecap="round">
            {inputs.map((path, index) => <g key={path}>
              <path d={path} stroke="#DCCBBB" strokeWidth="1" />
              <path className="ceh-motion ceh-path-signal" d={path} pathLength="100" stroke="#E98635" strokeWidth="2" style={{ animationDelay: `${index * -3.2}s` }} />
            </g>)}
            <path d="M-6 116C84 116 106 187 183 202S239 217 286 221M-30 239C83 239 143 231 286 221M27 392C135 392 145 299 209 274S250 239 286 221" stroke="#E5D9CD" strokeWidth=".65" opacity=".6" />
          </g>

          {[
            { x: 25, y: 86, rotate: -12, travelX: 185, travelY: 105, delay: "-1s" },
            { x: -7, y: 203, rotate: 7, travelX: 218, travelY: -8, delay: "-4.2s" },
            { x: 69, y: 325, rotate: -8, travelX: 150, travelY: -112, delay: "-7.4s" },
          ].map((packet, index) => <g key={index} transform={`translate(${packet.x} ${packet.y})`}>
            <g className="ceh-motion ceh-receipt-motion" style={{ "--packet-angle": `${packet.rotate}deg`, "--packet-x": `${packet.travelX}px`, "--packet-y": `${packet.travelY}px`, animationDelay: packet.delay } as CSSProperties} filter={url("paper-shadow")}>
              <Fragment variant={index} fill={url("paper")} />
            </g>
          </g>)}

          <g className="ceh-aperture" filter={url("object-shadow")}>
            <path d={aperture} transform="translate(20 -14)" fill={url("side")} stroke="#E57826" strokeWidth=".7" />
            <path d="M285 102H382L402 88H305Q290 88 281 103L261 117Q270 102 285 102Z" fill={url("bevel")} />
            <path d="M382 102L402 88V147L382 161ZM382 281L402 267V325L382 339Z" fill={url("side")} />
            <path d="M301 161L321 147L284 207L264 221Z" fill="#FCA149" />
            <path d="M264 221L284 207L321 267L301 281Z" fill="#CB5108" />
            <path d="M301 281H382L402 267H321Z" fill="#F79B46" />

            <path d={lens} fill={url("glass")} stroke="#FFE5C7" strokeWidth="1" />
            <g clipPath={url("lens-clip")}>
              <path d="M279 183H413M269 202H426M266 221H427M276 240H419M289 259H406M300 157V285M322 157V285M344 157V285M366 157V285M388 157V285" stroke="#F0BD87" strokeWidth=".55" opacity=".48" />
              <path d="M269 221H421" stroke="#F09239" strokeWidth="1.25" />
              <rect className="ceh-motion ceh-lens-scan" x="269" y="159" width="28" height="124" fill={url("scan")} transform="skewX(-16)" />
              <path d="M280 176L394 268" stroke="#FFF" strokeWidth="16" opacity=".2" />
            </g>

            <path d={aperture} fill={url("face")} stroke="#F49A46" strokeWidth=".75" />
            <path d="M381 105H286Q272 105 264 119L207 209Q199 221 207 233L264 323Q272 336 286 336H381" fill="none" stroke={url("bevel")} strokeWidth="1.5" />
            <path d="M380 163H302L267 221L302 278H380" fill="none" stroke="#D45D0C" strokeWidth="1.1" opacity=".45" />
            <path d="M292 112H371" stroke="#FFF0D5" strokeWidth="2.5" strokeLinecap="round" opacity=".65" />
            <path d="M213 212L269 123" stroke="#FFF0D5" strokeWidth="1.2" strokeLinecap="round" opacity=".55" />
            <path d="M284 328H369" stroke="#FFAE5C" strokeWidth="1.5" strokeLinecap="round" opacity=".8" />
          </g>

          <path d="M322 212L528 172V278L322 230Z" fill={url("beam")} />
          <g fill="none" strokeLinecap="round">
            {[0, 1, 2].map(index => <g key={index}>
              <path d={`M346 ${211 + index * 10}H426Q447 ${211 + index * 10} 467 ${202 + index * 15}H509`} stroke="#DDB78E" strokeWidth=".9" />
              <path className="ceh-motion ceh-output-signal" d={`M346 ${211 + index * 10}H426Q447 ${211 + index * 10} 467 ${202 + index * 15}H509`} pathLength="100" stroke="#F28A2C" strokeWidth="2" style={{ animationDelay: `${index * -1.1}s` }} />
            </g>)}
          </g>

          <g transform="translate(477 161) rotate(6 48 70)" filter={url("paper-shadow")}>
            <path d="M22 14H91L106 29V140Q106 145 101 145H22Q17 145 17 140V19Q17 14 22 14Z" fill="#EFE9E1" stroke="#D8CCBF" strokeWidth=".9" />
            <path d="M13 7H82L97 22V133Q97 138 92 138H13Q8 138 8 133V12Q8 7 13 7Z" fill="#FAF5ED" stroke="#DDD1C3" strokeWidth=".9" />
            <path d="M5 0H69L88 19V127Q88 132 83 132H5Q0 132 0 127V5Q0 0 5 0Z" fill={url("paper")} stroke="#DCCDBD" strokeWidth=".9" />
            <path d="M69 0V15Q69 19 73 19H88" fill="#FFECD8" stroke="#E9D3BA" strokeWidth=".9" />
            <path d="M15 17H42" stroke="#EC812E" strokeWidth="5" strokeLinecap="round" />
            <path d="M15 28H57" stroke="#B9ADA1" strokeWidth="1.5" strokeLinecap="round" />
            {[49, 70, 91].map((y, index) => <g key={y}>
              <circle cx="16" cy={y} r="3" fill="#FFF3E3" stroke="#DE8C44" strokeWidth="1" />
              <path d={`M25 ${y - 2}H${index === 1 ? 65 : 71}M25 ${y + 4}H${index === 2 ? 47 : 58}`} stroke="#A99E91" strokeWidth="1.4" strokeLinecap="round" />
            </g>)}
            <path d="M16 52V67M16 73V88" stroke="#DCBD9B" strokeWidth="1" strokeDasharray="2 2" />
            <path d="M13 112H74" stroke="#E8DCCF" strokeWidth="1" />
            <path d="M14 120H33M55 120H73" stroke="#C2B4A4" strokeWidth="1.4" strokeLinecap="round" />
            <path className="ceh-motion ceh-paper-highlight" d="M1 42V102" stroke="#F3943E" strokeWidth="2" strokeLinecap="round" />
          </g>
          <g fill="#BAA38E" opacity=".5"><circle cx="135" cy="92" r="1.6" /><circle cx="458" cy="110" r="1.6" /><circle cx="434" cy="353" r="1.6" /><path d="M138 348H146M142 344V352M564 114H572M568 110V118" stroke="#B9A38E" strokeWidth=".75" /></g>
        </svg>
      </div>
      <figcaption><span>Scattered evidence. One clear case.</span><button type="button" className="landing-motion-toggle ceh-motion-toggle" onClick={() => setPaused(value => !value)} aria-pressed={paused} aria-label={paused ? "Play evidence animation" : "Pause evidence animation"}>{paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{paused ? "Play motion" : "Pause motion"}</button></figcaption>
    </figure>
  );
}
