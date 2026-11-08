"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, ChevronRight, Clock3, CreditCard, FileText, Folder, Inbox, Link2, LockKeyhole, Mail, Package, Pause, Play, RotateCcw, Send, ShieldCheck, Sparkles } from "lucide-react";
import "./product-demo.css";

const duration = 24400;
const playbackRate = 2.3;
const chapters = [
  { id: "open", label: "Open case", short: "Open", start: 0, preview: 1200, title: "Start with the dispute.", description: "One case, with the payment and the customer in context.", camera: [1, 0, 0] },
  { id: "inspect", label: "Inspect evidence", short: "Inspect", start: 3600, preview: 6000, title: "Read the original evidence.", description: "Inspect the customer’s own words, not just a summary.", camera: [1.22, -238, -85] },
  { id: "compile", label: "Compile response", short: "Compile", start: 8200, preview: 11600, title: "Connect the whole story.", description: "Bring the sources together. Keep the contradictions visible.", camera: [1.15, -166, -40] },
  { id: "approve", label: "Approve response", short: "Approve", start: 12600, preview: 16600, title: "Your judgment comes first.", description: "Review the draft and its sources before approving a response.", camera: [1.24, -263, -88] },
  { id: "submit", label: "Submit to Stripe", short: "Submit", start: 17800, preview: 22600, title: "Submit only when you decide.", description: "A separate submission produces a receipt. The issuer still decides the dispute.", camera: [1.14, -160, -34] },
];
const beats = [
  { at: 0, target: "queue-row" },
  { at: 1200, target: "open-case" },
  { at: 2500, target: "open-case", click: true },
  { at: 3600, target: "source-mail" },
  { at: 4700, target: "source-mail", click: true },
  { at: 5900, target: "attach-source" },
  { at: 7100, target: "attach-source", click: true },
  { at: 8200, target: "compile-response" },
  { at: 9200, target: "compile-response" },
  { at: 10000, target: "compile-response" },
  { at: 11200, target: "compile-response", click: true },
  { at: 12600, target: "approve-response" },
  { at: 14900, target: "approve-response", click: true },
  { at: 16400, target: "approval-status" },
  { at: 17800, target: "submit-package" },
  { at: 19700, target: "submit-package", click: true },
  { at: 20700, target: "stripe-receipt" },
  { at: 22200, target: "stripe-receipt" },
];
const indexAt = (time: number) => Math.max(0, beats.findLastIndex(beat => beat.at <= time));
const chapterAt = (time: number) => Math.max(0, chapters.findLastIndex(chapter => chapter.start <= time));

function DemoBrand() {
  return <span className="pd-brand"><span className="pd-brand-mark">C</span>Causality</span>;
}

function QueueScene() {
  return <>
    <div className="pd-view-heading"><div><p className="pd-eyebrow">ASTER SUPPLY</p><h3>Cases</h3></div><span className="pd-soft-pill"><span className="pd-status-dot" />3 need attention</span></div>
    <div className="pd-view-tabs"><span className="pd-tab-active">Needs attention <span>3</span></span><span>In progress</span><span>Submitted</span></div>
    <div className="pd-queue-table">
      <div className="pd-queue-head"><span>Customer / order</span><span>Reason</span><span>Amount</span><span>Next step</span></div>
      <div className="pd-queue-row pd-selected-row" data-pointer-target="queue-row"><div><span className="pd-avatar">AM</span><div><strong>Alex Morgan</strong><span>Order #1048 · 17 Oct</span></div></div><span>Product not received</span><strong>$248.00</strong><span className="pd-mock-button pd-button-ink" data-pointer-target="open-case">Investigate <ArrowRight size={16} /></span></div>
      <div className="pd-queue-row"><div><span className="pd-avatar pd-avatar-muted">JK</span><div><strong>Jordan Kim</strong><span>Order #1043 · 16 Oct</span></div></div><span>Duplicate charge</span><strong>$86.00</strong><span className="pd-muted">Review evidence</span></div>
      <div className="pd-queue-row"><div><span className="pd-avatar pd-avatar-muted">SR</span><div><strong>Sam Rivera</strong><span>Order #1039 · 15 Oct</span></div></div><span>Credit not processed</span><strong>$124.00</strong><span className="pd-muted">Review evidence</span></div>
    </div>
    <div className="pd-queue-context"><div><ShieldCheck size={22} /><div><strong>Start with the facts.</strong><p>Every investigation stays scoped to its customer and transaction.</p></div></div><span className="pd-context-tag"><LockKeyhole size={16} /> Read-only sources</span></div>
  </>;
}

function InspectScene({ attached }: { attached: boolean }) {
  return <>
    <div className="pd-view-heading"><div><p className="pd-eyebrow">ORDER #1048 · ALEX MORGAN</p><h3>Product not received</h3></div><div className="pd-amount"><strong>$248.00</strong><span>Amount disputed</span></div></div>
    <div className="pd-view-tabs"><span>Overview</span><span className="pd-tab-active">Evidence <span>3</span></span><span>Response</span></div>
    <div className="pd-evidence-layout">
      <div className="pd-source-list">
        <div className="pd-source-row"><CreditCard size={20} /><div><strong>Payment captured</strong><span>Stripe · E1</span></div></div>
        <div className="pd-source-row"><Package size={20} /><div><strong>Marked delivered</strong><span>Carrier scan · E2</span></div></div>
        <div className="pd-source-row pd-source-selected" data-pointer-target="source-mail"><Mail size={20} /><div><strong>Customer email</strong><span>Original message · E3</span></div><ChevronRight size={17} /></div>
        <div className="pd-scope-note"><LockKeyhole size={16} /><span>Order #1048 only.<br />Three permitted records.</span></div>
      </div>
      <div className="pd-original-message">
        <div className="pd-message-header"><span><Mail size={16} /> Gmail · Original source</span><span className="pd-source-id">E3</span></div>
        <div className="pd-message-content"><strong>Re: Order #1048</strong><p className="pd-muted">Alex Morgan &lt;alex@example.com&gt; · 17 Oct</p><p>Hi Aster team,</p><p>My order never arrived. The tracking says delivered, but there’s nothing at the door or with my neighbors. Can you help?</p><p>Thanks, Alex</p></div>
        <div className="pd-source-conflict"><span className="pd-small-dot" />Customer statement conflicts with carrier scan.</div>
        <div className="pd-message-action"><span className="pd-muted">No recipient signature in E2.</span><span className={`pd-mock-button ${attached ? "pd-button-approved" : "pd-button-ink"}`} data-pointer-target="attach-source">{attached ? <><Check size={16} /> Added to case</> : <>Add to case <ArrowRight size={16} /></>}</span></div>
      </div>
    </div>
  </>;
}

function CompileScene({ count, compiling }: { count: number; compiling: boolean }) {
  const sources = [
    { Icon: CreditCard, title: "Payment captured", detail: "$248.00 · 12 Oct", source: "Stripe · E1" },
    { Icon: Package, title: "Carrier reports delivery", detail: "No recipient signature", source: "Carrier scan · E2" },
    { Icon: Mail, title: "Customer denies receipt", detail: "Original message preserved", source: "Customer email · E3" },
  ];
  return <>
    <div className="pd-view-heading"><div><p className="pd-eyebrow">ORDER #1048 · INVESTIGATION</p><h3>Assemble the evidence</h3></div><span className="pd-soft-pill"><Link2 size={16} />{count} sources linked</span></div>
    <div className="pd-compile-layout">
      <div className="pd-manifest"><div className="pd-panel-heading"><Folder size={18} />Case evidence</div>{sources.map(({ Icon, title, detail, source }, index) => <div className={`pd-manifest-row ${count > index ? "pd-record-ready" : "pd-record-waiting"}`} key={title}><span className="pd-file-icon"><Icon size={22} /></span><div><strong>{title}</strong><p>{detail}</p><span className="pd-source-id">{source}</span></div><Link2 size={17} /></div>)}</div>
      <div className={`pd-response-preview ${compiling ? "pd-response-compiled" : ""}`}><div className="pd-panel-heading"><FileText size={18} />Draft response</div><div className="pd-paper-preview"><span className="pd-paper-label">ASTER SUPPLY / CASE #1048</span><h4>A response grounded<br />in the record.</h4>{compiling ? <><p>The payment was captured and the carrier marked the shipment delivered. <span className="pd-citation">E1</span> <span className="pd-citation">E2</span></p><p>The customer disputes receipt. No recipient signature is available. <span className="pd-citation">E3</span></p><div className="pd-draft-stamp">Draft · Merchant review required</div></> : <div className="pd-draft-lines"><i /><i /><i /><i /><i /><i /></div>}</div></div>
    </div>
    <div className="pd-scene-action"><p><Link2 size={16} />Findings retain their original sources.</p><span className="pd-mock-button pd-button-ink" data-pointer-target="compile-response"><Sparkles size={16} />{compiling ? "Response prepared" : "Prepare response"}</span></div>
  </>;
}

function ApproveScene({ approved }: { approved: boolean }) {
  return <>
    <div className="pd-view-heading"><div><p className="pd-eyebrow">ORDER #1048 · RESPONSE</p><h3>Merchant review</h3></div><span className={`pd-soft-pill ${approved ? "pd-approved-pill" : ""}`}>{approved ? <Check size={16} /> : <Clock3 size={16} />}{approved ? "Approved" : "Review required"}</span></div>
    <div className="pd-review-layout"><article className="pd-review-document"><div className="pd-document-top"><FileText size={18} /><strong>Response for order #1048</strong><span>Draft v1</span></div><p>Aster Supply captured a payment of <strong>$248.00 on 12 October</strong> for order #1048. <span className="pd-citation">E1</span></p><p>The carrier records delivery on 16 October. The customer subsequently reported that the package had not arrived. <span className="pd-citation">E2</span> <span className="pd-citation">E3</span></p><p>The records establish a delivery scan, <strong>but do not establish that the customer received the package.</strong> No recipient signature is included in the available evidence.</p><div className="pd-document-source-footer"><Link2 size={16} />3 citations · Original records attached</div></article><aside className="pd-review-checks"><strong>Ready for your judgment.</strong><div><Check size={17} /><span>Conflicting evidence included</span></div><div><Check size={17} /><span>Unsupported claims removed</span></div><div><Check size={17} /><span>Every finding source-linked</span></div><p>Approval prepares this version for submission. It does not send anything to Stripe.</p></aside></div>
    <div className="pd-approval-bar"><span data-pointer-target="approval-status">{approved ? <><span className="pd-avatar pd-avatar-small">AM</span><span><strong>Approved by merchant</strong><br />This version is ready to submit.</span></> : <><ShieldCheck size={22} /><span>Your review. Your decision.</span></>}</span><span className={`pd-mock-button ${approved ? "pd-button-approved" : "pd-button-orange"}`} data-pointer-target="approve-response">{approved ? <><Check size={16} /> Approval recorded</> : <>Approve response <ArrowRight size={16} /></>}</span></div>
  </>;
}

function SubmitScene({ submitting, received }: { submitting: boolean; received: boolean }) {
  return <>
    <div className="pd-view-heading"><div><p className="pd-eyebrow">ORDER #1048 · SUBMISSION</p><h3>{received ? "Received by Stripe." : "Send the reviewed package."}</h3></div><span className="pd-soft-pill"><ShieldCheck size={16} />Merchant approved</span></div>
    <div className={`pd-submission-layout ${submitting ? "pd-is-submitting" : ""} ${received ? "pd-is-received" : ""}`}>
      <div className="pd-package-area"><div className="pd-case-package"><div className="pd-package-top"><span className="pd-file-icon"><FileText size={24} /></span><div><strong>Evidence package</strong><p>Order #1048 · Reviewed version</p></div></div><div className="pd-package-row"><Check size={16} />Merchant-approved response</div><div className="pd-package-row"><Link2 size={16} />3 original source records</div><div className="pd-package-row"><LockKeyhole size={16} />Approval &amp; activity trail</div><div className="pd-package-footer">Prepared by Causality.</div></div><div className="pd-submission-outcome"><Send size={28} /><h4>Evidence submitted.<br />Decision pending.</h4><p>The bank’s review is still pending. A submission receipt is not a dispute outcome.</p></div></div>
      <div className="pd-submission-connector"><ArrowRight size={26} /><span className="pd-transfer-dot" /></div>
      <div className={`pd-stripe-receipt ${received ? "pd-receipt-received" : ""}`} data-pointer-target="stripe-receipt"><div className="pd-stripe-header"><strong>stripe</strong><span className="pd-source-id">SIMULATED RECEIPT</span></div><div className="pd-receipt-state"><span className="pd-receipt-status-icon">{received ? <Check size={24} /> : <Inbox size={24} />}</span><strong>{received ? "Evidence received" : "Awaiting your submission"}</strong></div><dl><div><dt>Dispute</dt><dd>demo_1048</dd></div><div><dt>Amount</dt><dd>$248.00 USD</dd></div><div><dt>Receipt</dt><dd>{received ? "rcpt_demo_1048" : "—"}</dd></div><div><dt>Review</dt><dd>{received ? "Pending issuer review" : "Not submitted"}</dd></div></dl><p><Clock3 size={16} />{received ? "The issuer determines the outcome." : "Approval and submission are separate."}</p></div>
    </div>
    <div className="pd-scene-action"><p><LockKeyhole size={16} />This walkthrough sends no data to Stripe.</p><span className={`pd-mock-button ${received ? "pd-button-approved" : "pd-button-ink"}`} data-pointer-target="submit-package">{received ? <><Check size={16} /> Receipt recorded</> : submitting ? <>Submitting package…</> : <>Submit to Stripe <Send size={16} /></>}</span></div>
  </>;
}

export function ProductDemo() {
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const elapsed = useRef(0);
  const beatRef = useRef(0);
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [manual, setManual] = useState(false);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [scale, setScale] = useState(1);
  const [pointer, setPointer] = useState({ x: 360, y: 510 });
  const time = beats[beat].at;
  const chapter = chapterAt(time);
  const scene = chapters[chapter];
  const running = playing && inView && visible && !reduced;

  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => { setReduced(preference.matches); if (preference.matches) setPlaying(false); };
    const updateVisibility = () => setVisible(!document.hidden);
    updatePreference(); updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    const visibility = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= .2), { threshold: [.2, .5] });
    if (rootRef.current) visibility.observe(rootRef.current);
    const resize = new ResizeObserver(([entry]) => setScale(Math.min(entry.contentRect.width / 1296, entry.contentRect.height / 680)));
    if (stageRef.current) resize.observe(stageRef.current);
    return () => { preference.removeEventListener("change", updatePreference); document.removeEventListener("visibilitychange", updateVisibility); visibility.disconnect(); resize.disconnect(); };
  }, []);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      elapsed.current = Math.min(duration, elapsed.current + Math.min(now - previous, 80) * playbackRate);
      previous = now;
      const next = indexAt(elapsed.current);
      if (next !== beatRef.current) { beatRef.current = next; setBeat(next); }
      if (progressRef.current) progressRef.current.style.transform = `scaleX(${elapsed.current / duration})`;
      if (elapsed.current >= duration) { setPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const camera = cameraRef.current;
      const target = camera?.querySelector<HTMLElement>(`[data-pointer-target="${beats[beat].target}"]`);
      if (!camera || !target) return;
      const cameraBox = camera.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const currentScale = cameraBox.width / 1296;
      setPointer({ x: (targetBox.left + targetBox.width * .65 - cameraBox.left) / currentScale, y: (targetBox.top + targetBox.height * .58 - cameraBox.top) / currentScale });
    });
    return () => cancelAnimationFrame(frame);
  }, [beat, scale]);

  useEffect(() => {
    if (manual) return;
    for (const animation of rootRef.current?.getAnimations({ subtree: true }) ?? []) {
      if (running) animation.play();
      else animation.pause();
    }
  }, [running, beat, manual]);

  const seek = useCallback((time: number, play = false) => {
    elapsed.current = time;
    const next = indexAt(time);
    beatRef.current = next; setBeat(next); setPlaying(play && !reduced); setManual(!play);
    if (progressRef.current) progressRef.current.style.transform = `scaleX(${time / duration})`;
  }, [reduced]);

  const [zoom, x, y] = reduced ? [1, 0, 0] : scene.camera;
  return <section className="product-demo" ref={rootRef} tabIndex={0} data-scene={scene.id} data-beat={beat} data-playing={running} data-manual={manual} aria-label="Causality product walkthrough. Use arrow keys to explore scenes." onKeyDown={event => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); seek(chapters[Math.min(4, Math.max(0, chapter + (event.key === "ArrowRight" ? 1 : -1)))].preview); }
    if (event.key === "Home") { event.preventDefault(); seek(0); }
  }}>
    <div className="pd-stage" ref={stageRef} aria-hidden="true"><div className="pd-stage-glow" /><div className="pd-camera" ref={cameraRef} style={{ left: `calc(50% - ${648 * scale}px)`, transform: `scale(${scale}) translate3d(${x}px,${y}px,0) scale(${zoom})` } as CSSProperties}>
      <div className="pd-window"><div className="pd-window-bar"><div className="pd-window-dots"><i /><i /><i /></div><span>Causality — Aster Supply</span><span><LockKeyhole size={14} /> Synthetic workspace</span></div><div className="pd-window-body"><aside className="pd-sidebar"><DemoBrand /><div className="pd-sidebar-nav"><span className="pd-sidebar-selected"><Inbox size={18} />Cases</span><span><FileText size={18} />Evidence</span><span><ShieldCheck size={18} />Access</span></div><div className="pd-sidebar-case"><span>CURRENT CASE</span><strong>Order #1048</strong><span>Aster Supply</span><span>$248.00</span></div><div className="pd-sidebar-bottom"><span className="pd-avatar pd-avatar-small">AS</span><div><strong>Aster Supply</strong><span>Demo workspace</span></div></div></aside><div className="pd-main">
        <div className="pd-view" data-active={chapter === 0}><QueueScene /></div>
        <div className="pd-view" data-active={chapter === 1}><InspectScene attached={time >= 7100} /></div>
        <div className="pd-view" data-active={chapter === 2}><CompileScene count={time >= 10000 ? 3 : time >= 9200 ? 2 : 1} compiling={time >= 11200 || (reduced && chapter === 2)} /></div>
        <div className="pd-view" data-active={chapter === 3}><ApproveScene approved={time >= 16400} /></div>
        <div className="pd-view" data-active={chapter === 4}><SubmitScene submitting={time >= 20700 || (reduced && chapter === 4)} received={time >= 22200 || (reduced && chapter === 4)} /></div>
      </div></div></div>
      <div className="pd-pointer" style={{ transform: `translate3d(${pointer.x}px,${pointer.y}px,0)`, opacity: time >= 22200 || reduced ? 0 : 1 }}><svg width="17" height="22" viewBox="0 0 25 31"><path d="M2 2V24L8 18L13 29L18 26L13 16H22Z" fill="#181818" stroke="white" strokeWidth="2" strokeLinejoin="round" /></svg>{beats[beat].click && <span className="pd-pointer-click" key={beat} />}</div>
    </div><div className="pd-overlay-controls"><button type="button" className="pd-play-button" aria-label={playing ? "Pause walkthrough" : "Play walkthrough"} onClick={() => { setManual(false); if (elapsed.current >= duration) seek(0, true); else setPlaying(value => !value); }}>{playing ? <Pause size={16} /> : <Play size={16} />}</button><button type="button" aria-label="Replay walkthrough" onClick={() => seek(0, true)}><RotateCcw size={16} /></button><button type="button" className="pd-reduced-next" aria-label="Next walkthrough scene" onClick={() => seek(chapters[(chapter + 1) % chapters.length].preview)}><ArrowRight size={16} /></button></div><div className="pd-player-progress"><div ref={progressRef} /></div></div>
    <p className="pd-accessible-description">{scene.title} {scene.description}</p>
  </section>;
}
