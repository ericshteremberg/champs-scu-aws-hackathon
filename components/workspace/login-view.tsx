import Link from "next/link";
import { ArrowRight, Fingerprint } from "lucide-react";
import "./workspace.css";

export default function LoginView({signInPath}: {signInPath:string}) {
  return <main className="cw-login cw">
    <Link className="cw-brand" href="/"><span className="cw-mark">C</span>Causality</Link>
    <div className="cw-login-grid">
      <section className="cw-login-story"><h1>Resolve disputes.<br />Start with evidence.</h1><p>Investigate cases and prepare responses for review.</p><img src="/causality/causality-investigation-detail.png" alt="Case timeline and source evidence" /></section>
      <section className="cw-login-card"><span className="cw-icon-well"><Fingerprint size={28} /></span><h2>Sign in</h2><p>Open or create your workspace.</p><a className="cw-button primary full" href={signInPath} target="_top">Continue with ChatGPT<ArrowRight size={18} /></a><div className="cw-rule" /><Link className="cw-text-link" href="/">Back to home <ArrowRight size={16} /></Link></section>
    </div>
    <footer className="cw-login-footer"><span>© {new Date().getFullYear()} Causality</span></footer>
  </main>;
}
