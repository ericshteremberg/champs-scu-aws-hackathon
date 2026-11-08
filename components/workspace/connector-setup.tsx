"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Database,
  Download, FileJson, Link2, LoaderCircle, LockKeyhole, Plus,
  RefreshCw, ShieldCheck, Ticket, TriangleAlert, Warehouse, X,
} from "lucide-react";
import type { WorkspaceState } from "@/lib/domain";
import type {
  ConnectorManifest, ConnectorPreview, ConnectorSchemaTable,
  ConnectorTemplate, OrderMapping, SectionMapping,
} from "@/lib/evidence-connectors/types";
import type { EvidenceConnection as PublicConnection } from "@/lib/evidence-connectors/api-types";
import "./connector-setup.css";

type SetupFiles = { files: { name: string; content: string }[]; instructions: string[] };
type ConnectorList = { templates: ConnectorTemplate[]; connections: PublicConnection[]; storage: string; setupMode: string };
type SectionKey = keyof ConnectorManifest["sections"];
const steps = ["Choose template", "Confirm mapping", "Preview access", "Installation"];
const sectionNames: Record<string, string> = {
  summary: "Case summary", order: "Purchase or booking", tickets: "Tickets or rental items",
  delivery: "Delivery events", history: "Refund history", support: "Customer messages",
  attendance: "Attendance or handover", policy: "Accepted policies",
};
const orderRoles: [Exclude<keyof OrderMapping, "table">, string][] = [
  ["id", "Record ID"], ["merchantId", "Business ID"], ["orderRef", "Order reference"],
  ["paymentRef", "Payment reference"], ["amount", "Amount in minor units"],
  ["currency", "Currency"], ["purchasedAt", "Purchase date"],
];
const sectionRoles: [Exclude<keyof SectionMapping, "table" | "fields" | "limit" | "title" | "detail">, string][] = [
  ["id", "Record ID"], ["orderId", "Linked order ID"], ["merchantId", "Business ID"],
  ["occurredAt", "Event date"],
];

async function api<T>(body?: object, path = "/api/connectors", signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store", signal,
  });
  const data = await response.json().catch(() => null);
  const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : null;
  if (!response.ok || !data) throw new Error(
    message ?? "The connector setup could not load. Try again.",
  );
  return data as T;
}

function Action({ children, onClick, disabled, primary, label }: {
  children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; label?: string;
}) {
  return <button type="button" className={`cw-button${primary ? " primary" : ""}`} disabled={disabled} onClick={onClick} aria-label={label}>{children}</button>;
}

function download(file: { name: string; content: string }) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.name.endsWith(".json") ? "application/json" : "text/plain" }));
  const link = document.createElement("a");
  link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ColumnSelect({ label, value, columns, onChange }: {
  label: string; value: string; columns: string[]; onChange: (value: string) => void;
}) {
  return <label className="cw-field"><span>{label}</span><select value={value} onChange={event => onChange(event.target.value)}>
    {!columns.includes(value) && <option value={value}>{value} (not in this table)</option>}
    {columns.map(column => <option key={column} value={column}>{column}</option>)}
  </select></label>;
}

function MappingEditor({ manifest, template, onChange }: {
  manifest: ConnectorManifest; template: ConnectorTemplate; onChange: (manifest: ConnectorManifest) => void;
}) {
  const schema: ConnectorSchemaTable[] = template.schema;
  const columns = (table: string) => schema.find(item => item.name === table)?.columns ?? [];
  const updateOrder = (field: keyof OrderMapping, value: string) => onChange({ ...manifest, order: { ...manifest.order, [field]: value } });
  const updateSection = (key: SectionKey, patch: Partial<SectionMapping>) => {
    const current = manifest.sections[key];
    if (current) onChange({ ...manifest, sections: { ...manifest.sections, [key]: { ...current, ...patch } } });
  };
  return <>
    <div className="cw-connector-anchor-grid">
      <div><span>Business boundary</span><code className="cw-connector-technical">{manifest.order.table}.{manifest.order.merchantId}</code></div>
      <div><span>Purchase boundary</span><code className="cw-connector-technical">{manifest.order.table}.{manifest.order.id}</code></div>
      <div><span>Payment match</span><code className="cw-connector-technical">{manifest.order.table}.{manifest.order.paymentRef}</code></div>
    </div>
    <section className="cw-connector-mapping">
      <div className="cw-connector-mapping-head"><h4><LockKeyhole size={16} />Purchase or booking</h4><span className="cw-pill">Required</span></div>
      <div className="cw-connector-mapping-body">
        <p className="cw-connector-note">Each case must match a business, purchase, and payment before evidence is returned.</p>
        <details className="cw-connector-edit"><summary><ChevronDown size={14} />Review purchase mapping <code>{manifest.order.table}</code></summary>
          <div className="cw-connector-editor-grid">
            <ColumnSelect label="Purchase table" value={manifest.order.table} columns={schema.map(item => item.name)} onChange={value => updateOrder("table", value)} />
            {orderRoles.map(([field, label]) => <ColumnSelect key={field} label={label} value={manifest.order[field]} columns={columns(manifest.order.table)} onChange={value => updateOrder(field, value)} />)}
          </div>
        </details>
      </div>
    </section>
    {(Object.entries(template.manifest.sections) as [SectionKey, SectionMapping][]).map(([key, original]) => {
      const mapping = manifest.sections[key];
      return <section className="cw-connector-mapping" key={key}>
        <div className="cw-connector-mapping-head">
          <h4>{sectionNames[key]}</h4>
          <label className="cw-connector-field-choice"><input type="checkbox" checked={!!mapping} onChange={event => {
            const sections = { ...manifest.sections };
            if (event.target.checked) sections[key] = structuredClone(original); else delete sections[key];
            onChange({ ...manifest, sections });
          }} />Include {sectionNames[key].toLowerCase()}</label>
        </div>
        {mapping && <div className="cw-connector-mapping-body">
          <div className="cw-connector-relationship"><code className="cw-connector-technical">{mapping.table}.{mapping.orderId}</code><Link2 size={14} /><code className="cw-connector-technical">{manifest.order.table}.{manifest.order.id}</code><span>Up to {mapping.limit} records</span></div>
          <div className="cw-connector-mapping-fields">
            {Object.entries(original.fields).map(([field, column]) => <label className="cw-connector-field-choice" key={field}>
              <input type="checkbox" checked={field in mapping.fields} disabled={field in mapping.fields && Object.keys(mapping.fields).length === 1} onChange={event => {
                const fields = { ...mapping.fields };
                if (event.target.checked) fields[field] = column; else delete fields[field];
                updateSection(key, { fields });
              }} />{field}
            </label>)}
          </div>
          <details className="cw-connector-edit"><summary><ChevronDown size={14} />Review linked fields</summary><div className="cw-connector-editor-grid">
            <ColumnSelect label={`${sectionNames[key]} table`} value={mapping.table} columns={schema.map(item => item.name)} onChange={table => updateSection(key, { table })} />
            {sectionRoles.map(([field, label]) => <ColumnSelect key={field} label={label} value={mapping[field]} columns={columns(mapping.table)} onChange={value => updateSection(key, { [field]: value })} />)}
            {Object.entries(mapping.fields).map(([field, column]) => <ColumnSelect key={`field-${field}`} label={`${field} source column`} value={column} columns={columns(mapping.table)} onChange={value => updateSection(key, { fields: { ...mapping.fields, [field]: value } })} />)}
          </div></details>
        </div>}
      </section>;
    })}
  </>;
}

function AccessPreview({ preview }: { preview: ConnectorPreview }) {
  const passed = preview.checks.every(check => check.passed);
  return <>
    <div className="cw-connector-section-title"><span>{preview.case.orderRef} · {preview.case.customerLabel}</span><span>{preview.recordCount} permitted records</span></div>
    <div className="cw-connector-boundary">
      <section className="cw-connector-allowed" aria-label="Permitted case evidence">
        <header><ShieldCheck size={19} />This case can read</header>
        {preview.sections.map(section => <div key={section.section}>
          <div className="cw-connector-section-title"><span>{sectionNames[section.section]}</span><span>{section.records.length} record{section.records.length === 1 ? "" : "s"}</span></div>
          {section.records.map(record => <details className="cw-connector-record" key={record.id}>
            <summary>{record.title}</summary><p>{record.detail}</p>
            <p className="cw-connector-technical">{record.source} · {record.sourceId}</p>
            <dl>{Object.entries(record.fields).map(([field, value]) => <div className="cw-connector-dl-row" key={field}><dt>{field}</dt><dd>{value === null ? "Not recorded" : String(value)}</dd></div>)}</dl>
          </details>)}
          {!section.records.length && <div className="cw-connector-record"><p>{section.limitations.join(" ") || "No records available in this section."}</p></div>}
        </div>)}
      </section>
      <aside className="cw-connector-blocked" aria-label="Case access checks">
        <header><LockKeyhole size={19} />Outside this case</header>
        <div className="cw-connector-blocked-body">
          <span className={`cw-pill ${passed ? "green" : "red"}`}>{passed ? "Boundary checks passed" : "Needs attention"}</span>
          <h4>Unrelated case</h4><p className="cw-connector-technical">{preview.deniedCaseId}</p>
          <ul className="cw-connector-checks">{preview.checks.map(check => <li key={check.name}>
            {check.passed ? <Check size={16} /> : <TriangleAlert size={16} />}<div><strong>{check.name}</strong><p>{check.detail}</p></div>
          </li>)}</ul>
          <p>This preview uses fictional records. Live access is tested separately after the connector is installed.</p>
        </div>
      </aside>
    </div>
    {preview.limitations.length > 0 && <div className="cw-banner neutral"><TriangleAlert size={18} /><div>{preview.limitations.map((item, index) => <p key={index}>{item}</p>)}</div></div>}
  </>;
}

export function EvidenceConnectors({ onImported }: { onImported: (state: WorkspaceState, caseId: string) => void }) {
  const [templates, setTemplates] = useState<ConnectorTemplate[]>([]);
  const [connections, setConnections] = useState<PublicConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [manifest, setManifest] = useState<ConnectorManifest | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<ConnectorPreview | null>(null);
  const [saved, setSaved] = useState<PublicConnection | null>(null);
  const [files, setFiles] = useState<SetupFiles | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const template = templates.find(item => item.id === templateId);

  useEffect(() => {
    const controller = new AbortController();
    api<ConnectorList>(undefined, "/api/connectors", controller.signal)
      .then(data => { setTemplates(data.templates); setConnections(data.connections); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Connector setup could not load."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => { if (open) heading.current?.focus(); }, [step, open]);

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "This action could not finish. Try again."); }
    finally { setBusy(false); }
  }
  function choose(item: ConnectorTemplate) {
    setTemplateId(item.id); setName(item.name); setManifest(structuredClone(item.manifest));
    setConfirmed(false); setPreview(null); setSaved(null); setFiles(null);
  }
  function begin(item?: PublicConnection) {
    setError(""); setStep(0); setPreview(null); setSaved(null); setFiles(null); setConfirmed(false);
    if (item) { setTemplateId(item.templateId); setName(item.name); setManifest(structuredClone(item.manifest)); }
    else if (templates[0]) choose(templates[0]);
    setOpen(true);
  }
  async function previewAccess() {
    await perform(async () => {
      const result = await api<{ preview: ConnectorPreview }>({ action: "preview", templateId, manifest });
      setPreview(result.preview); setStep(2);
    });
  }
  async function save() {
    await perform(async () => {
      const result = await api<{ connection: PublicConnection }>({ action: "save", name: name.trim(), templateId, manifest });
      setSaved(result.connection); setConnections(current => [...current.filter(item => item.id !== result.connection.id), result.connection]);
      setStep(3);
      setFiles(await api<SetupFiles>(undefined, `/api/connectors/install?connectionId=${encodeURIComponent(result.connection.id)}`));
    });
  }
  async function showInstallation(item: PublicConnection) {
    await perform(async () => {
      setSaved(item); setTemplateId(item.templateId); setManifest(structuredClone(item.manifest)); setName(item.name);
      setStep(3); setOpen(true); setFiles(null);
      setFiles(await api<SetupFiles>(undefined, `/api/connectors/install?connectionId=${encodeURIComponent(item.id)}`));
    });
  }
  async function importDemo(item: PublicConnection) {
    await perform(async () => {
      const result = await api<{ caseId: string; state: WorkspaceState }>({ action: "import_demo", connectionId: item.id });
      onImported(result.state, result.caseId);
    });
  }
  async function revoke(item: PublicConnection) {
    if (!window.confirm(`Revoke ${item.name}? This stops sample imports from this saved configuration. Existing case evidence stays in your workspace. Any installed merchant connector must also be disabled in its hosting environment.`)) return;
    await perform(async () => {
      const result = await api<{ connection: PublicConnection }>({ action: "revoke", connectionId: item.id });
      setConnections(current => current.map(connection => connection.id === item.id ? result.connection : connection));
    });
  }

  return <section className="cw-panel cw-connectors" aria-label="Evidence connectors">
    <div className="cw-connector-heading">
      <div><span className="cw-connector-eyebrow">Company records · Guided setup</span><h2>Connect the evidence behind a payment.</h2><p>Choose how your records link, preview the permitted evidence, and get a ready-to-run connector.</p></div>
      {open ? <Action onClick={() => { setOpen(false); setError(""); }} disabled={busy}><X size={17} />Close setup</Action>
        : <Action primary disabled={loading || busy || !templates.length} onClick={() => begin()}><Plus size={17} />Add evidence connector</Action>}
    </div>
    {error && <div className="cw-banner error cw-connector-error" role="alert"><TriangleAlert size={18} /><div><p>{error}</p>{!templates.length && !loading && <button type="button" className="cw-button small" onClick={() => void perform(async () => { const data = await api<ConnectorList>(); setTemplates(data.templates); setConnections(data.connections); })}>Retry loading</button>}</div></div>}
    {loading && <div className="cw-connector-empty" role="status"><LoaderCircle size={16} /> Loading evidence connectors</div>}
    {!open && !loading && <>
      {connections.length ? <div className="cw-connector-list">{connections.map(item => <div className="cw-connector-row" key={item.id}>
        <div><div className="cw-connector-row-title"><strong>{item.name}</strong><span className="cw-pill">{item.status === "revoked" ? "Revoked" : "Sample ready"}</span></div><p>{item.status === "revoked" ? "This configuration can no longer import sample cases." : "Mapping saved. Live database installation is still required."}</p></div>
        <div className="cw-actions">{item.status === "revoked" ? <Action disabled={busy} onClick={() => begin(item)}><RefreshCw size={16} />Set up again</Action> : <>
          <Action disabled={busy} onClick={() => void importDemo(item)}>Open sample investigation<ArrowRight size={16} /></Action>
          <Action disabled={busy} onClick={() => void showInstallation(item)}><Download size={16} />Installation files</Action>
          <Action disabled={busy} label={`Revoke configuration ${item.name}`} onClick={() => void revoke(item)}>Revoke configuration</Action>
        </>}</div>
      </div>)}</div> : <div className="cw-connector-empty"><p>Try the ticketing or rental example with fictional records. Your database stays untouched during the preview.</p></div>}
    </>}
    {open && <>
      <ol className="cw-connector-steps" aria-label="Connector setup steps">{steps.map((title, index) => <li key={title}>
        <button type="button" aria-current={step === index ? "step" : undefined} disabled={busy || index > step || (step === 3 && index !== 3)} onClick={() => { setStep(index); setError(""); }}><span className="cw-connector-step-number">{index < step ? <Check size={13} /> : index + 1}</span>{title}</button>
      </li>)}</ol>
      <div className="cw-connector-content" aria-busy={busy}>
        <div className="cw-connector-step-intro"><h3 ref={heading} tabIndex={-1}>{["Start with your business workflow.", "Confirm the evidence you want to share.", "See the boundary before you connect.", "Your mapping is ready to install."][step]}</h3><p>{[
          "Both examples use fictional records. Select a starting template, then review its table and field mappings.",
          "Review the example schema below. Keep the business and payment links accurate; exclude any sections or optional fields you do not need.",
          "These results come from the reusable connector running against the selected example. Expand a record to inspect the exact fields.",
          "Your configuration is saved in this workspace. Download the installation files to run the connector beside your own database.",
        ][step]}</p></div>
        {step === 0 && <>
          <div className="cw-connector-templates">{templates.map(item => <button type="button" key={item.id} className="cw-connector-template" aria-pressed={item.id === templateId} onClick={() => choose(item)}>
            <span className="cw-connector-template-title">{item.manifest.businessType === "tickets" ? <Ticket size={21} /> : <Warehouse size={21} />}{item.name}{item.id === templateId && <Check size={18} />}</span><p>{item.description}</p><p style={{ marginTop: 10 }}><span className="cw-pill">Fictional example</span></p>
          </button>)}</div>
          <label className="cw-field cw-connector-name"><span>Connection name</span><input maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="My company records" /></label>
          <div className="cw-connector-step-footer"><p className="cw-connector-note"><Database size={14} /> Supabase / PostgreSQL · Guided installation</p><Action primary disabled={!manifest || !name.trim()} onClick={() => setStep(1)}>Review mapping<ArrowRight size={17} /></Action></div>
        </>}
        {step === 1 && manifest && template && <>
          <fieldset disabled={busy} className="cw-connector-fieldset">
          <MappingEditor manifest={manifest} template={template} onChange={value => { setManifest(value); setConfirmed(false); setPreview(null); }} />
          <label className="cw-connector-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I have reviewed the business, purchase, and payment relationships and the fields included in this example.</span></label>
          </fieldset>
          <div className="cw-connector-step-footer"><Action disabled={busy} onClick={() => setStep(0)}><ArrowLeft size={17} />Back</Action><Action primary disabled={busy || !confirmed} onClick={() => void previewAccess()}>{busy ? <LoaderCircle size={17} /> : <ShieldCheck size={17} />}{busy ? "Checking access…" : "Preview case access"}</Action></div>
        </>}
        {step === 2 && preview && <>
          <AccessPreview preview={preview} />
          <div className="cw-connector-step-footer"><Action disabled={busy} onClick={() => setStep(1)}><ArrowLeft size={17} />Edit mapping</Action><Action primary disabled={busy || !preview.checks.every(check => check.passed)} onClick={() => void save()}>{busy ? <LoaderCircle size={17} /> : <CheckCheck size={17} />}{busy ? "Saving configuration…" : "Save configuration"}</Action></div>
        </>}
        {step === 3 && saved && <>
          <div className="cw-connector-success"><CheckCheck size={20} /><span><strong>{saved.name}</strong> saved. Sample access is ready.</span></div>
          <div className="cw-connector-install"><div><h4>Install beside your database</h4>{files ? <ol>{files.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ol> : <p className="cw-connector-note">{busy ? "Preparing installation files…" : "Installation files could not load."}</p>}
            {!files && !busy && <Action onClick={() => void showInstallation(saved)}><RefreshCw size={16} />Retry installation files</Action>}
          </div><div><h4>Installation files</h4><div className="cw-connector-files">{files?.files.map(file => <Action key={file.name} onClick={() => download(file)} primary={file.name.endsWith("manifest.json")}><FileJson size={17} />{file.name}<Download size={15} /></Action>)}</div><p className="cw-connector-note" style={{ marginTop: 14 }}>Database credentials stay in your hosting environment. This saved setup is not a live connection.</p></div></div>
          <div className="cw-connector-step-footer"><Action disabled={busy} onClick={() => setOpen(false)}>Back to connections</Action><Action primary disabled={busy} onClick={() => void importDemo(saved)}>{busy ? <LoaderCircle size={17} /> : <ArrowRight size={17} />}Open sample investigation</Action></div>
        </>}
      </div>
    </>}
  </section>;
}
