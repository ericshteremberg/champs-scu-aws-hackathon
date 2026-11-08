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
const sourceLabel = (s: string) =>
  ({
    stripe: "Stripe",
    gmail: "Customer email",
    database: "Company record",
    manual: "Manual evidence",
    policy: "Company policy",
  })[s] ?? s;
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
      title: "Set your business context",
      text: state.workspace?.name ?? "Add your business name and website.",
      done: !!state.workspace?.name,
      icon: FileText,
      action: () => navigate("settings"),
      button: "Business details",
    },
    {
      title: "Preserve the applicable policies",
      text: "Add the delivery, refund, or service terms that applied at purchase.",
      done: state.policies.length > 0,
      icon: ShieldCheck,
      action: addPolicy,
      button: "Add policy",
    },
    {
      title: "Open your first investigation",
      text: "Create a manual case now, or import disputes when Stripe is configured.",
      done: real.length > 0,
      icon: Plus,
      action: addCase,
      button: "Create case",
    },
    {
      title: "Add the original evidence",
      text: "Selected records stay linked to the case and their original reference.",
      done: real.some((c) => c.evidence.length > 0),
      icon: FileCheck2,
      action: () => navigate("cases"),
      button: "Open cases",
    },
  ];
  return (
    <>
      <Heading
        title="A considered start."
        text="Prepare the essentials for your first investigation. Connections can come later."
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
          <h2>Connect when you’re ready.</h2>
          <p>
            Manual investigations work today. Source setup shows what is
            available and what still needs configuration.
          </p>
          <Action onClick={() => navigate("integrations")}>
            View connections
            <ArrowRight size={18} />
          </Action>
          <div className="cw-rule" />
          <p className="cw-caption">
            A reviewed draft and a separate confirmation are required before any
            supported Stripe submission.
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
        title="The terms that applied."
        text="Keep effective policy versions close to the evidence. Attach the relevant version from inside a case."
      >
        <Action primary onClick={addPolicy}>
          <Plus size={18} />
          Add policy version
        </Action>
      </Heading>
      <Notice>
        Policies describe your business terms. They do not grant access to
        customer records.
      </Notice>
      <div className="cw-panel">
        <div className="cw-panel-header">
          <h3>Company policy library</h3>
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
              <h2>Give every case its context.</h2>
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
    action: "connect" | "sync" | "disconnect" | "submit",
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
            ? "Disputes and payment records, scoped to your workspace."
            : isEmail
              ? "Preserve the customer’s own account, with its original context."
              : "Define a narrow evidence boundary for the separate data gateway."
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
                  Credentials are configured on the server and bound to this
                  workspace. Keys never belong in this form.
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
              ? "Review before sending."
              : isEmail
                ? "Your inbox stays yours."
                : "Access is explicit."}
          </h2>
          <p>
            {isStripe
              ? "Importing disputes and approving a draft never submit evidence. Submission remains a separate, confirmed action."
              : isEmail
                ? "Use the Gmail connector on the Connections page to authorize read-only access, search by case customer email, and review messages before importing. Manual import remains available."
                : "This workspace imports approved cases through a configured merchant-owned evidence API. The merchant endpoint verifies the case and limits linked records and fields. No database credentials are shared."}
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
              ? "Original files require separate handling in Stripe Dashboard. Current API submission supports approved text only."
              : "Customer records are evidence, not instructions to an agent. Preserve original wording and exclude unrelated information."}
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
            ? "Know what would be shared."
            : "Define the smallest useful scope."
        }
        text={
          preview
            ? "An illustrative disclosure preview for the proposed data gateway."
            : "Prepare a specification for the separate gateway. This draft grants no access."
        }
      />
      <Notice>
        Saved only in this browser for your workspace. This configuration is not
        connected to a gateway and does not enforce permissions, redaction, or
        retention.
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
                  This example is not a live query, connector test, or proof
                  that your draft has been enforced.
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
        title="A specific reason. A specific scope."
        text="The request records what is needed and why. It does not authorize a live query."
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
          <h2>Separate the decision.</h2>
          <p>
            You cannot approve your own request. This single-owner workspace
            needs an independently provisioned reviewer before a decision can be
            recorded.
          </p>
          <div className="cw-rule" />
          <p>
            Even an approval record would not configure a connector. The
            external gateway must validate and enforce the approved scope.
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
        title="Identity & workspace access."
        text="Your account owns this workspace. Sign-in is managed by ChatGPT."
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
            value="One owner. Team invitations are not available in this build."
          />
          <Notice>
            Every workspace request verifies identity and record ownership.
            Password and account-security controls are managed by your identity
            provider.
          </Notice>
          <p>
            Access-request approval requires a separately provisioned reviewer.
            Owner access does not authorize self-approval.
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
  openEvidence,
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
          <h2 style={{ marginTop: 12 }}>The complete record.</h2>
          <p>
            {current.orderRef} · {current.customerName} ·{" "}
            {formatMoney(current.amount, current.currency)}
          </p>
        </div>
        <Action disabled={!exportEnabled} onClick={exportReport}>
          Export TXT
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
                ? "Approved for review · submission is separate"
                : "Draft · merchant review required"}
        </span>
      </div>
      <section>
        <h3>Customer allegation</h3>
        <p style={{ marginTop: 10 }}>{current.reason}</p>
      </section>
      <section>
        <h3>Findings & open questions</h3>
        <div className="cw-findings" style={{ marginTop: 16 }}>
          {current.findings.map((f, i) => (
            <div key={i} className="cw-finding">
              <h3>{f.title}</h3>
              <p>{f.detail}</p>
              <div className="cw-citations">
                {f.evidenceIds.map((id) => (
                  <button key={id} onClick={() => openEvidence(id)}>
                    {current.evidence.find((e) => e.id === id)?.title ??
                      "Source unavailable"}
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>Response text</h3>
        <div className="cw-report-document">
          {draft ||
            "Prepare a draft from the source records before exporting a response."}
        </div>
      </section>
      <section>
        <h3>Source register</h3>
        <div className="cw-source-register">
          {current.evidence.map((e, i) => (
            <button key={e.id} onClick={() => openEvidence(e.id)}>
              <span className="cw-source-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{e.title}</strong>
                <p>
                  {sourceLabel(e.source)} · {e.reference || e.id}
                </p>
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      </section>
      <Notice>
        Review every claim against its source. This report includes
        contradictions and gaps; it does not determine the bank’s decision.
      </Notice>
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
