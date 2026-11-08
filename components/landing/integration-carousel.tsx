"use client";

import { useEffect, useRef, useState } from "react";
import "./integration-carousel.css";

const integrations = [
  { name: "Stripe", asset: "stripe" },
  { name: "Gmail", asset: "gmail" },
  { name: "Supabase", asset: "supabase" },
  { name: "Amazon Bedrock", asset: "amazonbedrock" },
  { name: "Zoho", asset: "zoho" },
  { name: "Resend", asset: "resend" },
] as const;

function IntegrationList({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul className="integration-carousel-list" aria-hidden={duplicate || undefined} data-duplicate={duplicate || undefined}>
      {integrations.map(({ name, asset }) => (
        <li className="integration-carousel-item" key={asset}>
          <img src={`/causality/integrations/${asset}.svg`} width="32" height="32" alt="" />
          <span>{name}</span>
        </li>
      ))}
    </ul>
  );
}

export function IntegrationCarousel() {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(true);

  useEffect(() => {
    const updateVisibility = () => setDocumentVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
      observer.disconnect();
    };
  }, []);

  return (
    <section ref={sectionRef} className="integration-carousel" aria-label="Planned integrations" tabIndex={0} data-paused={!visible || !documentVisible}>
      <div className="landing-container">
        <div className="integration-carousel-heading">
          <p>Built to work with</p>
          <div className="integration-carousel-status">
            <p>Connections in development</p>
          </div>
        </div>
        <div className="integration-carousel-viewport">
          <div className="integration-carousel-track">
            <IntegrationList />
            <IntegrationList duplicate />
          </div>
        </div>
      </div>
    </section>
  );
}
