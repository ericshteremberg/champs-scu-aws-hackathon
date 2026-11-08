import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock3,
  Cloud,
  CreditCard,
  Database,
  FileCheck2,
  FileSearch,
  FileText,
  FolderClosed,
  Inbox,
  Info,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Ticket,
  TriangleAlert,
  Unplug,
  X,
} from "lucide-react";
import type {
  AppConfig,
  CaseRecord,
  CaseStatus,
  EvidenceEnvelope,
  EvidenceRecord,
  EvidenceSection,
  InvestigationRun,
  RunEvent,
} from "../shared/types";
import { api, ApiFailure, downloadPacket } from "./api";

type View = "cases" | "connections" | "guide";
type Tab = "overview" | "evidence" | "response" | "activity";
const statusLabels: Record<CaseStatus, string> = {
  needs_review: "New",
  investigating: "Investigating",
  ready: "Ready for review",
  reviewed: "Reviewed",
};
const sectionLabels: Record<EvidenceSection, string> = {
  summary: "Payment",
  order: "Order",
  tickets: "Tickets",
  delivery: "Delivery",
  history: "History",
  support: "Conversation",
  attendance: "Attendance",
  policy: "Policy",
};
const sectionIcons: Record<EvidenceSection, typeof Ticket> = {
  summary: CreditCard,
  order: FileText,
  tickets: Ticket,
  delivery: Mail,
  history: Clock3,
  support: MessageSquareText,
  attendance: CheckCheck,
  policy: BookOpen,
};
const date = (value: string, full = false) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        ...(full
          ? { year: "numeric", hour: "numeric", minute: "2-digit" }
          : {}),
      }).format(parsed);
};
const money = (amount: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amount / 100,
  );
const sourceLabel = (mode: CaseRecord["sourceMode"]) =>
  mode === "live"
    ? "Live records"
    : mode === "anonymized_snapshot"
      ? "Anonymized snapshot"
      : "Synthetic example";
const prettyId = (id: string) => `CW-${id.split("_").at(-1)?.toUpperCase()}`;
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-dark" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="M24 8H13a8 8 0 0 0 0 16h11M22 13h-9a3 3 0 0 0 0 6h9" />
        </svg>
      </span>
      <span>
        casework<span className="brand-period">.</span>
      </span>
    </div>
  );
}

function Spinner({ small = false }: { small?: boolean }) {
  return (
    <LoaderCircle
      className={`spin ${small ? "icon-sm" : ""}`}
      aria-hidden="true"
    />
  );
}
function SourceBadge({ mode }: { mode: CaseRecord["sourceMode"] }) {
  return (
    <span className={`source-badge ${mode === "live" ? "source-live" : ""}`}>
      <span />
      {sourceLabel(mode)}
    </span>
  );
}
function Empty({
  icon: Icon = FileSearch,
  title,
  children,
}: {
  icon?: typeof FileSearch;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const [run, setRun] = useState<InvestigationRun | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [caseLoading, setCaseLoading] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [view, setView] = useState<View>("cases");
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [reviewChecked, setReviewChecked] = useState(false);
  const [record, setRecord] = useState<EvidenceRecord | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [mobileList, setMobileList] = useState(true);

  const handleError = useCallback((err: unknown) => {
    if (err instanceof ApiFailure && err.status === 401) setNeedsAuth(true);
    else setError(message(err));
  }, []);

  const loadCases = useCallback(async () => {
    const data = await api<{ cases: CaseRecord[] }>("/api/cases");
    setCases(data.cases);
    setSelectedId((previous) =>
      previous && data.cases.some((item) => item.id === previous)
        ? previous
        : data.cases[0]?.id || null,
    );
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setConfig(await api<AppConfig>("/api/config"));
        await loadCases();
      } catch (err) {
        handleError(err);
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [loadCases, handleError]);

  useEffect(() => {
    if (!selectedId || needsAuth) return;
    let cancelled = false;
    setCaseLoading(true);
    setSelected(null);
    setRun(null);
    setTab("overview");
    setError(null);
    api<{ case: CaseRecord; latestRun?: InvestigationRun }>(
      `/api/cases/${encodeURIComponent(selectedId)}`,
    )
      .then((data) => {
        if (!cancelled) {
          setSelected(data.case);
          setRun(data.latestRun || null);
        }
      })
      .catch((err) => {
        if (!cancelled) handleError(err);
      })
      .finally(() => {
        if (!cancelled) setCaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, needsAuth, handleError]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    let cancelled = false;
    let fetching = false;
    const interval = setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await api<{ run: InvestigationRun }>(
          `/api/runs/${run.id}`,
        );
        if (!cancelled) {
          setRun(result.run);
          if (result.run.status !== "running") await loadCases();
        }
      } catch (err) {
        if (!cancelled) handleError(err);
      } finally {
        fetching = false;
      }
    }, 800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [run?.id, run?.status, handleError, loadCases]);

  useEffect(() => {
    setDraft(run?.report?.responseDraft || "");
    setNote(run?.report?.reviewerNote || "");
    setReviewChecked(Boolean(run?.report?.reviewedAt));
  }, [run?.report?.generatedAt, run?.report?.reviewedAt, selectedId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const visibleCases = useMemo(
    () =>
      cases.filter((item) => {
        const matchesFilter =
          filter === "all" ||
          (filter === "active"
            ? item.status !== "reviewed"
            : item.status === "reviewed");
        return (
          matchesFilter &&
          `${item.id} ${item.customerLabel} ${item.eventName} ${item.reason} ${item.orderRef}`
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }),
    [cases, query, filter],
  );
  const evidence = run?.evidence.flatMap((group) => group.records) || [];
  const activeCases = cases.filter((item) => item.status !== "reviewed");
  const totalAmount = activeCases
    .filter((item) => item.currency.toUpperCase() === "USD")
    .reduce((total, item) => total + item.amount, 0);
  const report = run?.report;
  const running = run?.status === "running";
  const currentStatus: CaseStatus = running
    ? "investigating"
    : report?.reviewedAt
      ? "reviewed"
      : report
        ? "ready"
        : selected?.status || "needs_review";
  const dirty = Boolean(
    report &&
      (draft !== report.responseDraft || note !== (report.reviewerNote || "")),
  );

  async function investigate() {
    if (!selected) return;
    setBusy("investigate");
    setError(null);
    try {
      const result = await api<{ run: InvestigationRun }>(
        `/api/cases/${selected.id}/investigate`,
        { method: "POST", body: "{}" },
      );
      setRun(result.run);
      setTab("overview");
      await loadCases();
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!run) return;
    setBusy("stop");
    try {
      const result = await api<{ run: InvestigationRun }>(
        `/api/runs/${run.id}/stop`,
        { method: "POST", body: "{}" },
      );
      setRun(result.run);
      await loadCases();
      setToast("Investigation stopped. Collected evidence is still available.");
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function review(format?: "markdown" | "json") {
    if (!selected || !run || !reviewChecked || !draft.trim()) return;
    setBusy(format || "review");
    setError(null);
    try {
      if (!report?.reviewedAt || dirty) {
        const result = await api<{ run: InvestigationRun }>(
          `/api/cases/${selected.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              runId: run.id,
              responseDraft: draft,
              reviewerNote: note,
            }),
          },
        );
        setRun(result.run);
        await loadCases();
      }
      if (format) {
        await downloadPacket(selected.id, run.id, format);
        setToast("Evidence packet downloaded. Nothing was sent to Stripe.");
      } else setToast("Review saved. Your response is ready to export.");
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    if (!selected || !run || !reviewChecked || !draft.trim()) return;
    setBusy("archive");
    setError(null);
    try {
      if (!report?.reviewedAt || dirty) {
        const result = await api<{ run: InvestigationRun }>(
          `/api/cases/${selected.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              runId: run.id,
              responseDraft: draft,
              reviewerNote: note,
            }),
          },
        );
        setRun(result.run);
        await loadCases();
      }
      await api(`/api/cases/${selected.id}/archive`, {
        method: "POST",
        body: JSON.stringify({ runId: run.id }),
      });
      setToast("Reviewed evidence packet archived to your private S3 bucket.");
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  async function login(token: string) {
    setBusy("login");
    setError(null);
    try {
      await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setNeedsAuth(false);
      await loadCases();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function importCase(caseId: string) {
    setBusy("import");
    setError(null);
    try {
      const result = await api<{ case: CaseRecord }>("/api/cases/import", {
        method: "POST",
        body: JSON.stringify({ caseId }),
      });
      await loadCases();
      setSelectedId(result.case.id);
      setView("cases");
      setImportOpen(false);
      setMobileList(false);
      setToast("Case imported from your connected evidence API.");
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  }

  if (needsAuth)
    return <Login onLogin={login} busy={busy === "login"} error={error} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-avatar">A</span>
          <span>
            <strong>ATMSPHR</strong>
            <small>Dispute workspace</small>
          </span>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${view === "cases" ? "active" : ""}`}
            onClick={() => setView("cases")}
            title="Disputes"
          >
            <FolderClosed size={19} />
            <span>Disputes</span>
            <b>{cases.length}</b>
          </button>
          <button
            className={`nav-item ${view === "connections" ? "active" : ""}`}
            onClick={() => setView("connections")}
            title="Connections"
          >
            <Link2 size={19} />
            <span>Connections</span>
          </button>
          <button
            className={`nav-item ${view === "guide" ? "active" : ""}`}
            onClick={() => setView("guide")}
            title="How it works"
          >
            <CircleHelp size={19} />
            <span>How it works</span>
          </button>
        </nav>
        <div className="sidebar-note">
          <div className="mini-orbit">
            <ShieldCheck size={21} />
          </div>
          <h4>
            Your evidence.
            <br />
            Your control.
          </h4>
          <p>Only the records connected to your case.</p>
          <span>
            <LockKeyhole size={12} />
            Read-only access
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="operator-avatar">AT</span>
          <span>
            <strong>ATMSPHR team</strong>
            <small>Organizer workspace</small>
          </span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {view === "cases"
                ? "Disputes"
                : view === "connections"
                  ? "Connections"
                  : "How it works"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="mode-pill">
              <span
                className={
                  config?.mode === "bedrock" ? "mode-dot live" : "mode-dot"
                }
              />
              {config?.mode === "bedrock"
                ? "AWS Bedrock"
                : "Demo investigation"}
            </span>
            <span className="topbar-avatar" aria-label="ATMSPHR team">
              AT
            </span>
          </div>
        </header>
        <main id="workspace" className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "cases" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">THE FULL PICTURE</div>
                  <h1>Disputes, with the facts.</h1>
                  <p>Bring the evidence together. Move forward with clarity.</p>
                </div>
                <button
                  className="button button-secondary"
                  onClick={() => setImportOpen(true)}
                >
                  <Plus size={16} />
                  Add a case
                </button>
              </div>
              <div className="workspace-stats">
                <div className="stat-item">
                  <span className="stat-icon">
                    <Inbox size={18} />
                  </span>
                  <div>
                    <span className="stat-label">Open cases</span>
                    <strong>
                      {initialLoading ? "..." : activeCases.length}
                    </strong>
                  </div>
                </div>
                <div className="stat-item">
                  <span className="stat-icon">
                    <CreditCard size={18} />
                  </span>
                  <div>
                    <span className="stat-label">
                      Disputed amount <small>USD</small>
                    </span>
                    <strong>
                      {initialLoading ? "..." : money(totalAmount)}
                    </strong>
                  </div>
                </div>
                <div className="stat-item">
                  <span className="stat-icon teal">
                    <FileCheck2 size={18} />
                  </span>
                  <div>
                    <span className="stat-label">Ready for review</span>
                    <strong>
                      {initialLoading
                        ? "..."
                        : cases.filter((item) => item.status === "ready")
                            .length}
                    </strong>
                  </div>
                </div>
                <div className="stats-note">
                  <span className="tiny-dot" />
                  <span>
                    {cases.some((item) => item.sourceMode === "synthetic")
                      ? "Sample cases are clearly labeled."
                      : "Evidence access stays within each case."}
                  </span>
                </div>
              </div>

              <div
                className={`case-layout ${mobileList ? "show-list" : "show-detail"}`}
              >
                <section className="case-queue" aria-label="Dispute cases">
                  <div className="queue-heading">
                    <h2>
                      Case inbox <span>{cases.length}</span>
                    </h2>
                    <span className="queue-icon">
                      <Inbox size={16} />
                    </span>
                  </div>
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search cases"
                      placeholder="Search cases..."
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label="Clear search"
                        onClick={() => setQuery("")}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div
                    className="queue-filters"
                    role="group"
                    aria-label="Filter cases"
                  >
                    {[
                      ["all", "All cases"],
                      ["active", "Open"],
                      ["reviewed", "Reviewed"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={filter === value}
                        className={filter === value ? "selected" : ""}
                        onClick={() => setFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="case-list">
                    {initialLoading ? (
                      <div className="loading-block">
                        <Spinner />
                        <span>Loading your workspace</span>
                      </div>
                    ) : visibleCases.length ? (
                      visibleCases.map((item) => (
                        <button
                          key={item.id}
                          className={`case-list-item ${selectedId === item.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelectedId(item.id);
                            setMobileList(false);
                          }}
                          aria-pressed={selectedId === item.id}
                        >
                          <div className="case-item-top">
                            <span className="mono">{prettyId(item.id)}</span>
                            <span
                              className={`status-dot status-${item.status}`}
                              title={statusLabels[item.status]}
                            />
                          </div>
                          <div className="case-item-main">
                            <strong>
                              {item.reason || "Ticket not received"}
                            </strong>
                            <span>{money(item.amount, item.currency)}</span>
                          </div>
                          <p>{item.eventName}</p>
                          <div className="case-item-bottom">
                            <span>{item.customerLabel}</span>
                            <span>{statusLabels[item.status]}</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="queue-empty">
                        <Search size={21} />
                        <strong>
                          {query ? "No matching cases" : "No cases here yet"}
                        </strong>
                        <p>
                          {query
                            ? "Try a customer, event, or order number."
                            : filter === "reviewed"
                              ? "Reviewed cases will appear here."
                              : "Add a case to start investigating."}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="queue-footer">
                    <ShieldCheck size={14} />
                    <span>Case-scoped evidence access</span>
                  </div>
                </section>

                <section className="case-workspace" aria-label="Selected case">
                  <button
                    className="mobile-back button button-quiet"
                    onClick={() => setMobileList(true)}
                  >
                    <ArrowLeft size={15} />
                    Back to cases
                  </button>
                  {caseLoading || initialLoading ? (
                    <div className="loading-workspace">
                      <Spinner />
                      <p>Opening the case file...</p>
                    </div>
                  ) : selected ? (
                    <>
                      <div className="case-header">
                        <div className="case-header-meta">
                          <span className="mono case-reference">
                            {prettyId(selected.id)}
                          </span>
                          <span
                            className={`status-pill status-${currentStatus}`}
                          >
                            {running && <Spinner small />}
                            {statusLabels[currentStatus]}
                          </span>
                          <SourceBadge mode={selected.sourceMode} />
                        </div>
                        <div className="case-title-line">
                          <div>
                            <h2>{selected.reason || "Ticket not received"}</h2>
                            <p>
                              {selected.eventName}
                              <span>·</span>
                              {selected.customerLabel}
                            </p>
                          </div>
                          <div className="case-amount">
                            <strong>
                              {money(selected.amount, selected.currency)}
                            </strong>
                            <span>
                              {selected.currency.toUpperCase()} disputed
                            </span>
                          </div>
                        </div>
                        <div className="case-date-line">
                          <span>
                            <Clock3 size={13} />
                            Response due {date(selected.dueAt)}
                          </span>
                          <span>
                            <Ticket size={13} />
                            {selected.orderRef}
                          </span>
                        </div>
                      </div>
                      <div
                        className="case-tabs"
                        role="tablist"
                        aria-label="Case details"
                        onKeyDown={(event) => {
                          const tabs: Tab[] = [
                            "overview",
                            "evidence",
                            "response",
                            "activity",
                          ];
                          const current = tabs.indexOf(tab);
                          const next =
                            event.key === "ArrowRight"
                              ? (current + 1) % tabs.length
                              : event.key === "ArrowLeft"
                                ? (current + tabs.length - 1) % tabs.length
                                : event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? tabs.length - 1
                                    : -1;
                          if (next < 0) return;
                          event.preventDefault();
                          setTab(tabs[next]);
                          document.getElementById(`tab-${tabs[next]}`)?.focus();
                        }}
                      >
                        {(
                          [
                            ["overview", "Overview"],
                            ["evidence", "Evidence"],
                            ["response", "Response"],
                            ["activity", "Activity"],
                          ] as [Tab, string][]
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            role="tab"
                            aria-selected={tab === value}
                            tabIndex={tab === value ? 0 : -1}
                            aria-controls={`panel-${value}`}
                            id={`tab-${value}`}
                            className={tab === value ? "active" : ""}
                            onClick={() => setTab(value)}
                          >
                            {label}
                            {value === "evidence" && evidence.length > 0 && (
                              <span>{evidence.length}</span>
                            )}
                            {value === "activity" && running && (
                              <span className="tab-live-dot" />
                            )}
                          </button>
                        ))}
                      </div>
                      <div
                        className="tab-content"
                        role="tabpanel"
                        id={`panel-${tab}`}
                        aria-labelledby={`tab-${tab}`}
                      >
                        {tab === "overview" && (
                          <>
                            <div className="complaint-box">
                              <div className="small-label">
                                <MessageSquareText size={14} />
                                CUSTOMER'S CLAIM
                              </div>
                              <blockquote>“{selected.claim}”</blockquote>
                              <span>Opened {date(selected.openedAt)}</span>
                            </div>
                            {!report && !running && (
                              <div className="investigate-intro">
                                <div
                                  className="investigate-illustration"
                                  aria-hidden="true"
                                >
                                  <div className="illustration-card card-back">
                                    <CreditCard size={18} />
                                    <i />
                                    <i />
                                  </div>
                                  <div className="illustration-card card-front">
                                    <FileSearch size={22} />
                                    <i />
                                    <i />
                                    <span>
                                      <Check size={11} />
                                    </span>
                                  </div>
                                </div>
                                <h3>
                                  {run?.status === "stopped"
                                    ? "Pick up the investigation."
                                    : run?.status === "failed"
                                      ? "Let’s try that again."
                                      : "The answer is in the evidence."}
                                </h3>
                                <p>
                                  {run?.status === "failed"
                                    ? run.error ||
                                      "The investigation could not finish. Check your connections and try again."
                                    : "Connect the payment, ticket, and delivery records to understand what happened."}
                                </p>
                                <button
                                  className="button button-primary"
                                  onClick={investigate}
                                  disabled={Boolean(busy)}
                                >
                                  {busy === "investigate" ? (
                                    <Spinner small />
                                  ) : (
                                    <Sparkles size={16} />
                                  )}{" "}
                                  {run
                                    ? "Restart investigation"
                                    : "Investigate case"}
                                  <ArrowRight size={16} />
                                </button>
                                <span className="read-only-caption">
                                  <LockKeyhole size={11} />
                                  Reads evidence only. Nothing is sent or
                                  refunded.
                                </span>
                              </div>
                            )}
                            {running && (
                              <InvestigationProgress
                                run={run}
                                onStop={stop}
                                busy={busy === "stop"}
                              />
                            )}
                            {report && (
                              <>
                                <div
                                  className={`report-summary assessment-${report.assessment}`}
                                >
                                  <div className="report-summary-heading">
                                    <span>
                                      <Sparkles size={15} />
                                      INVESTIGATION COMPLETE
                                    </span>
                                    <span className="mono">
                                      {(
                                        report.metrics.durationMs / 1000
                                      ).toFixed(1)}
                                      s
                                    </span>
                                  </div>
                                  <h3>
                                    {report.assessment === "supported"
                                      ? "Evidence supports a response."
                                      : report.assessment === "mixed"
                                        ? "There are two sides to this case."
                                        : "More evidence is needed."}
                                  </h3>
                                  <p>{report.summary}</p>
                                  <div className="report-summary-footer">
                                    <span>
                                      <Layers3 size={14} />
                                      {report.metrics.recordCount} records
                                      reviewed
                                    </span>
                                    <button
                                      className="text-button"
                                      onClick={() => setTab("response")}
                                    >
                                      Review response
                                      <ArrowRight size={14} />
                                    </button>
                                  </div>
                                </div>
                                <div className="section-heading">
                                  <h3>What we found</h3>
                                  <span>{report.findings.length} findings</span>
                                </div>
                                <div className="findings-list">
                                  {report.findings.map((finding) => (
                                    <article
                                      className={`finding finding-${finding.stance}`}
                                      key={finding.id}
                                    >
                                      <span className="finding-icon">
                                        {finding.stance ===
                                        "supports_merchant" ? (
                                          <CircleCheck size={18} />
                                        ) : finding.stance ===
                                          "supports_customer" ? (
                                          <TriangleAlert size={18} />
                                        ) : (
                                          <Info size={18} />
                                        )}
                                      </span>
                                      <div>
                                        <h4>{finding.title}</h4>
                                        <p>{finding.detail}</p>
                                        <div className="citation-row">
                                          {finding.evidenceIds.map((id) => (
                                            <button
                                              key={id}
                                              className="citation"
                                              onClick={() => {
                                                const found = evidence.find(
                                                  (item) => item.id === id,
                                                );
                                                if (found) setRecord(found);
                                              }}
                                              disabled={
                                                !evidence.some(
                                                  (item) => item.id === id,
                                                )
                                              }
                                            >
                                              <FileText size={11} />
                                              {id}
                                              <ArrowUpRight size={10} />
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                                {report.gaps.length > 0 && (
                                  <div className="gaps-box">
                                    <h4>
                                      <CircleHelp size={15} />
                                      What we couldn't establish
                                    </h4>
                                    <ul>
                                      {report.gaps.map((gap, i) => (
                                        <li key={i}>{gap}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <div className="next-step">
                                  <span className="next-step-icon">
                                    <ArrowRight size={18} />
                                  </span>
                                  <div>
                                    <h4>Recommended next step</h4>
                                    <p>{report.recommendation}</p>
                                  </div>
                                </div>
                              </>
                            )}
                            <EvidenceRail
                              groups={run?.evidence || []}
                              running={Boolean(running)}
                            />
                          </>
                        )}
                        {tab === "evidence" && (
                          <EvidencePanel
                            groups={run?.evidence || []}
                            onOpen={setRecord}
                            running={Boolean(running)}
                          />
                        )}
                        {tab === "activity" && (
                          <ActivityPanel
                            run={run}
                            onStop={stop}
                            busy={busy === "stop"}
                          />
                        )}
                        {tab === "response" &&
                          (report ? (
                            <div className="response-panel">
                              <div className="section-heading">
                                <h3>Your response draft</h3>
                                {report.reviewedAt ? (
                                  <span className="reviewed-label">
                                    <CheckCheck size={14} />
                                    {dirty ? "Unsaved changes" : "Reviewed"}
                                  </span>
                                ) : (
                                  <span>Ready for your review</span>
                                )}
                              </div>
                              <p className="section-description">
                                Check the facts and make this response your own.
                                The export includes the supporting evidence.
                              </p>
                              <label
                                className="sr-only"
                                htmlFor="response-draft"
                              >
                                Response draft
                              </label>
                              <textarea
                                id="response-draft"
                                className="response-editor"
                                value={draft}
                                onChange={(event) => {
                                  setDraft(event.target.value);
                                  setReviewChecked(false);
                                }}
                              />
                              <div className="draft-meta">
                                <FileText size={13} />
                                {
                                  draft.trim().split(/\s+/).filter(Boolean)
                                    .length
                                }{" "}
                                words<span>·</span>
                                {report.evidenceIds.length} cited records
                              </div>
                              <label
                                className="field-label"
                                htmlFor="review-note"
                              >
                                Internal review note <span>Optional</span>
                              </label>
                              <textarea
                                id="review-note"
                                className="note-editor"
                                placeholder="Anything your team should know about this response?"
                                value={note}
                                onChange={(event) => {
                                  setNote(event.target.value);
                                  setReviewChecked(false);
                                }}
                              />
                              <label className="review-checkbox">
                                <input
                                  type="checkbox"
                                  checked={reviewChecked}
                                  onChange={(event) =>
                                    setReviewChecked(event.target.checked)
                                  }
                                />
                                <span>
                                  I have reviewed this response and its
                                  supporting evidence.
                                </span>
                              </label>
                              <div className="export-actions">
                                <button
                                  className="button button-primary"
                                  disabled={
                                    !reviewChecked ||
                                    !draft.trim() ||
                                    Boolean(busy)
                                  }
                                  onClick={() => review("markdown")}
                                >
                                  {busy === "markdown" ? (
                                    <Spinner small />
                                  ) : (
                                    <ArrowDownToLine size={16} />
                                  )}
                                  Export response
                                </button>
                                <button
                                  className="button button-secondary"
                                  disabled={
                                    !reviewChecked ||
                                    !draft.trim() ||
                                    Boolean(busy)
                                  }
                                  onClick={() => review("json")}
                                >
                                  {busy === "json" ? (
                                    <Spinner small />
                                  ) : (
                                    <Database size={15} />
                                  )}
                                  Evidence JSON
                                </button>
                                <button
                                  className="text-button"
                                  disabled={
                                    !reviewChecked ||
                                    !draft.trim() ||
                                    Boolean(busy)
                                  }
                                  onClick={() => review()}
                                >
                                  {busy === "review"
                                    ? "Saving..."
                                    : "Save review"}
                                </button>
                              </div>
                              {config?.archiveEnabled && (
                                <button
                                  className="button button-secondary archive-button"
                                  disabled={
                                    !reviewChecked ||
                                    !draft.trim() ||
                                    Boolean(busy)
                                  }
                                  onClick={archive}
                                >
                                  {busy === "archive" ? (
                                    <Spinner small />
                                  ) : (
                                    <Cloud size={15} />
                                  )}
                                  Archive to S3
                                </button>
                              )}
                              <div className="export-note">
                                <ShieldCheck size={14} />
                                <p>
                                  Downloads a case packet for your records. It
                                  does not submit a dispute response or contact
                                  the customer.
                                </p>
                              </div>
                            </div>
                          ) : (
                            <Empty
                              icon={FileText}
                              title="A response starts with the facts."
                            >
                              Run an investigation first. Your evidence-backed
                              draft will be ready to review here.
                            </Empty>
                          ))}
                      </div>
                      <div className="case-workspace-footer">
                        <span>
                          <LockKeyhole size={12} />
                          Only evidence linked to this case
                        </span>
                        {report && (
                          <button
                            className="text-button"
                            onClick={investigate}
                            disabled={Boolean(busy) || running}
                          >
                            Run again
                            <ArrowRight size={12} />
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={FolderClosed}
                      title="Your next case starts here."
                    >
                      Select a case from the inbox or connect your evidence API
                      to add one.
                    </Empty>
                  )}
                </section>
              </div>
            </>
          ) : view === "connections" ? (
            <Connections config={config} onImport={() => setImportOpen(true)} />
          ) : (
            <Guide />
          )}
          <footer className="page-footer">
            <span>
              Casework<span className="footer-dot">·</span>A clearer picture of
              every dispute.
            </span>
            <span>AWS Hackathon 2026</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {record && (
        <EvidenceDrawer record={record} onClose={() => setRecord(null)} />
      )}
      {importOpen && (
        <ImportDialog
          connected={Boolean(config?.merchantConnected)}
          busy={busy === "import"}
          onClose={() => setImportOpen(false)}
          onImport={importCase}
          onConnections={() => {
            setImportOpen(false);
            setView("connections");
          }}
          error={error}
        />
      )}
    </div>
  );
}

function EvidenceRail({
  groups,
  running,
}: {
  groups: EvidenceEnvelope[];
  running: boolean;
}) {
  const steps: {
    label: string;
    sections: EvidenceSection[];
    icon: typeof Ticket;
  }[] = [
    { label: "Purchase", sections: ["summary", "order"], icon: CreditCard },
    { label: "Fulfillment", sections: ["tickets", "delivery"], icon: Ticket },
    {
      label: "Conversation",
      sections: ["support", "history"],
      icon: MessageSquareText,
    },
  ];
  return (
    <div className="evidence-rail">
      {steps.map(({ label, sections, icon: Icon }) => {
        const found = groups.filter((group) =>
          sections.includes(group.section),
        );
        const count = found.reduce(
          (sum, group) => sum + group.records.length,
          0,
        );
        return (
          <div className={`rail-step ${count ? "collected" : ""}`} key={label}>
            <span className="rail-icon">
              <Icon size={17} />
            </span>
            <strong>{label}</strong>
            <small>
              {found.length
                ? `${count} ${count === 1 ? "record" : "records"}`
                : running
                  ? "Checking..."
                  : "Ready to check"}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function InvestigationProgress({
  run,
  onStop,
  busy,
}: {
  run: InvestigationRun;
  onStop: () => void;
  busy: boolean;
}) {
  const latest = run.events.at(-1);
  const count = run.evidence.reduce(
    (sum, group) => sum + group.records.length,
    0,
  );
  return (
    <div className="investigation-progress" role="status">
      <div className="progress-top">
        <span className="progress-spinner">
          <Spinner />
        </span>
        <div>
          <h3>Following the evidence</h3>
          <p>{latest?.title || "Starting your investigation..."}</p>
        </div>
        <button className="button button-stop" onClick={onStop} disabled={busy}>
          {busy ? <Spinner small /> : <Square size={12} fill="currentColor" />}
          Stop
        </button>
      </div>
      <div className="progress-track">
        <span />
      </div>
      <div className="progress-foot">
        <span>{count} records collected</span>
        <span>
          {run.mode === "bedrock"
            ? "Investigating with AWS Bedrock"
            : "Running sample investigation"}
        </span>
      </div>
    </div>
  );
}

function EvidencePanel({
  groups,
  onOpen,
  running,
}: {
  groups: EvidenceEnvelope[];
  onOpen: (record: EvidenceRecord) => void;
  running: boolean;
}) {
  if (!groups.length)
    return (
      <Empty
        icon={Layers3}
        title={
          running
            ? "Gathering the first records..."
            : "Every fact has a source."
        }
      >
        {running
          ? "Retrieved records will appear here as the investigation progresses."
          : "Start an investigation to collect the payment, order, and delivery evidence for this case."}
      </Empty>
    );
  return (
    <div className="evidence-panel">
      <div className="section-heading">
        <h3>The source of every finding</h3>
        <span>
          {groups.reduce((sum, group) => sum + group.records.length, 0)} records
        </span>
      </div>
      <p className="section-description">
        Open a record to see its source, timestamp, and original fields.
      </p>
      {groups.map((group) => {
        const Icon = sectionIcons[group.section];
        return (
          <section className="evidence-group" key={group.section}>
            <div className="evidence-group-heading">
              <h4>
                <Icon size={16} />
                {sectionLabels[group.section]}
                <span>{group.records.length}</span>
              </h4>
              <span className={`coverage-label coverage-${group.status}`}>
                {group.status === "available"
                  ? "Records available"
                  : group.status === "partial"
                    ? "Partial coverage"
                    : "Unavailable"}
              </span>
            </div>
            {group.records.map((item) => (
              <button
                className="evidence-record"
                key={item.id}
                onClick={() => onOpen(item)}
              >
                <span className="record-file">
                  <FileText size={17} />
                </span>
                <span className="record-text">
                  <strong>{item.title}</strong>
                  <small>
                    {item.source}
                    <span>·</span>
                    {date(item.occurredAt, true)}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {group.limitations.length > 0 && (
              <div className="evidence-limitations">
                <Info size={13} />
                <span>{group.limitations.join(" ")}</span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ActivityPanel({
  run,
  onStop,
  busy,
}: {
  run: InvestigationRun | null;
  onStop: () => void;
  busy: boolean;
}) {
  if (!run)
    return (
      <Empty icon={Activity} title="An investigation you can follow.">
        Every evidence request and result appears here when the investigation
        starts.
      </Empty>
    );
  return (
    <div className="activity-panel">
      <div className="section-heading">
        <h3>Investigation activity</h3>
        {run.status === "running" ? (
          <button
            className="button button-stop"
            onClick={onStop}
            disabled={busy}
          >
            <Square size={11} fill="currentColor" />
            Stop
          </button>
        ) : (
          <span className={`run-state run-${run.status}`}>{run.status}</span>
        )}
      </div>
      <p className="section-description">
        A record of the requests made and the evidence returned.
      </p>
      <ol className="activity-list">
        {run.events.map((event) => (
          <ActivityEvent key={event.id} event={event} />
        ))}
      </ol>
      <div className="activity-run-id">
        <span>Run reference</span>
        <code>{run.id}</code>
      </div>
    </div>
  );
}

function ActivityEvent({ event }: { event: RunEvent }) {
  const Icon =
    event.type === "error" || event.type === "blocked"
      ? TriangleAlert
      : event.type === "completed" || event.type === "tool_completed"
        ? Check
        : event.type === "stopped"
          ? Square
          : event.type.startsWith("model")
            ? Sparkles
            : ArrowRight;
  return (
    <li className={`activity-event event-${event.type}`}>
      <span className="activity-event-icon">
        <Icon size={13} />
      </span>
      <div>
        <div className="activity-event-top">
          <strong>{event.title}</strong>
          <time dateTime={event.at}>
            {new Date(event.at).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            })}
          </time>
        </div>
        <p>{event.detail}</p>
        {event.evidenceIds?.length ? (
          <span className="activity-count">
            {event.evidenceIds.length} evidence records
          </span>
        ) : null}
      </div>
    </li>
  );
}

function Modal({
  children,
  onClose,
  className = "",
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className={`modal-backdrop ${className}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={ref}
      >
        {children}
      </div>
    </div>
  );
}

function EvidenceDrawer({
  record,
  onClose,
}: {
  record: EvidenceRecord;
  onClose: () => void;
}) {
  return (
    <Modal
      label="Evidence record"
      className="drawer-backdrop"
      onClose={onClose}
    >
      <div className="drawer-header">
        <span className="small-label">
          <FileText size={14} />
          SOURCE RECORD
        </span>
        <button
          className="icon-button"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="drawer-body">
        <span className="record-id mono">{record.id}</span>
        <h2>{record.title}</h2>
        <p className="drawer-detail">{record.detail}</p>
        <div className="source-metadata">
          <div>
            <span>Source</span>
            <strong>{record.source}</strong>
          </div>
          <div>
            <span>Recorded</span>
            <strong>{date(record.occurredAt, true)}</strong>
          </div>
          <div>
            <span>Source reference</span>
            <code>{record.sourceId}</code>
          </div>
        </div>
        <h3>Record fields</h3>
        <dl className="record-fields">
          {Object.entries(record.fields).map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, " ")}</dt>
              <dd>
                {value === null
                  ? "Not available"
                  : typeof value === "boolean"
                    ? value
                      ? "Yes"
                      : "No"
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
        <div className="drawer-footnote">
          <ShieldCheck size={16} />
          <p>
            This record was retrieved within the selected case's evidence scope.
          </p>
        </div>
      </div>
    </Modal>
  );
}

function ImportDialog({
  connected,
  busy,
  onClose,
  onImport,
  onConnections,
  error,
}: {
  connected: boolean;
  busy: boolean;
  onClose: () => void;
  onImport: (id: string) => void;
  onConnections: () => void;
  error: string | null;
}) {
  const [caseId, setCaseId] = useState("");
  return (
    <Modal label="Add a case" onClose={onClose}>
      <div className="dialog-header">
        <span className="dialog-icon">
          <FolderClosed size={22} />
        </span>
        <button
          className="icon-button"
          aria-label="Close add case"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <h2>Add a case</h2>
      <p className="dialog-description">
        Import an approved case from your business's evidence API.
      </p>
      {connected ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onImport(caseId.trim());
          }}
        >
          <label className="field-label" htmlFor="import-case-id">
            Case reference
          </label>
          <input
            id="import-case-id"
            className="text-input"
            placeholder="Your approved case ID"
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            required
            autoComplete="off"
          />
          <p className="field-help">
            Access and linked records are verified by your business's backend.
          </p>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={!caseId.trim() || busy}
            >
              {busy ? <Spinner small /> : <Plus size={15} />}Import case
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="connection-needed">
            <Unplug size={21} />
            <div>
              <strong>Connect your evidence API first.</strong>
              <p>
                The sample workspace is ready to explore. Add your merchant
                connection to investigate real cases.
              </p>
            </div>
          </div>
          <div className="dialog-actions">
            <button className="button button-secondary" onClick={onClose}>
              Explore sample cases
            </button>
            <button className="button button-primary" onClick={onConnections}>
              View connections
              <ArrowRight size={15} />
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Connections({
  config,
  onImport,
}: {
  config: AppConfig | null;
  onImport: () => void;
}) {
  return (
    <div className="connections-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECTED BY THE CASE</div>
          <h1>Your evidence, within reach.</h1>
          <p>Give Casework access to the records an investigation needs.</p>
        </div>
      </div>
      <div className="connection-grid">
        <article className="connection-card">
          <div className="connection-card-top">
            <span className="connection-logo aws-logo">
              <Cloud size={27} />
            </span>
            <span
              className={`connection-status ${config?.mode === "bedrock" ? "connected" : ""}`}
            >
              {config?.mode === "bedrock" ? "Enabled" : "Sample mode"}
            </span>
          </div>
          <h2>Amazon Bedrock</h2>
          <p>
            Investigates the evidence and prepares a response using a model in
            your AWS account.
          </p>
          <dl>
            <div>
              <dt>Region</dt>
              <dd>{config?.awsRegion || "Not configured"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{config?.modelId || "Configure in your environment"}</dd>
            </div>
          </dl>
          <div className="connection-card-foot">
            <Info size={14} />
            <span>
              {config?.mode === "bedrock"
                ? "Requests run through your configured AWS account."
                : "The sample investigator works without AWS credentials."}
            </span>
          </div>
        </article>
        <article className="connection-card">
          <div className="connection-card-top">
            <span className="connection-logo merchant-logo">
              <Ticket size={26} />
            </span>
            <span
              className={`connection-status ${config?.merchantConnected ? "connected" : ""}`}
            >
              {config?.merchantConnected ? "Configured" : "Not connected"}
            </span>
          </div>
          <h2>ATMSPHR evidence API</h2>
          <p>
            Brings together the linked payment, order, tickets, delivery events,
            and conversations.
          </p>
          <dl>
            <div>
              <dt>Access</dt>
              <dd>Read-only, approved cases</dd>
            </div>
            <div>
              <dt>Database credentials</dt>
              <dd>Stay with your business</dd>
            </div>
          </dl>
          <div className="connection-card-foot">
            {config?.merchantConnected ? (
              <button className="text-button" onClick={onImport}>
                Import an approved case
                <ArrowRight size={14} />
              </button>
            ) : (
              <>
                <LockKeyhole size={14} />
                <span>
                  Set the endpoint and case access token on the server.
                </span>
              </>
            )}
          </div>
        </article>
        <article className="connection-card">
          <div className="connection-card-top">
            <span className="connection-logo archive-logo">
              <Database size={25} />
            </span>
            <span
              className={`connection-status ${config?.archiveEnabled ? "connected" : ""}`}
            >
              {config?.archiveEnabled ? "Enabled" : "Local exports"}
            </span>
          </div>
          <h2>Amazon S3</h2>
          <p>
            Optionally archive the reviewed evidence packets in your own private
            AWS bucket.
          </p>
          <dl>
            <div>
              <dt>Evidence export</dt>
              <dd>Markdown and JSON</dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd>Required before export</dd>
            </div>
          </dl>
          <div className="connection-card-foot">
            <FileCheck2 size={14} />
            <span>Review and download packets from each case.</span>
          </div>
        </article>
      </div>
      <div className="setup-note">
        <div>
          <ShieldCheck size={23} />
        </div>
        <div>
          <h3>A smaller window into your data.</h3>
          <p>
            Each investigation requests evidence for one approved case. Your
            backend decides which records and fields are returned. Missing
            records stay marked as missing.
          </p>
          <p className="setup-instruction">
            To connect live services, follow the repository's setup guide and
            configure the server environment. Never put AWS or database
            credentials into the browser.
          </p>
        </div>
      </div>
    </div>
  );
}

function Guide() {
  return (
    <div className="guide-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM CLAIM TO CLARITY</div>
          <h1>A case file you can stand behind.</h1>
          <p>One investigation. Every source. Your final call.</p>
        </div>
      </div>
      <div className="guide-steps">
        {[
          {
            icon: FolderClosed,
            title: "Start with the complaint.",
            text: "Select a dispute or import an approved case from your business. The case connects the complaint to its payment and order.",
          },
          {
            icon: FileSearch,
            title: "Let the evidence tell the story.",
            text: "Casework retrieves the relevant records, follows delivery and support history, and builds a timeline of what happened.",
          },
          {
            icon: FileCheck2,
            title: "Review, then respond.",
            text: "Inspect each source, check the findings, and edit the response. Export the reviewed packet for your own dispute workflow.",
          },
        ].map((item, index) => (
          <article className="guide-step" key={item.title}>
            <span className="guide-step-number">0{index + 1}</span>
            <item.icon size={30} strokeWidth={1.5} />
            <h2>{item.title}</h2>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
      <div className="guide-facts">
        <h2>Clear about what the evidence means.</h2>
        <div>
          <p>
            <CircleCheck size={18} />
            <span>
              An issued ticket is evidence of issuance. Delivery records tell a
              separate part of the story.
            </span>
          </p>
          <p>
            <CircleHelp size={18} />
            <span>
              A missing scan does not mean the customer did not attend. Gaps
              stay visible in the report.
            </span>
          </p>
          <p>
            <ShieldCheck size={18} />
            <span>
              You review the final response. Casework does not send messages,
              issue refunds, or submit disputes.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function Login({
  onLogin,
  busy,
  error,
}: {
  onLogin: (token: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [token, setToken] = useState("");
  return (
    <div className="login-page">
      <div className="login-card">
        <Brand compact />
        <div className="login-icon">
          <LockKeyhole size={26} />
        </div>
        <h1>Your workspace is private.</h1>
        <p>Enter your team access token to open the dispute workspace.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onLogin(token);
          }}
        >
          <label className="field-label" htmlFor="access-token">
            Workspace access token
          </label>
          <input
            className="text-input"
            id="access-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            autoComplete="current-password"
          />
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="button button-primary" disabled={!token || busy}>
            {busy ? <Spinner small /> : <LockKeyhole size={16} />}Open workspace
            <ArrowRight size={16} />
          </button>
        </form>
        <span className="login-caption">
          Ask your workspace owner for access.
        </span>
      </div>
    </div>
  );
}
