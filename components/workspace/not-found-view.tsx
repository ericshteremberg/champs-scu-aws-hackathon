import Link from "next/link";
import { ArrowLeft, ArrowRight, FileQuestion } from "lucide-react";
import "./workspace.css";

export default function NotFoundView() {
  return <main className="cw cw-login" data-design-screen="page-not-found"><Link className="cw-brand" href="/"><span className="cw-mark">C</span>Causality</Link><div className="cw-panel cw-recovery"><div className="cw-empty"><span className="cw-icon-well"><FileQuestion size={26}/></span><span className="cw-eyebrow">PAGE NOT FOUND · 404</span><h1>Page not found</h1><p>Check the address or return to your workspace.</p><div className="cw-actions"><Link className="cw-button" href="/"><ArrowLeft size={18}/>Home</Link><a className="cw-button primary" href="/workspace">Open workspace<ArrowRight size={18}/></a></div></div></div></main>;
}
