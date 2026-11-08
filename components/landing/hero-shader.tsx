"use client";

import { useEffect, useState } from "react";
import "./hero-shader.css";

type Treatment = "mesh" | "grain" | "contour" | "none";
type PaperShaders = typeof import("@paper-design/shaders-react");
const treatments: { id: Treatment; label: string }[] = [
  { id: "mesh", label: "Amber mesh" },
  { id: "grain", label: "Grain glow" },
  { id: "contour", label: "Contour" },
  { id: "none", label: "Original" },
];

/** Decorative, bounded GPU layer; the existing hero toggle controls its motion. */
export function HeroShader({ running }: { running: boolean }) {
  const [paper, setPaper] = useState<PaperShaders | null>(null);
  const [treatment, setTreatment] = useState<Treatment>("mesh");
  const [study, setStudy] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const selected = params.get("heroShader");
    if (treatments.some(item => item.id === selected)) setTreatment(selected as Treatment);
    setStudy(params.get("heroStudy") === "1");
    const preference = window.matchMedia("(prefers-contrast: more), (prefers-reduced-transparency: reduce)");
    const update = () => setEnabled(!preference.matches);
    update();
    preference.addEventListener("change", update);
    let disposed = false;
    // Keep the CSS atmosphere when WebGL is unavailable. No effect is required to read the page.
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2");
    if (gl) {
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      void import("@paper-design/shaders-react").then(module => {
        if (!disposed) setPaper(module);
      }).catch(() => { /* The static CSS background remains available. */ });
    }
    return () => { disposed = true; preference.removeEventListener("change", update); };
  }, []);

  function select(next: Treatment) {
    setTreatment(next);
    const url = new URL(window.location.href);
    url.searchParams.set("heroShader", next);
    window.history.replaceState(null, "", url);
  }

  const common = { width: "100%", height: "100%", minPixelRatio: 1, maxPixelCount: 800_000 };
  return <>
    <div className="hero-paper-atmosphere" data-treatment={treatment} data-running={running && enabled} aria-hidden="true">
      {paper && enabled && treatment === "mesh" && <paper.MeshGradient {...common}
        colors={["#ffffff", "#e6e9f0", "#ffc58f", "#fff2e5"]}
        distortion={.48} swirl={.14} grainMixer={0} grainOverlay={.025}
        speed={running ? .16 : 0} frame={12000} />}
      {paper && enabled && treatment === "grain" && <paper.GrainGradient {...common}
        colors={["#ff9a46", "#ffd8b4", "#dfe4ed"]} colorBack="#ffffff"
        shape="wave" softness={.8} intensity={.22} noise={.09} scale={1.25} rotation={-24}
        speed={running ? .2 : 0} frame={8000} />}
      {paper && enabled && treatment === "contour" && <paper.Waves {...common}
        colorBack="#ffffff" colorFront="#dba56f" frequency={.12} amplitude={.9}
        spacing={1.4} proportion={.012} softness={.015} shape={1} scale={2.4} rotation={-24} />}
    </div>
    {study && <div className="hero-shader-study" role="group" aria-label="Hero background experiments">
      {treatments.map(item => <button key={item.id} type="button" aria-pressed={treatment === item.id}
        onClick={() => select(item.id)}>{item.label}</button>)}
    </div>}
  </>;
}
