"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  CreditCard,
  Database,
  FileCheck2,
  FileText,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type {
  AccessRequest,
  DisputeCase,
  Policy,
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/domain";
import { EvidencePacket } from './evidence-packet';
import { formatMoney } from "@/lib/money";

type Nav = (view: string, id?: string, detail?: Record<string, string>) => void;
type Mutation = (action: WorkspaceAction, message?: string) => Promise<boolean>;
const stamp = (s?: string) =>
  s
    ? new Date(s).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      })
    : "Not recorded";
const day = (s?: string) =>
  s
    ? new Date(s).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "Not recorded";
function Action({
  children,
  onClick,
  primary,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`cw-button ${primary ? "primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Heading({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="cw-page-head">
      <div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {children}
    </div>
  );
}
function Notice({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={`cw-banner ${warning ? "" : "neutral"}`}>
      <ShieldCheck size={20} />
      <p>{children}</p>
    </div>
  );
}
function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="cw-detail-line">
      <span>{label}</span>
      <div>{value}</div>
    </div>
  );
}

export function SetupChecklist({
  state,
  navigate,
  addCase,
  addPolicy,
}: {
  state: WorkspaceState;
  navigate: Nav;
  addCase: () => void;
  addPolicy: () => void;
}) {
  const real = state.cases.filter((c) => c.source !== "demo");
  const steps = [
    {
      title: "Business details",
      text: state.workspace?.name ?? "Add your business name and website.",
      done: !!state.workspace?.name,
      icon: FileText,
      action: () => navigate("settings"),
      button: "Business details",
    },
    {
      title: "Add purchase-time policies",
      text: "Add the delivery, refund, or service terms that applied at purchase.",
      done: state.policies.length > 0,
      icon: ShieldCheck,
      action: addPolicy,
      button: "Add policy",
    },
    {
      title: "Create a case",
      text: "Create a case or import one from a connected source.",
      done: real.length > 0,
      icon: Plus,
      action: addCase,
      button: "Create case",
    },
    {
      title: "Add evidence",
      text: "Attach the original records to a case.",
      done: real.some((c) => c.evidence.length > 0),
      icon: FileCheck2,
      action: () => navigate("cases"),
      button: "Open cases",
    },
  ];
  return (
    <>
      <Heading
        title="Workspace setup"
        text="Complete these steps to review your first case."
      />
      <div className="cw-setup-layout">
        <section className="cw-panel">
          <div className="cw-panel-header">
            <h3>Workspace readiness</h3>
            <span className="cw-pill orange">
              {steps.filter((x) => x.done).length} of 4 complete
            </span>
          </div>
          <div className="cw-panel-body">
            {steps.map((s, i) => (
              <div className="cw-checklist-row" key={s.title}>
                <span
                  className={`cw-checklist-number ${s.done ? "complete" : ""}`}
                >
                  {s.done ? (
                    <Check size={20} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <div className="cw-step-copy">
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
                <Action onClick={s.action}>
                  {s.button}
                  <ArrowRight size={16} />
                </Action>
              </div>
            ))}
          </div>
        </section>
        <aside className="cw-panel cw-panel-body cw-panel-stack">
          <span className="cw-icon-well">
            <Link2 size={24} />
          </span>
          <h2>Add a connection</h2>
          <p>
            You can also add evidence manually.
          </p>
          <Action onClick={() => navigate("integrations")}>
            View connections
            <ArrowRight size={18} />
          </Action>
          <div className="cw-rule" />
          <p className="cw-caption">
            Review and download your evidence PDF. Submissions are disabled.
          </p>
        </aside>
      </div>
    </>
  );
}

export function PolicyLibrary({
  state,
  busy,
  mutate,
  addPolicy,
}: {
  state: WorkspaceState;
  busy: boolean;
  mutate: Mutation;
  addPolicy: () => void;
}) {
  return (
    <>
      <Heading
        title="Policies"
        text="Save dated versions, then attach the applicable policy to a case."
      >
        <Action primary onClick={addPolicy}>
          <Plus size={18} />
          Add policy version
        </Action>
      </Heading>
      <Notice>
        Policies do not grant data access.
      </Notice>
      <div className="cw-panel">
        <div className="cw-panel-header">
          <h3>Saved policies</h3>
          <span className="cw-pill">{state.policies.length} versions</span>
        </div>
        <div className="cw-panel-body">
          {state.policies.length ? (
            state.policies.map((p) => (
              <div className="cw-policy" key={p.id}>
                <span className="cw-step-icon">
                  <FileText size={20} />
                </span>
                <div className="cw-policy-body">
                  <h3>{p.name}</h3>
                  <p>Effective {day(p.effectiveDate)}</p>
                  <details className="cw-policy-text">
                    <summary>Read original policy</summary>
                    <p>{p.content}</p>
                  </details>
                </div>
                <Action
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove “${p.name}” from the library? Case evidence already attached remains unchanged.`,
                      )
                    )
                      void mutate(
                        { action: "removePolicy", policyId: p.id },
                        "Policy removed from the library.",
                      );
                  }}
                >
                  Remove
                </Action>
              </div>
            ))
          ) : (
            <div className="cw-empty">
              <span className="cw-icon-well">
                <FileText size={24} />
              </span>
              <h2>No policies yet</h2>
              <p>Add the terms that applied when the purchase was made.</p>
              <Action primary onClick={addPolicy}>
                Add your first policy
              </Action>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function AttachPolicy({
  policies,
  current,
  busy,
  attach,
}: {
  policies: Policy[];
  current: DisputeCase;
  busy: boolean;
  attach: (p: Policy) => Promise<void>;
}) {
  const [selected, setSelected] = useState(policies[0]?.id ?? "");
  const policy = policies.find((p) => p.id === selected);
  return (
    <div className="cw-form">
      <p>
        Choose the version that applied to{" "}
        {current.orderRef || current.customerName}. Its text is copied into this
        case as a fixed source record.
      </p>
      {policies.length ? (
        <>
          <label className="cw-field">
            <span>Policy version</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · effective {day(p.effectiveDate)}
                </option>
              ))}
            </select>
          </label>
          {policy && (
            <div className="cw-policy-preview">
              <h3>{policy.name}</h3>
              <p>Effective {day(policy.effectiveDate)}</p>
              <div className="cw-source-content">{policy.content}</div>
            </div>
          )}
          <Notice>
            Adding evidence invalidates any previous draft approval. Review the
            updated case before approving it again.
          </Notice>
          <Action
            primary
            disabled={busy || !policy}
            onClick={() => {
              if (policy) void attach(policy);
            }}
          >
            <Plus size={18} />
            {busy ? "Attaching…" : "Attach policy to case"}
          </Action>
        </>
      ) : (
        <Notice>
          Add a policy to the company library first, then return to attach its
          applicable version.
        </Notice>
      )}
    </div>
  );
}

export type StripeConnectionStatus = {
  submissionEnabled?: boolean;
  configured?: boolean;
  connected?: boolean;
  mode?: string;
  accountName?: string;
  missing?: string[];
  message?: string;
  requiredConfiguration?: string[];
};
export function ConnectionDetail({
  provider,
  state,
  stripe,
  busy,
  action,
  navigate,
  requestAccess,
  healthError,
}: {
  provider: string;
  state: WorkspaceState;
  stripe: StripeConnectionStatus | null;
  busy: boolean;
  action: (
    action: "connect" | "sync" | "disconnect",
    body?: object,
  ) => Promise<void>;
  navigate: Nav;
  requestAccess: () => void;
  healthError?: string;
}) {
  const connection = state.integrations.find((x) => x.provider === provider);
  const connected = connection?.status === "connected";
  const isStripe = provider === "stripe",
    isEmail = provider === "gmail";
  const title = isStripe
    ? "Stripe"
    : isEmail
      ? "Customer messages"
      : "Company records";
  const Icon = isStripe ? CreditCard : isEmail ? Mail : Database;
  return (
    <>
      <div className="cw-page-head">
        <Action onClick={() => navigate("integrations")}>
          <ArrowLeft size={18} />
          All connections
        </Action>
        <span className="cw-pill outline">
          {isStripe
            ? connected
              ? "Connected"
              : "Not connected"
            : "Manual import available"}
        </span>
      </div>
      <Heading
        title={title}
        text={
          isStripe
            ? "Import disputes and payment records."
            : isEmail
              ? "Import original messages as evidence."
              : "Choose which records the connector can access."
        }
      />
      {healthError && (
        <div role="alert" className="cw-banner error">
          <TriangleAlert size={20} />
          <p>{healthError}</p>
        </div>
      )}
      <div className="cw-two-col">
        <section className="cw-panel">
          <div className="cw-panel-header">
            <h3>{isStripe ? "Connection status" : "Available workflow"}</h3>
            <Icon size={22} />
          </div>
          <div className="cw-panel-body cw-panel-stack">
            {isStripe ? (
              <>
                <Line
                  label="Account"
                  value={connection?.accountName || "No account connected"}
                />
                <Line
                  label="Environment"
                  value={
                    connection?.mode
                      ? connection.mode === "live"
                        ? "Live mode"
                        : "Sandbox"
                      : "Not configured"
                  }
                />
                <Line label="Workspace" value={state.workspace?.name} />
                <Line
                  label="Last successful sync"
                  value={
                    connection?.lastSyncAt
                      ? stamp(connection.lastSyncAt)
                      : "No synchronization recorded"
                  }
                />
                <Line
                  label="Evidence submission"
                  value={
                    stripe?.submissionEnabled
                      ? "Enabled · approval still required"
                      : "Disabled"
                  }
                />
                <Notice>
                  Credentials are managed on the server.
                </Notice>
                <div className="cw-actions">
                  {connected ? (
                    <>
                      <Action
                        primary
                        disabled={busy}
                        onClick={() => void action("sync")}
                      >
                        <RefreshCw size={18} />
                        {busy ? "Synchronizing…" : "Sync disputes"}
                      </Action>
                      <Action
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Disconnect Stripe? Imported records remain in this workspace.",
                            )
                          )
                            void action("disconnect");
                        }}
                      >
                        Disconnect
                      </Action>
                    </>
                  ) : (
                    <Action
                      primary
                      disabled={busy || stripe?.configured !== true}
                      onClick={() => void action("connect")}
                    >
                      <Link2 size={18} />
                      {stripe?.configured
                        ? "Connect configured account"
                        : "Configuration required"}
                    </Action>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="cw-checklist-row">
                  <span className="cw-checklist-number">01</span>
                  <div>
                    <h3>
                      {isEmail
                        ? "Select the relevant message"
                        : "Select an approved export"}
                    </h3>
                    <p>
                      {isEmail
                        ? "Include sender, timestamp, subject, and the relevant message thread."
                        : "Limit records to the customer, order, and fields needed for this case."}
                    </p>
                  </div>
                </div>
                <div className="cw-checklist-row">
                  <span className="cw-checklist-number">02</span>
                  <div>
                    <h3>Add it to the investigation</h3>
                    <p>
                      {isEmail
                        ? "Paste original text or upload an EML, PDF, or screenshot."
                        : "Add selected text, CSV, JSON, or a supporting original file."}
                    </p>
                  </div>
                </div>
                <div className="cw-checklist-row">
                  <span className="cw-checklist-number">03</span>
                  <div>
                    <h3>Keep the original reference</h3>
                    <p>
                      Findings and report review link back to this source
                      record.
                    </p>
                  </div>
                </div>
                <Action primary onClick={() => navigate("cases")}>
                  Choose a case
                  <ArrowRight size={18} />
                </Action>
              </>
            )}
          </div>
        </section>
        <aside className="cw-panel cw-panel-body cw-panel-stack">
          <span className="cw-icon-well">
            <LockKeyhole size={25} />
          </span>
          <h2>
            {isStripe
              ? "Submission"
              : isEmail
                ? "Gmail access"
                : "Data access"}
          </h2>
          <p>
            {isStripe
              ? "Approval records your review. Submissions are disabled."
              : isEmail
                ? "Connect Gmail to search by customer email and preview messages before import."
                : "Your endpoint limits access to approved cases and fields. Database credentials stay with you."}
          </p>
          {!isStripe && !isEmail && (
            <>
              <Action onClick={() => navigate("scope")}>
                Draft data scope
                <ArrowRight size={18} />
              </Action>
              <Action onClick={requestAccess}>Request additional access</Action>
            </>
          )}
          <div className="cw-rule" />
          <p className="cw-caption">
            {isStripe
              ? "API submission supports approved text only. Upload original files in Stripe Dashboard."
              : "Keep original wording and exclude unrelated records."}
          </p>
        </aside>
      </div>
    </>
  );
}

type ScopeDraft = {
  datasets: string;
  fields: string;
  identifiers: string;
  tools: string;
  excluded: string;
  redaction: string;
  retention: string;
};
const initialScope: ScopeDraft = {
  datasets: "orders, shipments",
  fields: "order_id, payment_status, shipped_at, delivery_status",
  identifiers: "Exact order_id and customer_id for the active case",
  tools: "read_order, read_delivery_event",
  excluded: "card details, passwords, unrelated customer records",
  redaction: "Remove access tokens and full payment credentials before export",
  retention: "90 days (preference; automatic deletion not enabled)",
};
export function ScopeConfiguration({
  state,
  preview,
  designMode,
  navigate,
}: {
  state: WorkspaceState;
  preview: boolean;
  designMode: boolean;
  navigate: Nav;
}) {
  const [draft, setDraft] = useState<ScopeDraft>(initialScope),
    [saved, setSaved] = useState(false),
    [storageError, setStorageError] = useState("");
  const key = `causality.scope-draft.${state.user.id}.${state.workspace?.id}`;
  // Hydrate the explicitly local configuration draft from browser storage.
  useEffect(() => {
    if (designMode) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const candidate = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft({
          ...initialScope,
          ...Object.fromEntries(
            Object.entries(candidate).filter(
              ([k, v]) => k in initialScope && typeof v === "string",
            ),
          ),
        });
      }
    } catch {
      setStorageError("This browser could not read the saved scope draft.");
    }
  }, [key, designMode]);
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (designMode) {
      setSaved(true);
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      setSaved(true);
      setStorageError("");
    } catch {
      setStorageError(
        "This browser could not save the draft. You can still review and copy its fields.",
      );
    }
  };
  const fields: [keyof ScopeDraft, string, string][] = [
    [
      "datasets",
      "Proposed datasets",
      "Only the named sources would be eligible.",
    ],
    ["fields", "Allowed fields", "List the minimum fields needed."],
    [
      "identifiers",
      "Required identifiers",
      "Constrain access to the active case.",
    ],
    ["tools", "Permitted read tools", "No write or destructive operations."],
    [
      "excluded",
      "Excluded records and fields",
      "Explicit exclusions are as important as the allowlist.",
    ],
    [
      "redaction",
      "Redaction requirements",
      "Strip sensitive material before disclosure.",
    ],
    [
      "retention",
      "Retention preference",
      "This is a proposed requirement, not an active deletion schedule.",
    ],
  ];
  return (
    <>
      <div className="cw-page-head">
        <Action
          onClick={() =>
            navigate("integrations", undefined, { source: "database" })
          }
        >
          <ArrowLeft size={18} />
          Company records
        </Action>
        <span className="cw-pill orange">Draft · not enforced</span>
      </div>
      <Heading
        title={
          preview
            ? "Scope preview"
            : "Data scope"
        }
        text={
          preview
            ? "Preview the fields in your draft."
            : "Draft the fields your gateway may share. No access is granted."
        }
      />
      <Notice>
        Saved in this browser only. This draft does not enforce access, redaction, or retention.
      </Notice>
      {storageError && (
        <div className="cw-banner error" role="alert">
          <TriangleAlert size={20} />
          <p>{storageError}</p>
        </div>
      )}
      {preview ? (
        <>
          <div className="cw-two-col">
            <section className="cw-panel">
              <div className="cw-panel-header">
                <h3>Illustrative payload</h3>
                <span className="cw-pill outline">Synthetic example</span>
              </div>
              <div className="cw-panel-body">
                <pre className="cw-code">
                  {JSON.stringify(
                    {
                      case_id: "example-case",
                      order_id: "1048",
                      payment_status: "paid",
                      shipped_at: "2026-10-29",
                      delivery_status: "carrier_marked_delivered",
                    },
                    null,
                    2,
                  )}
                </pre>
                <p className="cw-caption">
                  Example data only. No query or connector test has run.
                </p>
              </div>
            </section>
            <section className="cw-panel">
              <div className="cw-panel-header">
                <h3>Proposed boundaries</h3>
                <ShieldCheck size={20} />
              </div>
              <div className="cw-panel-body cw-panel-stack">
                <Line label="Requested fields" value={draft.fields} />
                <Line label="Case boundary" value={draft.identifiers} />
                <Line label="Excluded" value={draft.excluded} />
                <Line label="Redaction" value={draft.redaction} />
              </div>
            </section>
          </div>
          <div className="cw-bottom-actions">
            <Action onClick={() => navigate("scope")}>Edit draft</Action>
            <Action
              primary
              onClick={() => {
                const blob = new Blob([JSON.stringify(draft, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "causality-scope-draft.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export scope draft
            </Action>
          </div>
        </>
      ) : (
        <form className="cw-panel" onSubmit={save}>
          <div className="cw-panel-header">
            <h3>Proposed access contract</h3>
            <Database size={20} />
          </div>
          <div className="cw-panel-body cw-form">
            <div className="cw-form-grid">
              {fields.map(([id, label, hint]) => (
                <label className="cw-field" key={id}>
                  <span>{label}</span>
                  <textarea
                    value={draft[id]}
                    maxLength={2000}
                    onChange={(e) => {
                      setDraft({ ...draft, [id]: e.target.value });
                      setSaved(false);
                    }}
                  />
                  <small>{hint}</small>
                </label>
              ))}
            </div>
            <div className="cw-actions">
              <button className="cw-button primary" type="submit">
                {saved ? "Saved in this browser" : "Save draft locally"}
                <Check size={18} />
              </button>
              <Action
                onClick={() => navigate("scope", undefined, { tab: "preview" })}
              >
                Disclosure preview
                <ArrowRight size={18} />
              </Action>
            </div>
          </div>
        </form>
      )}
    </>
  );
}

export function AccessRequestDetail({
  request,
  state,
  navigate,
}: {
  request: AccessRequest;
  state: WorkspaceState;
  navigate: Nav;
}) {
  const linkedCase = state.cases.find((c) => c.id === request.caseId);
  return (
    <>
      <div className="cw-page-head">
        <Action onClick={() => navigate("access")}>
          <ArrowLeft size={18} />
          Access requests
        </Action>
        <span
          className={`cw-pill ${request.status === "pending" ? "orange" : ""}`}
        >
          {request.status === "pending"
            ? "Pending independent review"
            : request.status}
        </span>
      </div>
      <Heading
        title="Access request"
        text="A request does not grant access."
      />
      <div className="cw-two-col">
        <section className="cw-panel">
          <div className="cw-panel-header">
            <h3>Requested access</h3>
            <ShieldCheck size={20} />
          </div>
          <div className="cw-panel-body cw-panel-stack">
            <Line label="Records and fields" value={request.scope} />
            <Line label="Purpose" value={request.reason} />
            <Line label="Requested by" value={request.requestedBy} />
            <Line label="Requested at" value={stamp(request.createdAt)} />
            <Line
              label="Related case"
              value={
                linkedCase ? (
                  <button
                    className="cw-text-link cw-inline-button"
                    onClick={() => navigate("cases", linkedCase.id)}
                  >
                    {linkedCase.orderRef} · {linkedCase.title}
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  "Workspace-level request"
                )
              }
            />
            <Line
              label="Reviewed by"
              value={request.reviewedBy ?? "No independent decision recorded"}
            />
          </div>
        </section>
        <aside className="cw-panel cw-panel-body cw-panel-stack">
          <span className="cw-icon-well">
            <LockKeyhole size={24} />
          </span>
          <h2>Independent review required</h2>
          <p>
            You cannot approve your own request. Configure an independent reviewer to continue.
          </p>
          <div className="cw-rule" />
          <p>
            Approval does not connect a source. Its gateway must enforce the approved scope.
          </p>
        </aside>
      </div>
    </>
  );
}

export function AccountSettings({ state }: { state: WorkspaceState }) {
  return (
    <>
      <Heading
        title="Account"
        text="Manage your account and workspace access."
      />
      <section className="cw-panel">
        <div className="cw-panel-header">
          <h3>Workspace owner</h3>
          <KeyRound size={21} />
        </div>
        <div className="cw-panel-body cw-panel-stack">
          <div className="cw-account-heading">
            <span className="cw-avatar">{state.user.name[0]}</span>
            <div>
              <h2>{state.user.name}</h2>
              <p>{state.user.email}</p>
            </div>
            <span className="cw-pill outline">Owner</span>
          </div>
          <Line label="Workspace" value={state.workspace?.name} />
          <Line label="Identity provider" value="ChatGPT" />
          <Line
            label="Membership model"
            value="Single owner · Invitations unavailable"
          />
          <Notice>
            Manage your password and account security with your sign-in provider.
          </Notice>
          <p>
            Access requests need an independent reviewer.
          </p>
        </div>
      </section>
    </>
  );
}

export function ReportPreview({
  current,
  draft,
  dirty,
  exportEnabled = false,
  exportReport,
}: {
  current: DisputeCase;
  draft: string;
  dirty: boolean;
  exportEnabled?: boolean;
  exportReport: () => void;
  openEvidence: (id: string) => void;
}) {
  return (
    <div className="cw-report">
      <div className="cw-page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="cw-eyebrow">MERCHANT INVESTIGATION REPORT</span>
          <h2 style={{ marginTop: 12 }}>Report preview</h2>
          <p>
            {current.orderRef} · {current.customerName} ·{" "}
            {formatMoney(current.amount, current.currency)}
          </p>
        </div>
        <Action disabled={!exportEnabled} onClick={exportReport}>
          Download evidence PDF
          <ArrowRight size={18} />
        </Action>
      </div>
      <div className="cw-report-meta">
        <span>
          {dirty
            ? "Unsaved working copy"
            : `Revision ${current.draft?.revision ?? ":"}`}
        </span>
        <span>
          {dirty
            ? "Not approved · save and review this version"
            : current.draft?.sourceStale
              ? "Evidence changed · investigate and review again"
              : current.draft?.status === "approved"
                ? "Reviewed copy · submissions disabled"
                : "Draft · merchant review required"}
        </span>
      </div>
      <EvidencePacket current={current} content={draft} />
    </div>
  );
}

export function SubmissionReadiness({
  current,
  submissionEnabled,
  connected,
}: {
  current: DisputeCase;
  submissionEnabled: boolean;
  connected: boolean;
}) {
  const checks = [
    {
      ok: current.source === "stripe",
      title: "Linked Stripe dispute",
      detail:
        current.source === "demo"
          ? "Synthetic cases cannot be submitted."
          : current.source === "stripe"
            ? "This case references a Stripe dispute."
            : "This case is not linked to a Stripe dispute.",
    },
    {
      ok: connected,
      title: "Workspace connection",
      detail: connected
        ? "A Stripe connection is present for this workspace."
        : "No Stripe account is connected.",
    },
    {
      ok: submissionEnabled,
      title: "Submission enabled",
      detail: submissionEnabled
        ? "Your configured environment permits submission."
        : "Submission is disabled in the current environment.",
    },
    {
      ok: current.draft?.status === "approved" && !current.draft.sourceStale,
      title: "Current revision approved",
      detail: current.draft?.sourceStale
        ? "The evidence changed. Investigate and review the current sources again."
        : current.draft?.status === "approved"
          ? `Revision ${current.draft.revision} has merchant approval.`
          : "Save and approve the exact response revision first.",
    },
    {
      ok: !current.evidence.some((e) => e.fileName || e.downloadUrl),
      title: "Supported response format",
      detail: current.evidence.some((e) => e.fileName || e.downloadUrl)
        ? "Original attachments require submission in Stripe Dashboard."
        : "Text-only submission is supported. Files are not submitted by this build.",
    },
  ];
  return (
    <section className="cw-readiness">
      <h3>Submission readiness</h3>
      {checks.map((c) => (
        <div className="cw-readiness-row" key={c.title}>
          <span className={`cw-readiness-icon ${c.ok ? "ok" : ""}`}>
            {c.ok ? <Check size={17} /> : <LockKeyhole size={16} />}
          </span>
          <div>
            <h3>{c.title}</h3>
            <p>{c.detail}</p>
          </div>
          <span className={`cw-pill ${c.ok ? "green" : ""}`}>
            {c.ok ? "Ready" : "Required"}
          </span>
        </div>
      ))}
    </section>
  );
}

export function SubmissionOutcome({
  current,
  navigate,
}: {
  current: DisputeCase;
  navigate: Nav;
}) {
  const verifying = current.status === "submitting",
    won = current.status === "won",
    lost = current.status === "lost";
  const title = verifying
    ? "Verify before taking another step."
    : won
      ? "The dispute was won."
      : lost
        ? "The dispute was lost."
        : "Evidence is with Stripe.";
  return (
    <div className={`cw-outcome ${won ? "positive" : lost ? "negative" : ""}`}>
      <span className="cw-icon-well">
        {verifying ? <Clock3 size={25} /> : <FileCheck2 size={25} />}
      </span>
      <div>
        <span className="cw-eyebrow">
          {verifying
            ? "VERIFICATION REQUIRED"
            : won || lost
              ? "CLOSED DISPUTE"
              : "SUBMITTED · BANK REVIEW"}
        </span>
        <h2>{title}</h2>
        <p>
          {verifying
            ? "The submission result needs reconciliation. Editing is locked to prevent an accidental duplicate response. Synchronize Stripe to check the current dispute state."
            : won
              ? "Stripe reports a won outcome. The evidence and reviewed response remain preserved. A returned payment balance is not inferred from the dispute status alone."
              : lost
                ? "Stripe reports a lost outcome. The evidence and reviewed response remain preserved. This case is closed to additional submission in Causality."
                : "The synchronized dispute status records submission. The bank now reviews the evidence. The response is locked, and no outcome is guaranteed."}
        </p>
        <p className="cw-caption">
          Last case update: {stamp(current.updatedAt)}
          {current.stripeDisputeId
            ? ` · Stripe dispute ${current.stripeDisputeId}`
            : ""}
        </p>
        {verifying && (
          <Action
            onClick={() =>
              navigate("integrations", undefined, { source: "stripe" })
            }
          >
            <RefreshCw size={18} />
            Review Stripe connection
          </Action>
        )}
      </div>
    </div>
  );
}
