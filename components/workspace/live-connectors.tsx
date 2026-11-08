"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Database, Link2, LoaderCircle, LockKeyhole, Plus, RefreshCw, ShieldCheck, TriangleAlert, Unplug, X } from "lucide-react";
import type { WorkspaceState } from "@/lib/domain";
import type { ManagedConnection } from "@/lib/evidence-connectors/live-types";
import "./live-connectors.css";

async function request<T>(body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/connectors/live", {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "The connection request could not finish. Try again.";
    throw new Error(message);
  }
  return data as T;
}

function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not verified" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LiveEvidenceConnectors({ onImported }: { onImported: (state: WorkspaceState, caseId: string) => void }) {
  const [connections, setConnections] = useState<ManagedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [externalCaseId, setExternalCaseId] = useState("");
  const [token, setToken] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    request<{ connections: ManagedConnection[] }>(undefined, controller.signal)
      .then(data => setConnections(data.connections))
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Connections could not load."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => { if (open) nameInput.current?.focus(); }, [open]);

  function update(connection: ManagedConnection) {
    setConnections(current => [connection, ...current.filter(item => item.id !== connection.id)]);
  }
  function close() { setToken(""); setOpen(false); setError(""); }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    let url: URL;
    try { url = new URL(baseUrl.trim()); }
    catch { setError("Enter the HTTPS base URL of your installed connector."); return; }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      setError("Use an HTTPS base URL without credentials, query parameters, or a fragment."); return;
    }
    const accessToken = token.trim();
    setToken(""); setBusy("connect");
    try {
      const result = await request<{ connection: ManagedConnection }>({ action: "connect", name: name.trim(), baseUrl: url.toString().replace(/\/+$/, ""), externalCaseId: externalCaseId.trim(), token: accessToken });
      update(result.connection); setOpen(false); setName(""); setBaseUrl(""); setExternalCaseId("");
      setNotice(`${result.connection.name} is connected. Its approved case and payment link were verified.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The connection could not be verified. Re-enter the access token to try again."); }
    finally { setBusy(""); }
  }
  async function action(item: ManagedConnection, operation: "recheck" | "disconnect" | "import") {
    if (busy) return;
    setBusy(`${operation}:${item.id}`); setError(""); setNotice("");
    setFailures(current => { const next = { ...current }; delete next[item.id]; return next; });
    try {
      if (operation === "import") {
        const result = await request<{ caseId: string; state: WorkspaceState }>({ action: operation, connectionId: item.id });
        onImported(result.state, result.caseId);
      } else {
        const result = await request<{ connection: ManagedConnection }>({ action: operation, connectionId: item.id });
        update(result.connection); setConfirmDisconnect(null);
        setNotice(operation === "disconnect" ? `${item.name} is disconnected. Existing case evidence remains in this workspace.` : `${item.name} verified successfully.`);
      }
    } catch (cause) { setFailures(current => ({ ...current, [item.id]: cause instanceof Error ? cause.message : "This connection needs attention. Try again." })); }
    finally { setBusy(""); }
  }
  async function retry() {
    setBusy("load"); setError("");
    try { setConnections((await request<{ connections: ManagedConnection[] }>()).connections); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Connections could not load."); }
    finally { setBusy(""); }
  }

  return <section className="cw-panel cw-live-connectors" aria-label="Installed evidence connections">
    <header className="cw-live-heading">
      <div><span className="cw-live-eyebrow"><Database size={14} />Your workspace connections</span><h2>Bring your own evidence.</h2><p>Connect an installed endpoint, verify its approved case, and manage access here.</p></div>
      <button type="button" className={`cw-button${open ? "" : " primary"}`} disabled={!!busy || loading} onClick={open ? close : () => { setOpen(true); setError(""); setNotice(""); }}>
        {open ? <X size={17} /> : <Plus size={17} />}{open ? "Close connection form" : "Connect installed endpoint"}
      </button>
    </header>
    {error && <div className="cw-banner error cw-live-message" role="alert"><TriangleAlert size={18} /><div><p>{error}</p>{!open && <button type="button" className="cw-button small" disabled={!!busy} onClick={() => void retry()}>Retry connections</button>}</div></div>}
    {notice && <div className="cw-banner cw-live-message" role="status"><Check size={18} /><p>{notice}</p></div>}
    {open && <form onSubmit={event => void connect(event)} className="cw-live-form">
      <fieldset disabled={!!busy}>
        <legend>Connect your installed connector</legend>
        <p className="cw-live-setup-note">Your connector must already be running at a public HTTPS address. Each connection is limited to one approved case.</p>
        <div className="cw-live-form-grid">
          <label className="cw-field"><span>Connection name</span><input ref={nameInput} required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="ATMSPHR evidence" autoComplete="off" /></label>
          <label className="cw-field"><span>Approved case ID</span><input required maxLength={200} pattern="[A-Za-z0-9_-]+" value={externalCaseId} onChange={event => setExternalCaseId(event.target.value)} placeholder="dispute_1042" autoComplete="off" spellCheck={false} /></label>
          <label className="cw-field cw-live-wide"><span>Connector HTTPS base URL</span><input type="url" required maxLength={2048} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://evidence.yourcompany.com" autoComplete="off" spellCheck={false} /><small>The address where your connector is installed. Leave off the case-specific route.</small></label>
          <label className="cw-field cw-live-wide"><span>Approved-case access token</span><input type="password" required minLength={32} maxLength={2048} value={token} onChange={event => setToken(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste the token issued by your connector" /><small>Use the connector token for this case. Database passwords and Supabase service keys do not belong here. This field clears after each verification attempt.</small></label>
        </div>
        <div className="cw-live-form-footer"><p><LockKeyhole size={16} />We verify the case, business, order, and payment before saving this connection.</p><button type="submit" className="cw-button primary" disabled={!!busy || !name.trim() || !baseUrl.trim() || !externalCaseId.trim() || token.trim().length < 32}>{busy === "connect" ? <LoaderCircle size={17} /> : <ShieldCheck size={17} />}{busy === "connect" ? "Verifying connection…" : "Verify and connect"}</button></div>
      </fieldset>
    </form>}
    {loading ? <div className="cw-live-empty" role="status"><LoaderCircle size={16} />Loading installed connections…</div> : connections.length ? <div className="cw-live-list">
      {connections.map(item => <article className="cw-live-connection" key={item.id} aria-label={`Connection ${item.name}`}>
        <div className="cw-live-row-heading"><div><div className="cw-live-title"><Link2 size={18} /><h3>{item.name}</h3><span className={`cw-pill${item.status === "connected" ? " green" : ""}`}>{item.status === "connected" ? "Connected" : "Disconnected"}</span></div><p className="cw-live-url">{item.baseUrl}</p></div><span className="cw-live-verified">Last verified {stamp(item.verifiedAt)}</span></div>
        <dl className="cw-live-metadata"><div><dt>Business</dt><dd>{item.merchantName}</dd></div><div><dt>Approved case</dt><dd>{item.externalCaseId}</dd></div><div><dt>Order</dt><dd>{item.orderRef}</dd></div><div><dt>Payment</dt><dd>{item.paymentRef}</dd></div></dl>
        {failures[item.id] && <div className="cw-banner error" role="alert"><TriangleAlert size={18} /><p>{failures[item.id]}</p></div>}
        {confirmDisconnect === item.id ? <div className="cw-live-disconnect"><p>Disconnect this endpoint? Future evidence requests through this connection will stop. Existing imported records stay in your workspace.</p><div className="cw-actions"><button type="button" className="cw-button" disabled={!!busy} onClick={() => setConfirmDisconnect(null)}>Keep connection</button><button type="button" className="cw-button danger" disabled={!!busy} onClick={() => void action(item, "disconnect")}>{busy === `disconnect:${item.id}` ? <LoaderCircle size={16} /> : <Unplug size={16} />}Confirm disconnect</button></div></div> : <div className="cw-actions">
          <button type="button" className="cw-button primary" disabled={!!busy || item.status !== "connected"} onClick={() => void action(item, "import")}>{busy === `import:${item.id}` ? <LoaderCircle size={16} /> : <ArrowRight size={16} />}Import approved case</button>
          <button type="button" className="cw-button" disabled={!!busy || item.status !== "connected"} onClick={() => void action(item, "recheck")}><RefreshCw size={16} />{busy === `recheck:${item.id}` ? "Verifying…" : "Verify again"}</button>
          {item.status === "connected" ? <button type="button" className="cw-button" disabled={!!busy} onClick={() => setConfirmDisconnect(item.id)}><Unplug size={16} />Disconnect</button> : <button type="button" className="cw-button" disabled={!!busy} onClick={() => { setName(item.name); setBaseUrl(item.baseUrl); setExternalCaseId(item.externalCaseId); setToken(""); setOpen(true); setNotice(""); setError(""); }}>Reconnect with a new token</button>}
        </div>}
      </article>)}
    </div> : !open && !error && <div className="cw-live-empty"><p>No installed endpoints connected yet. Use guided setup below to prepare a connector, then add its URL and approved-case token here.</p></div>}
  </section>;
}
