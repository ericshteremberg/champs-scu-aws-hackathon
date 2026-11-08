import Link from "next/link";
import { ArrowRight, Check, Fingerprint } from "lucide-react";
import "./workspace.css";

export default function LoginView({signInPath}: {signInPath:string}) {
  return <main className="cw-login cw">
    <Link className="cw-brand" href="/"><span className="cw-mark">C</span>Causality</Link>
    <div className="cw-login-grid">
      <section className="cw-login-story"><span className="cw-eyebrow">THE FULL STORY STARTS HERE</span><h1>Every case.<br />In context.</h1><p>Connect the evidence, understand what happened, and prepare a response your team can stand behind.</p><ul><li><Check size={18} />A workspace for your investigations</li><li><Check size={18} />Source-linked evidence and clear findings</li><li><Check size={18} />Your review before any submission</li></ul><img src="/causality/causality-investigation-detail.png" alt="Causality investigation workspace showing a timeline beside its original evidence" /></section>
      <section className="cw-login-card"><span className="cw-icon-well"><Fingerprint size={28} /></span><h2>Welcome to Causality.</h2><p>Sign in securely to create your workspace or pick up where you left off.</p><a className="cw-button primary full" href={signInPath} target="_top">Continue with ChatGPT<ArrowRight size={18} /></a><p className="cw-caption">Secure sign-in is provided by ChatGPT. Your workspace data stays scoped to your account.</p><div className="cw-rule" /><Link className="cw-text-link" href="/">Back to the full story <ArrowRight size={16} /></Link></section>
    </div>
    <footer className="cw-login-footer"><span>© {new Date().getFullYear()} Causality</span><span>Evidence. Context. Judgment.</span></footer>
  </main>;
}
