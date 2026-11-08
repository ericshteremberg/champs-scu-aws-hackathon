import { ArrowUpRight, ArrowRight, ArrowLeftRight } from "lucide-react";
import { HeroVisual, ReceiptReveal } from "@/components/landing/motion";
import { ProductDemo } from "@/components/landing/product-demo";
import "./landing.css";

const principles = [
  { icon: ArrowUpRight, title: "Query only approved records.", description: "Customer and transaction IDs constrain each query. The access layer filters permitted fields before results reach the investigator." },
  { icon: ArrowLeftRight, title: "Use a fresh context at each stage.", description: "Pass only filtered evidence and the task-specific toolset. Exclude case records from training, fine-tuning, and shared customer memory." },
  { icon: ArrowRight, title: "Enforce permissions outside the AI.", description: "An independent policy layer approves broader access. Reports and audit logs stay separate from agent context, under explicit retention rules." },
];

function Brand() {
  return <a href="#top" className="landing-brand" aria-label="Causality home"><svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M23 5H9L3 15L9 25H23M15 10H27M15 20H27" fill="none" stroke="currentColor" strokeWidth="3" /></svg><span>Causality</span></a>;
}

function AccessButton({ dark = false }: { dark?: boolean }) {
  return <a className={`landing-button ${dark ? "landing-button-dark landing-nav-cta" : "landing-button-orange"}`} href="/login">Get early access <ArrowUpRight size={18} aria-hidden="true" /></a>;
}

export default function Home() {
  return (
    <div className="causality-landing" id="top">
      <a className="landing-skip" href="#main">Skip to content</a>
      <header className="landing-header"><div className="landing-nav landing-container"><Brand /><nav aria-label="Main navigation"><a href="#investigation">The investigation</a><a href="#sample-report">Sample report</a><a href="#access-control">Access &amp; control</a></nav><AccessButton dark /></div></header>
      <main id="main">
        <section className="landing-hero" aria-labelledby="hero-title"><div className="landing-container landing-hero-grid">
          <div className="landing-hero-copy"><p className="landing-eyebrow">AI chargeback investigation</p><h1 id="hero-title">Stripe doesn’t<br />tell the<br /><span>whole story.</span></h1><p className="landing-hero-description">Turn payment records, customer conversations, and company data into clear, evidence-backed responses.</p><div className="landing-actions"><AccessButton /><a className="landing-text-link" href="#sample-report">See a sample report</a></div></div>
          <HeroVisual />
        </div></section>
        <section className="landing-sources" aria-label="Evidence sources"><div className="landing-container"><div className="landing-caption-row"><p>Evidence beyond the payment.</p><p className="landing-muted">Planned connections</p></div><ul className="landing-source-list"><li>Stripe</li><li>Gmail</li><li>Company records</li><li>Your policies</li></ul></div></section>
        <section className="landing-showcase landing-container" id="sample-report" aria-labelledby="showcase-title">
          <h2 id="showcase-title">The payment is one record.<br />The case is the whole story.</h2>
          <ProductDemo />
          <div className="landing-caption-row landing-muted"><p>Every finding stays connected to its source.</p><p>Scripted walkthrough · Synthetic records</p></div>
        </section>
        <section className="landing-investigation" id="investigation" aria-labelledby="investigation-title"><div className="landing-container landing-investigation-grid">
          <div className="landing-investigation-intro"><h2 id="investigation-title">Designed to investigate.<br />Without training on your data.</h2><p className="landing-muted">The intended architecture processes approved records for one case, without training on them or building a persistent cross-customer agent memory.</p><img className="landing-architecture" src="/causality/access-architecture-compact.svg" width="480" height="340" loading="lazy" alt="Planned access architecture: company records pass through a policy gate into a fresh context containing evidence and tools. Company policy and the audit log remain outside the investigator’s context." /></div>
          <div className="landing-principles">{principles.map(({ icon: Icon, title, description }) => <article className="landing-principle" key={title}><Icon className="landing-principle-icon" size={28} strokeWidth={1.5} aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p></div></article>)}</div>
        </div></section>
        <section className="landing-controls landing-container" id="access-control" aria-labelledby="control-title">
          <div className="landing-control-panel"><div className="landing-caption-row"><p className="landing-eyebrow">Access &amp; control</p><p className="landing-muted">Design preview</p></div><div className="landing-control-grid">
            <div className="landing-control-copy"><h2 id="control-title">Your data.<br />Your boundaries.</h2><p className="landing-muted">Choose the records an investigation may use. Additional access requires independent approval.</p><p className="landing-medium">Scoped results. External enforcement.<br />An activity trail you can inspect.</p></div>
            <dl className="landing-scope-list"><div><dt>Order #1048<span>Payment, fulfilment, relevant policy</span></dt><dd>Allowed</dd></div><div><dt>Other customer records<span>Unrelated emails and transactions</span></dt><dd>Excluded</dd></div><div><dt>More delivery evidence<span>A new scope request</span></dt><dd>Approval required</dd></div></dl>
          </div><p className="landing-control-note landing-muted">The investigator cannot approve its own access. Controls shown reflect the planned access model.</p></div>
          <div className="landing-outcome-band"><h2>Protect revenue. Reduce investigation costs.</h2><p>Prepared by Causality. Approved by you.</p></div>
        </section>
      </main>
      <div className="landing-footer-runway"><footer className="landing-footer"><div className="landing-container"><div className="landing-footer-top"><h2>Build your next case<br />on the full story.</h2><AccessButton /></div><ReceiptReveal /><div className="landing-footer-bottom"><p>© 2026 Causality</p><p>Evidence. Context. Judgment.</p><nav aria-label="Footer navigation"><a href="#sample-report">Sample report</a><a href="#access-control">Access &amp; control</a><a href="#top">Back to top ↑</a></nav></div></div></footer></div>
    </div>
  );
}
