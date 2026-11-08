"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { receiptMarkup } from "./receipt-markup";

type ShaderController = { pause(value: boolean): void; dispose(): void };
type ShaderApi = { mount(element: HTMLElement, options?: { enabled?: boolean }): Promise<ShaderController> };
let shaderScript: Promise<ShaderApi> | undefined;

function loadShader(): Promise<ShaderApi> {
  if (!shaderScript) {
    shaderScript = new Promise((resolve, reject) => {
      const getApi = () => (window as Window & { CausalityShader?: ShaderApi }).CausalityShader;
      const existing = getApi();
      if (existing) return resolve(existing);
      const script = document.createElement("script");
      script.src = "/causality/causality-shader.bundle.js";
      script.async = true;
      script.onload = () => {
        const api = getApi();
        if (api) resolve(api);
        else reject(new Error("Shader unavailable"));
      };
      script.onerror = () => reject(new Error("Shader unavailable"));
      document.head.appendChild(script);
    });
  }
  return shaderScript;
}

export function HeroVisual() {
  const shaderRef = useRef<HTMLDivElement>(null);
  const controller = useRef<ShaderController | null>(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const target = shaderRef.current;
    if (!target) return;
    let stopped = false;
    let observer: IntersectionObserver | undefined;
    loadShader().then(api => api.mount(target)).then(instance => {
      if (stopped) { instance.dispose(); return; }
      controller.current = instance;
      setReady(true);
      observer = new IntersectionObserver(([entry]) => instance.pause(!entry.isIntersecting || pausedRef.current), { rootMargin: "100px" });
      observer.observe(target);
    }).catch(() => { /* Keep the exported frame as a static fallback. */ });
    return () => { stopped = true; observer?.disconnect(); controller.current?.dispose(); controller.current = null; };
  }, []);

  function toggleMotion() {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
    controller.current?.pause(next);
  }

  return <figure className="landing-hero-visual"><div className="landing-hero-light" aria-hidden="true"><div ref={shaderRef} className="landing-hero-shader" /></div><a href="#sample-report" className="landing-hero-preview" aria-label="See a closer view of the sample investigation"><img src="/causality/causality-product-desktop.png" width="1296" height="900" fetchPriority="high" alt="Causality desktop workspace showing a chargeback investigation, evidence timeline, original customer email, and draft response review." /></a><figcaption><span>Product concept · Synthetic case</span>{ready && <button type="button" className="landing-motion-toggle" onClick={toggleMotion} aria-pressed={paused}>{paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}{paused ? "Play motion" : "Pause motion"}</button>}</figcaption></figure>;
}

export function ReceiptReveal() {
  const artRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const art = artRef.current;
    if (!art) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const update = () => {
      frame = 0;
      const bounds = art.getBoundingClientRect();
      const progress = reducedMotion.matches ? 1 : clamp((window.innerHeight - bounds.top) / (bounds.height + 80));
      const receipts = art.querySelectorAll<SVGGElement>(".receipt");
      for (const receipt of receipts) {
        const index = Number(receipt.dataset.index);
        const local = clamp(progress * 1.3 - (index % 5) * 0.06);
        const y = Number(receipt.dataset.y) + (1 - local) * 340;
        receipt.setAttribute("transform", `translate(${receipt.dataset.x} ${y}) rotate(${receipt.dataset.angle} 68 134)`);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reducedMotion.addEventListener("change", schedule);
    update();
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); reducedMotion.removeEventListener("change", schedule); };
  }, []);
  return <div className="landing-receipt-art" ref={artRef} dangerouslySetInnerHTML={{ __html: receiptMarkup }} />;
}
