"use client";

import { useEffect, useRef } from "react";
import { receiptMarkup } from "./receipt-markup";
import { EvidenceHero } from "./evidence-hero";

export function HeroVisual() {
  return <EvidenceHero />;
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
      const runway = art.closest<HTMLElement>(".landing-footer-runway");
      const footer = art.closest<HTMLElement>(".landing-footer");
      const travel = runway && footer ? runway.offsetHeight - footer.offsetHeight : 0;
      const entry = window.innerHeight * .2;
      const progress = reducedMotion.matches ? 1 : travel > 1 && runway
        ? clamp((entry - runway.getBoundingClientRect().top) / (travel + entry))
        : clamp((window.innerHeight - bounds.top) / (bounds.height + 80));
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
