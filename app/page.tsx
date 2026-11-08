import { ArrowUpRight, ArrowRight, ArrowLeftRight } from "lucide-react";
import { HeroVisual, ReceiptReveal } from "@/components/landing/motion";
import { ProductDemo } from "@/components/landing/product-demo";
import { IntegrationCarousel } from "@/components/landing/integration-carousel";
import "./landing.css";

const principles = [
  { icon: ArrowUpRight, title: "Choose the source.", description: "Select a database project, review its schema, and map the tables and fields your cases need." },
  { icon: ArrowLeftRight, title: "Follow the order.", description: "A configured read-only connector looks up records for the selected case. Payment and order references keep the search scoped." },
  { icon: ArrowRight, title: "Compile the evidence.", description: "Bring matched records and email delivery events into a cited report. Inspect the sources, missing facts, and contradictions before approving." },
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
        <IntegrationCarousel />
        <section className="landing-showcase landing-container" id="sample-report" aria-labelledby="showcase-title">
          <h2 id="showcase-title">The payment is one record.<br />The case is the whole story.</h2>
          <ProductDemo />
        </section>
        <section className="landing-investigation" id="investigation" aria-labelledby="investigation-title"><div className="landing-container landing-investigation-grid">
          <div className="landing-investigation-intro"><h2 id="investigation-title">Find the records<br />behind the charge.</h2><p className="landing-muted">Start with an order. Follow its payment, database records, and email trail into one reviewable case.</p>
            <div className="landing-query-diagram">
              <svg viewBox="0 0 480 330" role="img" aria-labelledby="lookup-title lookup-desc">
                <title id="lookup-title">From database records to a cited report</title>
                <desc id="lookup-desc">Example: orders, tickets and message_log feed a read-only lookup scoped to order 1048. Only matched records pass into the evidence used for a cited report.</desc>
                <defs><linearGradient id="lookup-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fffaf4"/><stop offset="1" stopColor="#fff"/></linearGradient></defs>
                <text x="4" y="28" className="lookup-label">Selected tables</text><text x="476" y="28" textAnchor="end" className="lookup-label">Example</text>
                <g className="lookup-routes"><path d="M128 88H144Q152 88 152 96V147Q152 157 168 157"/><path d="M128 157H168"/><path d="M128 226H144Q152 226 152 218V167Q152 157 168 157"/><path d="M312 157H350"/></g>
                <g className="lookup-flow" aria-hidden="true"><path d="M128 88H144Q152 88 152 96V147Q152 157 168 157"/><path d="M128 157H168"/><path d="M128 226H144Q152 226 152 218V167Q152 157 168 157"/><path d="M312 157H350"/></g>
                <g className="lookup-table"><rect x="1" y="62" width="127" height="52" rx="8"/><path d="M15 78h14v19H15z M15 84h14 M21 84v13"/><text x="40" y="94">orders</text></g>
                <g className="lookup-table"><rect x="1" y="131" width="127" height="52" rx="8"/><path d="M15 147h14v19H15z M15 153h14 M21 153v13"/><text x="40" y="163">tickets</text></g>
                <g className="lookup-table"><rect x="1" y="200" width="127" height="52" rx="8"/><text x="14" y="232">message_log</text></g>
                <g className="lookup-match"><rect x="168" y="93" width="144" height="128" rx="12" fill="url(#lookup-fill)"/><text x="240" y="123" textAnchor="middle">Match order</text><rect x="184" y="139" width="112" height="36" rx="5" className="lookup-key"/><text x="240" y="163" textAnchor="middle" className="lookup-key-text">#1048</text><text x="240" y="201" textAnchor="middle" className="lookup-label">Read-only</text></g>
                <g className="lookup-output"><rect x="350" y="111" width="129" height="92" rx="10"/><path d="M367 131h15 M367 137h22 M367 143h18"/><text x="414" y="169" textAnchor="middle">Evidence</text><text x="414" y="191" textAnchor="middle" className="lookup-label">Cited report</text></g>
                <path className="lookup-bracket" d="M168 240v12h311v-12"/><text x="324" y="282" textAnchor="middle" className="lookup-label">Only matched records</text>
              </svg>
            </div>
            <p className="landing-query-note landing-muted">Schema review identifies the fields. Row searches require a configured evidence connector.</p>
          </div>
          <div className="landing-principles">{principles.map(({ icon: Icon, title, description }) => <article className="landing-principle" key={title}><Icon className="landing-principle-icon" size={28} strokeWidth={1.5} aria-hidden="true" /><div><h3>{title}</h3><p>{description}</p></div></article>)}</div>
        </div></section>
        <section className="landing-controls landing-container" id="access-control" aria-labelledby="control-title">
          <div className="landing-control-panel"><div className="landing-caption-row"><p className="landing-eyebrow">Access &amp; control</p><p className="landing-muted">Design preview</p></div><div className="landing-control-grid">
            <div className="landing-control-copy"><h2 id="control-title">Access you can<br />inspect.</h2><p className="landing-muted">Choose the records an investigation may use. Additional access requires independent approval.</p><p className="landing-medium">Scoped results. External enforcement.<br />An activity trail you can inspect.</p></div>
            <dl className="landing-scope-list"><div><dt>Order #1048<span>Payment, fulfilment, relevant policy</span></dt><dd>Allowed</dd></div><div><dt>Other customer records<span>Unrelated emails and transactions</span></dt><dd>Excluded</dd></div><div><dt>More delivery evidence<span>A new scope request</span></dt><dd>Approval required</dd></div></dl>
          </div><p className="landing-control-note landing-muted">The investigator cannot approve its own access. Controls shown reflect the planned access model.</p></div>
          <div className="landing-outcome-band"><h2>Protect revenue. Reduce investigation costs.</h2><p>Prepared by Causality. Approved by you.</p></div>
        </section>
      </main>
      <div className="landing-footer-runway"><footer className="landing-footer"><div className="landing-container"><div className="landing-footer-top"><h2>Build your next case<br />on the full story.</h2><AccessButton /></div><ReceiptReveal /><div className="landing-footer-bottom"><p>© 2026 Causality</p><p>Evidence. Context. Judgment.</p><nav aria-label="Footer navigation"><a href="#sample-report">Sample report</a><a href="#access-control">Access &amp; control</a><a href="#top">Back to top ↑</a></nav></div></div></footer></div>
    </div>
  );
}
