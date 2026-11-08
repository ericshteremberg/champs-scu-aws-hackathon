import { ArrowRight, Check, Fingerprint } from "lucide-react";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import "@/components/workspace/workspace.css";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getChatGPTUser();
  if (user) redirect("/workspace");
  return <main className="cw-login cw">
    <a className="cw-brand" href="/"><span className="cw-mark">C</span>Causality</a>
    <div className="cw-login-grid">
      <section className="cw-login-story"><span className="cw-eyebrow">THE FULL STORY STARTS HERE</span><h1>Every case.<br />In context.</h1><p>Connect the evidence, understand what happened, and prepare a response your team can stand behind.</p><ul><li><Check size={18} />A workspace for your investigations</li><li><Check size={18} />Source-linked evidence and clear findings</li><li><Check size={18} />Your review before any submission</li></ul><img src="/causality/causality-investigation-detail.png" alt="Causality investigation workspace showing a timeline beside its original evidence" /></section>
      <section className="cw-login-card"><span className="cw-icon-well"><Fingerprint size={28} /></span><h2>Welcome to Causality.</h2><p>Sign in securely to create your workspace or pick up where you left off.</p><a className="cw-button primary full" href={chatGPTSignInPath("/workspace")} target="_top">Continue with ChatGPT<ArrowRight size={18} /></a><p className="cw-caption">Secure sign-in is provided by ChatGPT. Your workspace data stays scoped to your account.</p><div className="cw-rule" /><a className="cw-text-link" href="/">Back to the full story <ArrowRight size={16} /></a></section>
    </div>
    <footer className="cw-login-footer"><span>© {new Date().getFullYear()} Causality</span><span>Evidence. Context. Judgment.</span></footer>
  </main>;
}
