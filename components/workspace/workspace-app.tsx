"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Square,
  CreditCard,
  Database,
  FileCheck2,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import type {
  AccessRequest,
  DisputeCase,
  EvidenceSource,
  InvestigationRun,
  InvestigationConfig,
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/domain";
import { formatMoney as money } from "@/lib/money";
import {
  AccountSettings,
  AccessRequestDetail,
  AttachPolicy,
  ConnectionDetail,
  PolicyLibrary,
  ReportPreview,
  ScopeConfiguration,
  SetupChecklist,
  SubmissionOutcome,
  SubmissionReadiness,
} from "./workspace-extra";
import type { ScreenPreview } from "@/lib/design/fixtures";
import "./workspace.css";

type View =
  | "overview"
  | "cases"
  | "evidence"
  | "integrations"
  | "access"
  | "settings"
  | "setup"
  | "policies"
  | "scope";
type ModalType =
  | "case"
  | "evidence"
  | "policy"
  | "access"
  | "submit"
  | "attach-policy"
  | "import"
  | null;
type InvestigationResult = {
  run: InvestigationRun | null;
  state?: WorkspaceState;
  error?: string;
  caseId?: string;
};
type Identity = { id: string; name: string; email: string };
type StripeStatus = {
  submissionEnabled?: boolean;
  requiredConfiguration?: string[];
  configured?: boolean;
  connected?: boolean;
  mode?: string;
  accountName?: string;
  missing?: string[];
  message?: string;
};
const views: { id: View; title: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", title: "Overview", icon: LayoutDashboard },
  { id: "cases", title: "Cases", icon: FolderOpen },
  { id: "evidence", title: "Evidence", icon: FileText },
  { id: "integrations", title: "Connections", icon: Link2 },
  { id: "access", title: "Access & activity", icon: ShieldCheck },
  { id: "settings", title: "Settings", icon: Settings2 },
];
const statusNames: Record<string, string> = {
  needs_review: "Needs review",
  investigating: "Investigating",
  ready: "Ready for review",
  submitted: "Submitted",
  submitting: "Submitting / verifying",
  won: "Won",
  lost: "Lost",
  pending: "Pending approval",
  approved: "Approved",
  denied: "Denied",
};
function date(value?: string, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "Not available";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "Not available"
    : d.toLocaleDateString("en-US", {
        timeZone: "UTC",
        ...(options ?? { month: "short", day: "numeric" }),
      });
}
function calendarDate(value?: string, options?: Intl.DateTimeFormatOptions) {
  return date(value, {
    month: "short",
    day: "numeric",
    ...options,
    timeZone: "UTC",
  });
}
function dateTime(value?: string) {
  return date(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
function deadline(value: string) {
  const n = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  return Number.isNaN(n)
    ? "No deadline"
    : n < 0
      ? "Past due"
      : n === 0
        ? "Due today"
        : `${n} day${n === 1 ? "" : "s"} left`;
}
function formText(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function sourceName(value: string) {
  return (
    (
      {
        stripe: "Stripe",
        gmail: "Gmail",
        database: "Company records",
        policy: "Company policy",
        manual: "Manual evidence",
      } as Record<string, string>
    )[value] ?? value
  );
}
function sourceIcon(value: string) {
  return value === "gmail"
    ? Mail
    : value === "database"
      ? Database
      : value === "stripe"
        ? CreditCard
        : FileText;
}
function Badge({ status }: { status: string }) {
  const tone = ["needs_review", "ready", "pending"].includes(status)
    ? "orange"
    : ["won", "approved", "connected"].includes(status)
      ? "green"
      : ["lost", "denied"].includes(status)
        ? "red"
        : "";
  return (
    <span className={`cw-pill ${tone}`}>
      {statusNames[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}
function Empty({
  icon: Icon = FolderOpen,
  title,
  description,
  children,
}: {
  icon?: typeof FolderOpen;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="cw-empty">
      <span className="cw-icon-well">
        <Icon size={25} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {children && <div className="cw-actions">{children}</div>}
    </div>
  );
}
function Button({
  children,
  onClick,
  disabled,
  primary,
  orange,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  orange?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cw-button ${primary ? "primary" : ""} ${orange ? "orange" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="cw-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Modal({
  title,
  onClose,
  children,
  error,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      "input,textarea,button,select",
    );
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled),input,textarea,select",
          ) ?? [],
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="cw-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="cw-modal-head">
          <h2>{title}</h2>
          <button
            className="cw-button ghost icon"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="cw-modal-body">
          {error && (
            <div className="cw-banner error" role="alert">
              <TriangleAlert size={20} />
              <p>{error}</p>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceApp({
  user,
  signOutPath,
  preview,
}: {
  user: Identity;
  signOutPath: string;
  preview?: ScreenPreview;
}) {
  const [state, setState] = useState<WorkspaceState | null>(
    preview?.state ?? null,
  );
  const [loading, setLoading] = useState(
      preview ? preview.mode === "loading" : true,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(preview?.error ?? "");
  const [sessionExpired, setSessionExpired] = useState(
      preview?.mode === "session",
    ),
    [dirtyReport, setDirtyReport] = useState(false);
  const [view, setView] = useState<View>((preview?.view as View) ?? "overview"),
    [caseId, setCaseId] = useState<string | null>(preview?.caseId ?? null),
    [modal, setModal] = useState<ModalType>(
      (preview?.modal as ModalType) ?? null,
    );
  const [detail, setDetail] = useState<Record<string, string>>(
    preview?.detail ?? {},
  );
  const [search, setSearch] = useState(preview?.search ?? ""),
    [filter, setFilter] = useState("all"),
    [toast, setToast] = useState("");
  const [stripe, setStripe] = useState<StripeStatus | null>(
    preview?.stripe ?? null,
  );
  const [investigationConfig, setInvestigationConfig] =
    useState<InvestigationConfig | null>(null);
  const [runs, setRuns] = useState<Record<string, InvestigationRun | null>>({});
  const [pendingInvestigation, setPendingInvestigation] = useState<
    string | null
  >(null);
  const [cancelling, setCancelling] = useState(false);
  const investigationController = useRef<AbortController | null>(null);
  const runStatuses = useRef<Record<string, string>>({});
  const closeModal = useCallback(() => setModal(null), []);
  const routeFromUrl = useCallback(() => {
    if (preview) return;
    const q = new URLSearchParams(window.location.search);
    const v = q.get("view") as View;
    setView(
      [...views.map((x) => x.id), "setup", "policies", "scope"].includes(v)
        ? v
        : "overview",
    );
    setCaseId(q.get("case"));
    setSearch(q.get("search") ?? "");
    setFilter(q.get("status") ?? "all");
    setDetail(
      Object.fromEntries(
        ["tab", "evidence", "source", "request"].flatMap((k) =>
          q.has(k) ? [[k, q.get(k)!]] : [],
        ),
      ),
    );
  }, [preview]);
  // Synchronize the initial route and browser history with this client workspace.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    routeFromUrl();
  }, [routeFromUrl]);
  useEffect(() => {
    if (preview) return;
    const onHistoryChange = () => {
      if (
        dirtyReport &&
        !window.confirm("Leave this report without saving your changes?")
      ) {
        const q = new URLSearchParams({
          view,
          ...(caseId ? { case: caseId } : {}),
          ...detail,
          ...(search ? { search } : {}),
          ...(filter !== "all" ? { status: filter } : {}),
        });
        window.history.pushState({}, "", `/workspace?${q}`);
        return;
      }
      setDirtyReport(false);
      routeFromUrl();
    };
    window.addEventListener("popstate", onHistoryChange);
    return () => window.removeEventListener("popstate", onHistoryChange);
  }, [
    preview,
    dirtyReport,
    view,
    caseId,
    detail,
    search,
    filter,
    routeFromUrl,
  ]);
  const navigate = useCallback(
    (next: string, id?: string, more: Record<string, string> = {}) => {
      if (
        dirtyReport &&
        !window.confirm("Leave this report without saving your changes?")
      )
        return;
      setDirtyReport(false);
      setView(next as View);
      setCaseId(id ?? null);
      setDetail(more);
      setSearch("");
      setFilter("all");
      setError("");
      if (!preview) {
        const q = new URLSearchParams({
          view: next,
          ...(id ? { case: id } : {}),
          ...more,
        });
        window.history.pushState({}, "", `/workspace?${q}`);
      }
      window.scrollTo({ top: 0, behavior: "instant" });
    },
    [preview, dirtyReport],
  );
  const updateDetail = (key: string, value: string) => {
    setDetail((old) => ({ ...old, [key]: value }));
    if (!preview) {
      const q = new URLSearchParams(window.location.search);
      q.set(key, value);
      window.history.replaceState({}, "", `/workspace?${q}`);
    }
  };
  const updateSearch = (value: string) => {
    setSearch(value);
    if (!preview) {
      const q = new URLSearchParams(window.location.search);
      if (value) q.set("search", value);
      else q.delete("search");
      window.history.replaceState({}, "", `/workspace?${q}`);
    }
  };
  const updateFilter = (value: string) => {
    setFilter(value);
    if (!preview) {
      const q = new URLSearchParams(window.location.search);
      if (value !== "all") q.set("status", value);
      else q.delete("status");
      window.history.replaceState({}, "", `/workspace?${q}`);
    }
  };
  const load = useCallback(
    async (clearError = true) => {
      if (preview) return;
      if (clearError) setError("");
      try {
        const r = await fetch("/api/workspace", { cache: "no-store" });
        const data = (await r.json()) as WorkspaceState & {
          error?: string;
          message?: string;
          url?: string;
          redirectUrl?: string;
          imported?: number;
          hasMore?: boolean;
        };
        if (r.status === 401) setSessionExpired(true);
        if (!r.ok)
          throw new Error(data.error ?? "Could not open your workspace.");
        setState(data);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not open your workspace.",
        );
      } finally {
        setLoading(false);
      }
    },
    [preview],
  );
  // Load the owner-scoped external store after hydration.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const workspaceId = state?.workspace?.id;
  useEffect(() => {
    if (!preview && workspaceId)
      void fetch("/api/stripe/status", { cache: "no-store" })
        .then(async (r) => (await r.json()) as StripeStatus)
        .then(setStripe)
        .catch(() => setStripe(null));
  }, [view, workspaceId, preview]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (preview || !workspaceId) return;
    let cancelled = false;
    fetch("/api/investigations", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Investigation configuration could not be loaded.");
        return response.json() as Promise<{ config: InvestigationConfig }>;
      })
      .then((data) => {
        if (!cancelled) setInvestigationConfig(data.config);
      })
      .catch(() => {
        if (!cancelled) setInvestigationConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, view, preview]);

  const loadRun = useCallback(
    async (id: string, signal?: AbortSignal) => {
      if (preview) return null;
      const response = await fetch(
        `/api/investigations?caseId=${encodeURIComponent(id)}`,
        { cache: "no-store", signal },
      );
      const data = (await response.json()) as InvestigationResult;
      if (response.status === 401) setSessionExpired(true);
      if (!response.ok)
        throw new Error(
          data.error || "Investigation progress could not be loaded.",
        );
      setRuns((previous) => ({ ...previous, [id]: data.run }));
      if (data.run) {
        const previousStatus = runStatuses.current[data.run.id];
        runStatuses.current[data.run.id] = data.run.status;
        if (previousStatus === "running" && data.run.status !== "running")
          await load(false);
      }
      return data.run;
    },
    [load, preview],
  );

  useEffect(() => {
    if (preview || !caseId || !workspaceId) return;
    const controller = new AbortController();
    // Load the selected case from its external investigation store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRun(caseId, controller.signal).catch((error) => {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Investigation progress is unavailable.",
        );
    });
    return () => controller.abort();
  }, [caseId, workspaceId, loadRun, preview]);

  const visibleRun = caseId
    ? Object.hasOwn(runs, caseId)
      ? runs[caseId]
      : state?.cases.find((item) => item.id === caseId)?.investigation
    : null;
  useEffect(() => {
    if (preview) return;
    const target =
      pendingInvestigation ||
      (visibleRun?.status === "running" ? caseId : null);
    if (!target) return;
    let fetching = false;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        await loadRun(target, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Investigation progress is unavailable. Refresh the case to reconnect.",
          );
      } finally {
        fetching = false;
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [pendingInvestigation, visibleRun?.status, caseId, loadRun, preview]);

  useEffect(() => () => investigationController.current?.abort(), []);

  const startInvestigation = async (id: string, mode: "sample" | "bedrock") => {
    if (preview) {
      setToast(
        "Design preview only. No investigation or storage action was performed.",
      );
      return;
    }
    if (pendingInvestigation) return;
    setError("");
    setPendingInvestigation(id);
    setRuns((previous) => ({ ...previous, [id]: null }));
    const controller = new AbortController();
    investigationController.current = controller;
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", caseId: id, mode }),
        signal: controller.signal,
      });
      const data = (await response.json()) as InvestigationResult;
      if (response.status === 401) setSessionExpired(true);
      if (!response.ok)
        throw new Error(data.error || "The investigation could not start.");
      if (data.state) setState(data.state);
      if (data.run) {
        runStatuses.current[data.run.id] = data.run.status;
        setRuns((previous) => ({ ...previous, [id]: data.run }));
        if (data.run.status === "failed" || data.run.status === "stale")
          setError(
            data.run.error ||
              "The investigation could not produce a current draft. Refresh the case and try again.",
          );
        else if (data.run.status === "completed")
          setToast(
            mode === "bedrock"
              ? "AWS investigation complete. Review the findings and response."
              : "Sample investigation complete. This result uses a deterministic demo, not an AWS model.",
          );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        await load(false);
        setError(
          error instanceof Error
            ? error.message
            : "The investigation could not finish. Refresh the case to check its status.",
        );
      }
    } finally {
      if (investigationController.current === controller)
        investigationController.current = null;
      setPendingInvestigation(null);
    }
  };

  const cancelInvestigation = async (run: InvestigationRun) => {
    if (preview) {
      setToast(
        "Design preview only. No investigation or storage action was performed.",
      );
      return;
    }
    setCancelling(true);
    setError("");
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", runId: run.id }),
      });
      const data = (await response.json()) as InvestigationResult;
      if (response.status === 401) setSessionExpired(true);
      if (!response.ok)
        throw new Error(
          data.error || "The investigation could not be cancelled. Try again.",
        );
      if (data.run)
        setRuns((previous) => ({ ...previous, [run.caseId]: data.run }));
      if (pendingInvestigation === run.caseId)
        investigationController.current?.abort();
      await load(false);
      setToast("Investigation cancelled. No draft was approved or submitted.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Cancellation failed. Check the current run before retrying.",
      );
    } finally {
      setCancelling(false);
    }
  };

  const archiveCase = async (id: string, revision: number) => {
    if (preview) {
      setToast(
        "Design preview only. No investigation or storage action was performed.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/investigations/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id, revision }),
      });
      const data = (await response.json()) as {
        error?: string;
        archived?: boolean;
      };
      if (!response.ok || !data.archived)
        throw new Error(
          data.error || "The evidence packet could not be archived.",
        );
      setToast("Approved evidence packet archived to your private S3 bucket.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "S3 archive failed. Your reviewed draft is still available.",
      );
    } finally {
      setBusy(false);
    }
  };

  const importApprovedCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (preview) {
      setToast("Design preview only. No case was imported.");
      return;
    }
    const externalCaseId = formText(
      new FormData(event.currentTarget),
      "externalCaseId",
    );
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/investigations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", externalCaseId }),
      });
      const data = (await response.json()) as InvestigationResult;
      if (response.status === 401) setSessionExpired(true);
      if (!response.ok)
        throw new Error(
          data.error || "The approved case could not be imported.",
        );
      if (data.state) setState(data.state);
      setModal(null);
      if (data.caseId) navigate("cases", data.caseId);
      setToast("Approved case imported with its scoped evidence.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Case import failed.");
    } finally {
      setBusy(false);
    }
  };

  const mutate = useCallback(
    async (action: WorkspaceAction, message?: string): Promise<boolean> => {
      if (preview) {
        setToast("Design preview only. No workspace data was changed.");
        return false;
      }
      setBusy(true);
      setError("");
      try {
        const r = await fetch("/api/workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        const data = (await r.json()) as WorkspaceState & {
          error?: string;
          message?: string;
          url?: string;
          redirectUrl?: string;
          imported?: number;
          hasMore?: boolean;
        };
        if (r.status === 401) setSessionExpired(true);
        if (!r.ok)
          throw new Error(data.error ?? "This action could not be completed.");
        setState(data);
        if (action.action === "createWorkspace") {
          setView("setup");
          window.history.replaceState({}, "", "/workspace?view=setup");
        }
        if (message) setToast(message);
        return true;
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "This action could not be completed.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [preview],
  );
  const stripeAction = async (
    action: "connect" | "sync" | "disconnect" | "submit",
    body?: object,
  ) => {
    if (preview) {
      setToast("Design preview only. No Stripe action was performed.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/stripe/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = (await r.json()) as WorkspaceState & {
        error?: string;
        message?: string;
        url?: string;
        redirectUrl?: string;
        imported?: number;
        hasMore?: boolean;
      };
      if (r.status === 401) setSessionExpired(true);
      if (!r.ok)
        throw new Error(
          data.error ?? data.message ?? "Stripe connection needs attention.",
        );
      const redirectUrl = data.url ?? data.redirectUrl;
      if (redirectUrl) {
        window.location.assign(redirectUrl);
        return;
      }
      await load();
      setModal(null);
      setToast(
        data.message ??
          (action === "sync"
            ? `${data.imported ?? 0} disputes synchronized.${data.hasMore ? " Sync again for remaining records." : ""}`
            : action === "submit"
              ? "Evidence submitted to Stripe."
              : "Stripe connection updated."),
      );
      const status = await fetch("/api/stripe/status").then(
        async (r) => (await r.json()) as StripeStatus,
      );
      setStripe(status);
    } catch (e) {
      if (action === "submit") await load();
      setError(
        e instanceof Error ? e.message : "Stripe connection needs attention.",
      );
    } finally {
      setBusy(false);
    }
  };
  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (preview) {
      setToast("Design preview only. No file was uploaded.");
      return;
    }
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const file = form.get("file");
      if (!(file instanceof File) || !file.size)
        throw new Error("Choose a file to attach.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Files must be 10 MB or smaller.");

      const runtimeResponse = await fetch("/api/runtime");
      if (runtimeResponse.status === 401) setSessionExpired(true);
      let presignedUpload = false;
      if (runtimeResponse.ok) {
        const runtime = (await runtimeResponse.json()) as {
          storage?: string;
          uploads?: string;
        };
        presignedUpload =
          runtime.storage === "aws" && runtime.uploads === "presigned";
        if (!presignedUpload)
          throw new Error(
            "Attachment uploads are not available. Add a text evidence record instead.",
          );
      } else if (runtimeResponse.status !== 404) {
        throw new Error(
          "Could not check attachment storage. Please try again.",
        );
      }

      let r: Response;
      if (presignedUpload) {
        const preparedResponse = await fetch("/api/evidence/prepare-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId: formText(form, "caseId"),
            title: formText(form, "title"),
            source: formText(form, "source") || "manual",
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        const prepared = (await preparedResponse.json()) as {
          uploadId?: string;
          uploadUrl?: string;
          fields?: Record<string, string>;
          method?: string;
          error?: string;
        };
        if (preparedResponse.status === 401) setSessionExpired(true);
        if (!preparedResponse.ok)
          throw new Error(prepared.error ?? "Could not prepare the upload.");
        if (
          !prepared.uploadId ||
          prepared.method !== "POST" ||
          !prepared.fields ||
          !prepared.uploadUrl ||
          !prepared.uploadUrl.startsWith("https://")
        )
          throw new Error(
            "The upload could not be prepared. Please try again.",
          );
        const uploadForm = new FormData();
        for (const [key, value] of Object.entries(prepared.fields))
          uploadForm.append(key, value);
        uploadForm.append("file", file);
        const stored = await fetch(prepared.uploadUrl, {
          method: "POST",
          body: uploadForm,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!stored.ok)
          throw new Error("The file could not be uploaded. Please try again.");
        r = await fetch("/api/evidence/finalize-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: prepared.uploadId }),
        });
      } else {
        r = await fetch("/api/evidence/upload", {
          method: "POST",
          body: form,
        });
      }
      const data = (await r.json()) as WorkspaceState & {
        error?: string;
        message?: string;
        url?: string;
        redirectUrl?: string;
        imported?: number;
        hasMore?: boolean;
      };
      if (r.status === 401) setSessionExpired(true);
      if (!r.ok) throw new Error(data.error ?? "Upload failed.");
      setState(data);
      setModal(null);
      setToast("Evidence added to the case.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };
  const current = state?.cases.find((c) => c.id === caseId);
  const act = async (
    e: FormEvent<HTMLFormElement>,
    action: (f: FormData) => WorkspaceAction,
    message: string,
  ) => {
    e.preventDefault();
    if (await mutate(action(new FormData(e.currentTarget)), message))
      setModal(null);
  };
  const filtered =
    state?.cases.filter(
      (c) =>
        (filter === "all" || c.status === filter) &&
        `${c.title} ${c.customerName} ${c.email} ${c.orderRef}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  const seed = () =>
    mutate(
      { action: "seedDemo" },
      "Sample cases added. They are clearly labeled and do not connect to Stripe.",
    );

  return (
    <div className="cw cw-shell" data-design-screen={preview?.id}>
      {/* Full document navigation preserves the unsaved-report beforeunload guard. */}
      <aside className="cw-sidebar">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="cw-brand" href="/" aria-label="Causality">
          <span className="cw-mark">C</span>
          <span>Causality</span>
        </a>
        <div className="cw-workspace-label">
          <Building2 size={18} />
          <span>{state?.workspace?.name ?? "Your workspace"}</span>
          <ChevronDown size={14} />
        </div>
        <nav className="cw-nav" aria-label="Workspace navigation">
          {views.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              aria-label={title}
              title={title}
              className={view === id ? "active" : ""}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              <span>{title}</span>
              {id === "cases" && !!state?.cases.length && (
                <small>{state.cases.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="cw-sidebar-bottom">
          <div className="cw-nav">
            <a href="/" target="_blank" rel="noreferrer">
              <CircleHelp size={20} />
              <span>The Causality approach</span>
            </a>
          </div>
          <div className="cw-user">
            <span className="cw-avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="cw-user-name" title={user.email}>
              {user.name.split(" ")[0]}
            </span>
            <a href={signOutPath} target="_top" title="Sign out">
              <LogOut size={18} />
            </a>
          </div>
        </div>
      </aside>
      <main className="cw-main">
        <header className="cw-topbar">
          <div className="cw-breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={16} />
            <strong>
              {views.find((v) => v.id === view)?.title ??
                (
                  {
                    setup: "Workspace setup",
                    policies: "Company policies",
                    scope: "Data scope",
                  } as Record<string, string>
                )[view]}
            </strong>
            {current && (
              <>
                <ChevronRight size={16} />
                <span>{current.orderRef || current.customerName}</span>
              </>
            )}
          </div>
          <div className="cw-top-actions">
            <span className="cw-caption">
              <span className="cw-status-dot" />
              Merchant review required
            </span>
            <button
              className="cw-button ghost icon"
              onClick={() => navigate("access")}
              aria-label="View activity"
            >
              <Bell size={20} />
            </button>
          </div>
        </header>
        <div className="cw-content">
          {error && (
            <div role="alert" className="cw-banner error">
              <TriangleAlert size={20} />
              <p>{error}</p>
              <button
                aria-label="Dismiss error"
                className="cw-button ghost icon"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {sessionExpired ? (
            <div className="cw-panel cw-recovery">
              <Empty
                icon={LockKeyhole}
                title="Let’s reconnect your session."
                description="Your workspace is still here. Sign in again to continue with your cases and evidence."
              >
                <a
                  className="cw-button primary"
                  href={`/login?returnTo=${encodeURIComponent(`/workspace?view=${view}${caseId ? `&case=${caseId}` : ""}`)}`}
                  target="_top"
                >
                  Sign in to continue
                  <ArrowRight size={18} />
                </a>
              </Empty>
            </div>
          ) : loading ? (
            <div className="cw-loading">
              <LoaderCircle className="cw-spin" size={24} />
              Opening your workspace…
            </div>
          ) : !state || preview?.mode === "error" ? (
            <div className="cw-panel cw-recovery">
              <Empty
                title="Your workspace couldn’t load."
                description="Check your connection and try again."
              >
                <Button
                  onClick={() => {
                    setLoading(true);
                    void load();
                  }}
                >
                  <RefreshCw size={18} />
                  Try again
                </Button>
              </Empty>
            </div>
          ) : !state.workspace ? (
            <Onboarding
              busy={busy}
              create={mutate}
              initialStep={preview?.onboardingStep}
              designMode={!!preview}
            />
          ) : (
            <>
              {view === "overview" && (
                <div className="cw-setup-link">
                  <span className="cw-step-icon">
                    <Check size={20} />
                  </span>
                  <div>
                    <h3>Make the workspace yours.</h3>
                    <p>
                      Review your business context, policies, and evidence
                      readiness.
                    </p>
                  </div>
                  <Button onClick={() => navigate("setup")}>
                    Setup checklist
                    <ArrowRight size={18} />
                  </Button>
                </div>
              )}
              {view === "overview" && (
                <Overview
                  state={state}
                  busy={busy}
                  navigate={navigate}
                  seed={seed}
                  addCase={() => setModal("case")}
                />
              )}
              {view === "cases" && caseId && !current && (
                <div className="cw-panel cw-recovery">
                  <Empty
                    title="This case isn’t available."
                    description="It may not exist, or it may belong to a different workspace. Your other investigations are still available."
                  >
                    <Button primary onClick={() => navigate("cases")}>
                      Back to cases
                      <ArrowRight size={18} />
                    </Button>
                  </Empty>
                </div>
              )}
              {view === "cases" && !caseId && (
                <>
                  <div className="cw-page-head">
                    <div>
                      <h1>Every case. In context.</h1>
                      <p>Your disputes, their evidence, and the next step.</p>
                    </div>
                    <Button primary onClick={() => setModal("case")}>
                      <Plus size={18} />
                      New case
                    </Button>
                  </div>
                  <div className="cw-toolbar">
                    <div className="cw-search">
                      <Search size={18} />
                      <input
                        aria-label="Search cases"
                        placeholder="Search customer, order, or case…"
                        value={search}
                        onChange={(e) => updateSearch(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Filter case status"
                      value={filter}
                      onChange={(e) => updateFilter(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      {Object.entries(statusNames)
                        .filter(([key]) =>
                          [
                            "needs_review",
                            "investigating",
                            "ready",
                            "submitting",
                            "submitted",
                            "won",
                            "lost",
                          ].includes(key),
                        )
                        .map(([key, name]) => (
                          <option key={key} value={key}>
                            {name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <CaseTable
                    noMatches={!!search || filter !== "all"}
                    clearSearch={() => {
                      updateSearch("");
                      updateFilter("all");
                    }}
                    cases={filtered}
                    onOpen={(c) => navigate("cases", c.id)}
                    emptyAction={
                      <Button onClick={() => setModal("case")}>
                        <Plus size={18} />
                        Create a case
                      </Button>
                    }
                  />
                </>
              )}
              {view === "cases" && current && (
                <CaseDetail
                  key={`${current.id}:${current.draft?.revision}:${current.draft?.status}`}
                  current={current}
                  run={visibleRun || null}
                  investigationConfig={investigationConfig}
                  investigating={
                    pendingInvestigation === current.id ||
                    visibleRun?.status === "running"
                  }
                  cancelling={cancelling}
                  investigate={(mode) =>
                    void startInvestigation(current.id, mode)
                  }
                  cancelInvestigation={() => {
                    if (visibleRun) void cancelInvestigation(visibleRun);
                  }}
                  archive={() => {
                    if (current.draft)
                      void archiveCase(current.id, current.draft.revision);
                  }}
                  openConnections={() => navigate("integrations")}
                  submissionEnabled={Boolean(stripe?.submissionEnabled)}
                  connected={state.integrations.some(
                    (i) => i.provider === "stripe" && i.status === "connected",
                  )}
                  initialTab={detail.tab}
                  initialEvidence={detail.evidence}
                  onTab={(v) => updateDetail("tab", v)}
                  onEvidence={(v) => updateDetail("evidence", v)}
                  unsavedPreview={preview?.unsaved}
                  onDirtyChange={setDirtyReport}
                  navigate={navigate}
                  attachPolicy={() => setModal("attach-policy")}
                  busy={busy}
                  mutate={mutate}
                  back={() => navigate("cases")}
                  addEvidence={() => setModal("evidence")}
                  requestAccess={() => setModal("access")}
                  submit={() => setModal("submit")}
                />
              )}
              {view === "evidence" && (
                <EvidenceLibrary
                  state={state}
                  search={search}
                  setSearch={updateSearch}
                  open={(id, evidence) =>
                    navigate("cases", id, { tab: "investigation", evidence })
                  }
                />
              )}
              {view === "integrations" && !detail.source && (
                <Integrations
                  state={state}
                  stripe={stripe}
                  investigationConfig={investigationConfig}
                  importCase={() => setModal("import")}
                  busy={busy}
                  stripeAction={stripeAction}
                  requestAccess={() => setModal("access")}
                  navigate={navigate}
                />
              )}
              {view === "integrations" && detail.source && (
                <ConnectionDetail
                  provider={detail.source}
                  state={state}
                  stripe={stripe}
                  busy={busy}
                  action={stripeAction}
                  navigate={navigate}
                  requestAccess={() => setModal("access")}
                  healthError={preview?.healthError}
                />
              )}
              {view === "access" && !detail.request && (
                <Access
                  state={state}
                  initialTab={detail.tab}
                  onTab={(v) => updateDetail("tab", v)}
                  openRequest={(id) => updateDetail("request", id)}
                  busy={busy}
                  mutate={mutate}
                  request={() => setModal("access")}
                  openCase={(id) => navigate("cases", id)}
                />
              )}
              {view === "access" &&
                detail.request &&
                (state.accessRequests.find((r) => r.id === detail.request) ? (
                  <AccessRequestDetail
                    request={state.accessRequests.find(
                      (r) => r.id === detail.request,
                    )!}
                    state={state}
                    navigate={navigate}
                  />
                ) : (
                  <Empty
                    title="Request unavailable."
                    description="Choose an available request from the access queue."
                  >
                    <Button onClick={() => navigate("access")}>
                      Back to requests
                    </Button>
                  </Empty>
                ))}
              {view === "setup" && (
                <SetupChecklist
                  state={state}
                  navigate={navigate}
                  addCase={() => setModal("case")}
                  addPolicy={() => setModal("policy")}
                />
              )}
              {view === "policies" && (
                <PolicyLibrary
                  state={state}
                  busy={busy}
                  mutate={mutate}
                  addPolicy={() => setModal("policy")}
                />
              )}
              {view === "scope" && (
                <ScopeConfiguration
                  state={state}
                  preview={detail.tab === "preview"}
                  designMode={!!preview}
                  navigate={navigate}
                />
              )}
              {view === "settings" && (
                <>
                  <div className="cw-tabs cw-settings-tabs">
                    <button
                      className={detail.tab !== "account" ? "active" : ""}
                      onClick={() => updateDetail("tab", "business")}
                    >
                      Business details
                    </button>
                    <button
                      className={detail.tab === "account" ? "active" : ""}
                      onClick={() => updateDetail("tab", "account")}
                    >
                      Account & access
                    </button>
                    <button onClick={() => navigate("policies")}>
                      Company policies
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  {detail.tab === "account" ? (
                    <AccountSettings state={state} />
                  ) : (
                    <Settings state={state} busy={busy} mutate={mutate} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
      {toast && (
        <div className="cw-toast" role="status">
          <Check size={20} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {modal === "import" && (
        <Modal
          title="Import an approved case"
          onClose={closeModal}
          error={error}
        >
          <form
            className="cw-form"
            onSubmit={(event) => void importApprovedCase(event)}
          >
            <p>
              Your business’s evidence API verifies the case and returns only
              its permitted records.
            </p>
            <Field
              label="Approved case reference"
              hint="Use the external case ID registered by your business. An order number alone does not grant access."
            >
              <input
                name="externalCaseId"
                required
                maxLength={160}
                pattern="[A-Za-z0-9_-]+"
                placeholder="case_approved_1042"
                autoComplete="off"
              />
            </Field>
            <div className="cw-modal-actions">
              <Button onClick={closeModal}>Cancel</Button>
              <Button
                primary
                type="submit"
                disabled={busy || !investigationConfig?.merchantConfigured}
              >
                {busy ? (
                  <LoaderCircle className="cw-spin" size={18} />
                ) : (
                  <Database size={18} />
                )}
                Import case
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "case" && (
        <Modal
          title="Start an investigation"
          onClose={closeModal}
          error={error}
        >
          <form
            className="cw-form"
            onSubmit={(e) =>
              void act(
                e,
                (f) => ({
                  action: "addCase",
                  title: formText(f, "title"),
                  customerName: formText(f, "customerName"),
                  email: formText(f, "email"),
                  amount: Math.round(Number(formText(f, "amount")) * 100),
                  currency: formText(f, "currency"),
                  reason: formText(f, "reason"),
                  orderRef: formText(f, "orderRef"),
                  dueAt: new Date(formText(f, "dueAt")).toISOString(),
                }),
                "Case created.",
              )
            }
          >
            <Field label="Case title">
              <input
                name="title"
                required
                minLength={3}
                maxLength={160}
                placeholder="Product not received"
              />
            </Field>
            <div className="cw-form-grid">
              <Field label="Customer name">
                <input
                  name="customerName"
                  required
                  maxLength={120}
                  placeholder="Alex Morgan"
                />
              </Field>
              <Field label="Customer email">
                <input
                  name="email"
                  type="email"
                  placeholder="alex@example.com"
                />
              </Field>
            </div>
            <div className="cw-form-grid">
              <Field label="Amount disputed">
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  max="9999999"
                  required
                  placeholder="248.00"
                />
              </Field>
              <Field label="Currency">
                <select name="currency">
                  <option value="usd">USD · US dollar</option>
                  <option value="gbp">GBP · British pound</option>
                  <option value="eur">EUR · Euro</option>
                  <option value="cad">CAD · Canadian dollar</option>
                  <option value="aud">AUD · Australian dollar</option>
                </select>
              </Field>
            </div>
            <div className="cw-form-grid">
              <Field label="Order reference">
                <input name="orderRef" placeholder="#1048" maxLength={100} />
              </Field>
              <Field label="Response deadline">
                <input name="dueAt" type="date" required />
              </Field>
            </div>
            <Field label="Customer allegation">
              <textarea
                name="reason"
                required
                maxLength={4000}
                placeholder="Describe the reason for the dispute in the customer’s words."
              />
            </Field>
            <p className="cw-caption">
              This creates a manual case. It does not submit a dispute or send a
              message.
            </p>
            <div className="cw-modal-actions">
              <Button onClick={closeModal}>Cancel</Button>
              <Button type="submit" primary disabled={busy}>
                {busy ? "Creating…" : "Create case"}
                <ArrowRight size={18} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "evidence" && current && (
        <Modal title="Add case evidence" onClose={closeModal} error={error}>
          <EvidenceForm
            defaultDate={preview ? "2026-11-07T12:00" : ""}
            initialMode={preview?.evidenceMode}
            current={current}
            busy={busy}
            upload={upload}
            submit={(e) =>
              void act(
                e,
                (f) => ({
                  action: "addEvidence",
                  caseId: current.id,
                  source: formText(f, "source") as EvidenceSource,
                  title: formText(f, "title"),
                  content: formText(f, "content"),
                  occurredAt: new Date(formText(f, "occurredAt")).toISOString(),
                  reference: formText(f, "reference"),
                }),
                "Evidence added to the case.",
              )
            }
          />
        </Modal>
      )}
      {modal === "access" && (
        <Modal
          title="Request additional access"
          onClose={closeModal}
          error={error}
        >
          <form
            className="cw-form"
            onSubmit={(e) =>
              void act(
                e,
                (f) => ({
                  action: "requestAccess",
                  caseId: current?.id,
                  scope: formText(f, "scope"),
                  reason: formText(f, "reason"),
                }),
                "Access request recorded for independent review.",
              )
            }
          >
            <p>
              Describe the exact records required. Requests stay pending until
              an independent reviewer approves them.
            </p>
            <Field label="Requested records and fields">
              <textarea
                name="scope"
                required
                minLength={3}
                maxLength={500}
                placeholder="Delivery photo and recipient signature for order #1048 only."
              />
            </Field>
            <Field label="Why this evidence is needed">
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={2000}
                placeholder="The carrier reports delivery, but the customer disputes receipt."
              />
            </Field>
            <div className="cw-banner neutral">
              <LockKeyhole size={20} />
              <p>
                You cannot approve your own request. Recording a request does
                not grant database access.
              </p>
            </div>
            <Button primary type="submit" disabled={busy}>
              {busy ? "Recording…" : "Request review"}
              <ArrowRight size={18} />
            </Button>
          </form>
        </Modal>
      )}
      {modal === "policy" && (
        <Modal title="Add a company policy" onClose={closeModal} error={error}>
          <form
            className="cw-form"
            onSubmit={(e) =>
              void act(
                e,
                (f) => ({
                  action: "addPolicy",
                  name: formText(f, "name"),
                  content: formText(f, "content"),
                  effectiveDate: formText(f, "effectiveDate"),
                }),
                "Policy saved.",
              )
            }
          >
            <Field label="Policy name">
              <input
                name="name"
                required
                minLength={2}
                maxLength={160}
                placeholder="Returns and refunds"
              />
            </Field>
            <Field label="Effective date">
              <input name="effectiveDate" type="date" required />
            </Field>
            <Field label="Policy text">
              <textarea
                name="content"
                required
                minLength={10}
                maxLength={24000}
                style={{ minHeight: 230 }}
                placeholder="Paste the policy that applied when the customer placed their order."
              />
            </Field>
            <p className="cw-caption">
              A policy is evidence. Adding one does not authorize access to
              customer data.
            </p>
            <Button primary type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save policy"}
            </Button>
          </form>
        </Modal>
      )}
      {modal === "attach-policy" && current && state && (
        <Modal
          title="Attach an applicable policy"
          onClose={closeModal}
          error={error}
        >
          <AttachPolicy
            policies={state.policies}
            current={current}
            busy={busy}
            attach={async (p) => {
              if (
                await mutate(
                  {
                    action: "addEvidence",
                    caseId: current.id,
                    source: "policy",
                    title: p.name,
                    content: p.content,
                    occurredAt: new Date(p.effectiveDate).toISOString(),
                    reference: `Policy ${p.id} · effective ${p.effectiveDate}`,
                  },
                  "Policy snapshot attached. Review the updated draft.",
                )
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {preview && (
        <div className="cw-design-note">
          SYNTHETIC DESIGN PREVIEW · {preview.id}
        </div>
      )}
      {modal === "submit" && current && (
        <Modal
          title="Submit evidence to Stripe?"
          onClose={closeModal}
          error={error}
        >
          <div className="cw-form">
            <p>
              You’re preparing to submit the approved draft for{" "}
              <strong>{current.orderRef || current.title}</strong> to Stripe.
            </p>
            <div className="cw-banner">
              <TriangleAlert size={22} />
              <p>
                Evidence generally cannot be changed after submission. Check the
                response, sources, and attachments before proceeding.
              </p>
            </div>
            <p>
              {current.source === "demo"
                ? "Sample cases cannot be submitted."
                : "The issuing bank decides the outcome. Causality does not guarantee a decision."}
            </p>
            <div className="cw-modal-actions">
              <Button onClick={closeModal}>Keep reviewing</Button>
              <Button
                primary
                disabled={
                  busy ||
                  ["submitting", "submitted", "won", "lost"].includes(
                    current.status,
                  ) ||
                  current.source !== "stripe" ||
                  current.draft?.status !== "approved" ||
                  !stripe?.submissionEnabled
                }
                onClick={() =>
                  void stripeAction("submit", {
                    caseId: current.id,
                    confirmed: true,
                    draftRevision: current.draft?.revision,
                  })
                }
              >
                {busy ? "Submitting…" : "Submit approved evidence"}
                <ArrowRight size={18} />
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Onboarding({
  busy,
  create,
  initialStep = 0,
  designMode = false,
}: {
  busy: boolean;
  create: (action: WorkspaceAction, message?: string) => Promise<boolean>;
  initialStep?: number;
  designMode?: boolean;
}) {
  const [step, setStep] = useState(initialStep),
    [name, setName] = useState(designMode ? "Aster Supply" : ""),
    [industry, setIndustry] = useState(""),
    [website, setWebsite] = useState(""),
    [accepted, setAccepted] = useState(false);
  const complete = (e: FormEvent) => {
    e.preventDefault();
    void create(
      { action: "createWorkspace", name: name.trim(), industry, website },
      "Your workspace is ready.",
    );
  };
  return (
    <div className="cw-onboarding">
      <div className="cw-onboarding-title">
        <span className="cw-eyebrow">WELCOME TO CAUSALITY</span>
        <h1 style={{ marginTop: 18 }}>
          Set the context.
          <br />
          We’ll help you find the story.
        </h1>
        <p>
          A few details create the home for your cases, evidence, and company
          policies.
        </p>
      </div>
      <div
        className="cw-onboarding-progress"
        aria-label={`Setup step ${step + 1} of 3`}
      >
        {[0, 1, 2].map((s) => (
          <span key={s} className={s <= step ? "active" : ""} />
        ))}
      </div>
      <section className="cw-panel cw-onboarding-card">
        {step === 0 && (
          <form
            className="cw-form"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(1);
            }}
          >
            <h2>Your business.</h2>
            <p>
              These details identify your workspace. You can update them later.
            </p>
            <Field label="Business name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={100}
                placeholder="Aster Supply"
                autoFocus
              />
            </Field>
            <div className="cw-form-grid">
              <Field label="Industry">
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                >
                  <option value="">Select an industry</option>
                  <option>Retail & ecommerce</option>
                  <option>Software & subscriptions</option>
                  <option>Travel & hospitality</option>
                  <option>Professional services</option>
                  <option>Events & experiences</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Website (optional)">
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={500}
                  type="url"
                  placeholder="https://example.com"
                />
              </Field>
            </div>
            <div className="cw-modal-actions">
              <Button primary type="submit">
                Continue
                <ArrowRight size={18} />
              </Button>
            </div>
          </form>
        )}
        {step === 1 && (
          <div className="cw-form">
            <h2>Start with the right sources.</h2>
            <p>
              Your workspace starts empty. Connect Stripe, add source records,
              or explore clearly labeled sample cases after setup.
            </p>
            <div className="cw-choice">
              <span className="cw-icon-well">
                <CreditCard size={24} />
              </span>
              <div>
                <h3>Stripe disputes</h3>
                <p>
                  Import dispute details and payment evidence from your
                  configured Stripe environment.
                </p>
              </div>
            </div>
            <div className="cw-choice">
              <span className="cw-icon-well">
                <FileText size={24} />
              </span>
              <div>
                <h3>Evidence & company policies</h3>
                <p>
                  Add selected records, customer messages, attachments, and the
                  policy versions that apply.
                </p>
              </div>
            </div>
            <div className="cw-banner neutral">
              <Database size={21} />
              <p>
                Gmail and database connectors require additional configuration.
                They will not read customer data automatically.
              </p>
            </div>
            <div className="cw-modal-actions">
              <Button onClick={() => setStep(0)}>Back</Button>
              <Button primary onClick={() => setStep(2)}>
                Continue
                <ArrowRight size={18} />
              </Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <form className="cw-form" onSubmit={complete}>
            <h2>Your team stays in control.</h2>
            <p>
              Causality organizes evidence for a considered response. You decide
              what to approve and submit.
            </p>
            <ul className="cw-scope-list">
              <li>
                <ShieldCheck size={20} />
                <span>
                  Only records you add or explicitly connect enter your
                  workspace.
                </span>
              </li>
              <li>
                <FileCheck2 size={20} />
                <span>
                  Findings remain linked to their sources, including
                  contradictions and gaps.
                </span>
              </li>
              <li>
                <LockKeyhole size={20} />
                <span>
                  Broader access requires independent review. Policies do not
                  grant permissions.
                </span>
              </li>
            </ul>
            <div className="cw-check">
              <input
                id="review-ack"
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                required
              />
              <label htmlFor="review-ack">
                I understand that my team must review evidence before
                submission, and that the issuing bank determines the outcome.
              </label>
            </div>
            <div className="cw-modal-actions">
              <Button onClick={() => setStep(1)}>Back</Button>
              <Button type="submit" primary disabled={busy || !accepted}>
                {busy ? "Creating workspace…" : "Open my workspace"}
                <ArrowRight size={18} />
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function Overview({
  state,
  busy,
  navigate,
  seed,
  addCase,
}: {
  state: WorkspaceState;
  busy: boolean;
  navigate: (view: View, id?: string) => void;
  seed: () => Promise<boolean>;
  addCase: () => void;
}) {
  const realCases = state.cases.filter((c) => c.source !== "demo"),
    sampleOnly = !realCases.length && !!state.cases.length,
    cases = realCases.length ? realCases : state.cases;
  const open = cases.filter((c) => !["won", "lost"].includes(c.status));
  const currencies = [...new Set(open.map((c) => c.currency))];
  const amounts = currencies.length
    ? currencies.map((currency) => ({
        currency,
        amount: open
          .filter((c) => c.currency === currency)
          .reduce((total, c) => total + c.amount, 0),
      }))
    : [{ currency: "usd", amount: 0 }];
  const evidenceCount = cases.reduce((a, c) => a + c.evidence.length, 0);
  return (
    <>
      <div className="cw-page-head">
        <div>
          <span className="cw-caption">
            {date(new Date().toISOString(), {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <h1 style={{ marginTop: 8 }}>The full picture.</h1>
          <p>A clear view of your disputes and the evidence behind them.</p>
        </div>
        <div className="cw-actions">
          {state.cases.length > 0 && (
            <Button onClick={() => void seed()} disabled={busy}>
              <Sparkles size={18} />
              Load sample cases
            </Button>
          )}
          <Button primary onClick={addCase}>
            <Plus size={18} />
            New case
          </Button>
        </div>
      </div>
      {sampleOnly && (
        <div className="cw-banner neutral">
          <Sparkles size={20} />
          <p>
            You’re exploring synthetic sample cases. No Stripe data has been
            imported.
          </p>
        </div>
      )}
      <div className="cw-grid">
        <div className="cw-stat accent">
          <div className="cw-stat-label">
            <span>
              {sampleOnly ? "Sample amount disputed" : "Amount disputed"}
            </span>
            <CreditCard size={20} />
          </div>
          <div className="cw-stat-value">
            {amounts.map((item) => (
              <div key={item.currency}>{money(item.amount, item.currency)}</div>
            ))}
          </div>
          <p>
            Across {open.length} open {open.length === 1 ? "case" : "cases"}
          </p>
        </div>
        <div className="cw-stat">
          <div className="cw-stat-label">
            <span>Awaiting your review</span>
            <FileCheck2 size={20} />
          </div>
          <div className="cw-stat-value">
            {
              cases.filter((c) => ["needs_review", "ready"].includes(c.status))
                .length
            }
          </div>
          <p>Prepared for a considered decision</p>
        </div>
        <div className="cw-stat">
          <div className="cw-stat-label">
            <span>Linked evidence records</span>
            <FileText size={20} />
          </div>
          <div className="cw-stat-value">{evidenceCount}</div>
          <p>Each source stays in context</p>
        </div>
      </div>
      {!state.cases.length ? (
        <div className="cw-two-col">
          <div className="cw-panel">
            <Empty
              title="Your first case starts here."
              description="Connect Stripe to import disputes, or create a case and add the relevant evidence yourself."
            >
              <Button primary onClick={() => navigate("integrations")}>
                <Link2 size={18} />
                Connect a source
              </Button>
              <Button onClick={addCase}>
                Create manually
                <ArrowRight size={18} />
              </Button>
            </Empty>
          </div>
          <div className="cw-panel">
            <div className="cw-panel-body">
              <span className="cw-icon-well">
                <Sparkles size={24} />
              </span>
              <h2 style={{ margin: "16px 0 12px" }}>See a case in context.</h2>
              <p>
                Explore a synthetic investigation with a payment record,
                delivery scan, and conflicting customer message.
              </p>
              <Button
                className="full"
                onClick={() => void seed()}
                disabled={busy}
              >
                <Sparkles size={18} />
                {busy ? "Loading…" : "Load sample cases"}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="cw-panel-stack">
          <div className="cw-panel">
            <div className="cw-panel-header">
              <h3>Cases that need attention</h3>
              <button
                className="cw-button ghost small"
                onClick={() => navigate("cases")}
              >
                All cases
                <ArrowRight size={17} />
              </button>
            </div>
            <CaseTable
              cases={state.cases
                .filter((c) => !["won", "lost"].includes(c.status))
                .slice(0, 5)}
              onOpen={(c) => navigate("cases", c.id)}
              nested
            />
          </div>
          <div className="cw-two-col">
            <div className="cw-panel">
              <div className="cw-panel-header">
                <h3>Recent activity</h3>
                <Button
                  className="ghost small"
                  onClick={() => navigate("access")}
                >
                  Activity log
                  <ArrowRight size={16} />
                </Button>
              </div>
              <div className="cw-panel-body">
                <ActivityList state={state} limit={4} />
              </div>
            </div>
            <div className="cw-panel">
              <div className="cw-panel-header">
                <h3>Your investigation toolkit</h3>
              </div>
              <div className="cw-panel-body">
                <div className="cw-step">
                  <span className="cw-step-icon">
                    <CreditCard size={20} />
                  </span>
                  <div className="cw-step-copy">
                    <h3>Connect your sources</h3>
                    <p>Bring the relevant records together.</p>
                  </div>
                  <button
                    className="cw-button ghost icon"
                    onClick={() => navigate("integrations")}
                    aria-label="Manage connections"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
                <div className="cw-step">
                  <span className="cw-step-icon">
                    <FileText size={20} />
                  </span>
                  <div className="cw-step-copy">
                    <h3>Add your policies</h3>
                    <p>Use the terms that applied.</p>
                  </div>
                  <button
                    className="cw-button ghost icon"
                    onClick={() => navigate("policies")}
                    aria-label="Manage policies"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
                <div className="cw-step">
                  <span className="cw-step-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <div className="cw-step-copy">
                    <h3>Inspect access</h3>
                    <p>Keep scope and activity visible.</p>
                  </div>
                  <button
                    className="cw-button ghost icon"
                    onClick={() => navigate("access")}
                    aria-label="Inspect access"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CaseTable({
  cases,
  onOpen,
  emptyAction,
  nested,
  noMatches,
  clearSearch,
}: {
  cases: DisputeCase[];
  onOpen: (c: DisputeCase) => void;
  emptyAction?: ReactNode;
  nested?: boolean;
  noMatches?: boolean;
  clearSearch?: () => void;
}) {
  const content = cases.length ? (
    <div className="cw-table-wrap">
      <table className="cw-table">
        <thead>
          <tr>
            <th>Customer & case</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Response deadline</th>
            <th aria-label="Open case" />
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c)}>
              <td>
                <button
                  className="cw-row-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(c);
                  }}
                >
                  <span className="cw-case-name">{c.customerName}</span>
                  <p>
                    {c.orderRef ? `${c.orderRef} · ` : ""}
                    {c.title}
                    {c.source === "demo" && " · Sample"}
                  </p>
                </button>
              </td>
              <td className="cw-money">{money(c.amount, c.currency)}</td>
              <td>
                <Badge status={c.status} />
              </td>
              <td>
                {calendarDate(c.dueAt)}
                <p>{deadline(c.dueAt)}</p>
              </td>
              <td>
                <ArrowRight size={18} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title={noMatches ? "No cases match that search." : "No cases here yet."}
      description={
        noMatches
          ? "Try another customer, order reference, or status."
          : "Create a case or connect Stripe to start an investigation."
      }
    >
      {noMatches ? (
        <Button onClick={clearSearch}>Clear search & filters</Button>
      ) : (
        emptyAction
      )}
    </Empty>
  );
  return nested ? content : <div className="cw-panel">{content}</div>;
}

function draftMethodLabel(method?: string) {
  return method === "bedrock"
    ? "Amazon Bedrock investigation"
    : method === "sample_investigator"
      ? "Sample investigation"
      : "Evidence template";
}

function CaseDetail({
  current,
  busy,
  mutate,
  back,
  addEvidence,
  requestAccess,
  submit,
  submissionEnabled,
  run,
  investigationConfig,
  investigating,
  cancelling,
  investigate,
  cancelInvestigation,
  archive,
  openConnections,
  connected,
  initialTab = "investigation",
  initialEvidence,
  onTab,
  onEvidence,
  unsavedPreview,
  onDirtyChange,
  navigate,
  attachPolicy,
}: {
  current: DisputeCase;
  submissionEnabled: boolean;
  connected: boolean;
  busy: boolean;
  mutate: (a: WorkspaceAction, message?: string) => Promise<boolean>;
  back: () => void;
  addEvidence: () => void;
  requestAccess: () => void;
  submit: () => void;
  run: InvestigationRun | null;
  investigationConfig: InvestigationConfig | null;
  investigating: boolean;
  cancelling: boolean;
  investigate: (mode: "sample" | "bedrock") => void;
  cancelInvestigation: () => void;
  archive: () => void;
  openConnections: () => void;
  initialTab?: string;
  initialEvidence?: string;
  onTab: (tab: string) => void;
  onEvidence: (id: string) => void;
  unsavedPreview?: boolean;
  onDirtyChange: (dirty: boolean) => void;
  navigate: (
    view: string,
    id?: string,
    detail?: Record<string, string>,
  ) => void;
  attachPolicy: () => void;
}) {
  const tab = ["investigation", "report", "preview", "submission"].includes(
      initialTab,
    )
      ? initialTab
      : "investigation",
    selectedId = initialEvidence ?? current.evidence[0]?.id ?? "";
  const [draft, setDraft] = useState(
    (current.draft?.content ?? "") +
      (unsavedPreview
        ? "\n\nMerchant review note: recipient confirmation is still needed."
        : ""),
  );
  const switchTab = onTab;
  const openEvidence = (id: string) => {
    onEvidence(id);
    switchTab("investigation");
  };
  const previousRunStatus = useRef(run?.status);
  useEffect(() => {
    if (run?.status === "completed" && previousRunStatus.current === "running")
      onTab("report");
    previousRunStatus.current = run?.status;
  }, [run?.status, onTab]);
  const selected =
    current.evidence.find((e) => e.id === selectedId) ?? current.evidence[0];
  const selectedFindings = current.findings.filter(
    (f) => selected && f.evidenceIds.includes(selected.id),
  );
  const frozen = ["submitting", "submitted", "won", "lost"].includes(
    current.status,
  );
  const hasAttachments = current.evidence.some(
    (e) => e.fileName || e.downloadUrl,
  );
  const dirty = draft !== (current.draft?.content ?? "");
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const stale = Boolean(current.draft?.sourceStale);
  const analysis = current.draft?.analysis;
  const canExport = Boolean(
    current.draft?.status === "approved" && !dirty && !stale && !investigating,
  );
  const canInvestigate =
    !busy && !frozen && !investigating && current.evidence.length > 0;
  const mode = investigationConfig?.bedrockConfigured ? "bedrock" : "sample";
  const canUseMode = mode === "bedrock" || current.source === "demo";
  const confirmReplace = () =>
    !dirty ||
    window.confirm("Replace your unsaved response edits with a new draft?");
  const start = () => {
    if (!confirmReplace()) return;
    switchTab("investigation");
    investigate(mode);
  };
  const template = async () => {
    if (!confirmReplace()) return;
    if (
      await mutate(
        { action: "generateDraft", caseId: current.id },
        "Evidence template prepared. No AWS model was called. Review every claim.",
      )
    )
      switchTab("report");
  };
  const inspectEvidence = (id: string) => {
    onEvidence(id);
    switchTab("investigation");
    requestAnimationFrame(() =>
      document.getElementById("case-source-heading")?.focus(),
    );
  };
  const exportDraft = (format: "text" | "json" = "text") => {
    if (!canExport || !current.draft) return;
    const text = [
      "CAUSALITY · REVIEWED INVESTIGATION REPORT",
      current.title,
      `${current.customerName} · ${current.orderRef}`,
      `Amount disputed: ${money(current.amount, current.currency)}`,
      current.source === "demo"
        ? "SYNTHETIC SAMPLE: NOT FOR SUBMISSION"
        : `Case: ${current.id}`,
      `Prepared using: ${draftMethodLabel(current.draft.method)}`,
      `Approved revision: ${current.draft.revision} · ${current.draft.approvedAt ?? ""}`,
      "",
      current.draft.content,
      "",
      "FINDINGS",
      ...current.findings.map(
        (f) =>
          `${f.kind.toUpperCase()}: ${f.title}\n${f.detail}\nSources: ${f.evidenceIds.join(", ") || "No supporting record"}`,
      ),
      "",
      "SOURCE RECORDS",
      ...current.evidence.map(
        (e) =>
          `[${e.id}] ${e.title} · ${sourceName(e.source)} · ${e.occurredAt}\nReference: ${e.reference}\n${e.content || "Attachment requires inspection of the original file."}`,
      ),
    ].join("\n");
    const packet = {
      version: 1,
      exportedAt: new Date().toISOString(),
      case: {
        id: current.id,
        title: current.title,
        source: current.source,
        customerName: current.customerName,
        amount: current.amount,
        currency: current.currency,
        orderRef: current.orderRef,
      },
      draft: current.draft,
      findings: current.findings,
      evidence: current.evidence,
    };
    const blob = new Blob(
      [format === "json" ? JSON.stringify(packet, null, 2) : text],
      {
        type:
          format === "json" ? "application/json" : "text/plain;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `causality-${current.orderRef.replace(/[^a-zA-Z0-9-]/g, "") || current.id}-report.${format === "json" ? "json" : "txt"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tabs = [
    ["investigation", "Investigation"],
    ["report", "Report"],
    ["preview", "Report preview"],
    ["submission", "Submission package"],
  ];
  return (
    <>
      <div className="cw-page-head">
        <Button className="ghost" onClick={back}>
          <ArrowLeft size={18} />
          All cases
        </Button>
        <div className="cw-actions">
          <Button onClick={requestAccess}>
            <ShieldCheck size={18} />
            Request access
          </Button>
          <Button disabled={frozen || investigating} onClick={attachPolicy}>
            <FileText size={18} />
            Attach policy
          </Button>
          <Button
            primary
            disabled={frozen || investigating}
            onClick={addEvidence}
          >
            <Plus size={18} />
            Add evidence
          </Button>
        </div>
      </div>
      {current.source === "demo" && (
        <div className="cw-banner neutral">
          <Sparkles size={20} />
          <p>
            Synthetic sample case. You can explore and edit it; it cannot be
            submitted to Stripe.
          </p>
        </div>
      )}
      {frozen && <SubmissionOutcome current={current} navigate={navigate} />}
      {stale && (
        <div className="cw-banner error" role="alert">
          <TriangleAlert size={20} />
          <p>
            The evidence changed after this response was prepared. Run a new
            investigation before approving or exporting it.
          </p>
        </div>
      )}
      <div className="cw-panel">
        <div className="cw-case-header">
          <div>
            <p>
              {current.orderRef ? `${current.orderRef} · ` : ""}
              {current.customerName}
            </p>
            <h2>{current.title}</h2>
            <p style={{ marginTop: 12 }}>{current.reason}</p>
          </div>
          <div className="cw-case-amount">
            <strong>{money(current.amount, current.currency)}</strong>
            <p>Amount disputed</p>
            <div style={{ marginTop: 12 }}>
              <Badge
                status={investigating ? "investigating" : current.status}
              />
            </div>
          </div>
        </div>
        {(investigating || run) && (
          <InvestigationActivity
            run={run}
            pending={investigating}
            cancelling={cancelling}
            cancel={cancelInvestigation}
          />
        )}
        <div
          className="cw-tabs"
          role="tablist"
          aria-label="Case sections"
          onKeyDown={(event) => {
            const index = tabs.findIndex(([id]) => id === tab);
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              switchTab(tabs[next][0]);
              document.getElementById(`case-tab-${tabs[next][0]}`)?.focus();
            }
          }}
        >
          {tabs.map(([id, title]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`case-panel-${id}`}
              id={`case-tab-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? "active" : ""}
              onClick={() => switchTab(id)}
            >
              {title}
            </button>
          ))}
        </div>
        {tab === "investigation" && (
          <div
            role="tabpanel"
            id="case-panel-investigation"
            aria-labelledby="case-tab-investigation"
          >
            <div className="cw-review-bar cw-investigate-bar">
              <div>
                <h3>Follow the source. Understand the case.</h3>
                <p>
                  {current.evidence.length} linked records · Response due{" "}
                  {calendarDate(current.dueAt)}
                </p>
                <p className="cw-investigation-caption">
                  {investigationConfig?.bedrockConfigured
                    ? "AWS investigates the linked evidence and prepares a cited response for review."
                    : current.source === "demo"
                      ? "Sample mode follows the evidence without calling an AWS model."
                      : "Configure Amazon Bedrock to investigate this case with AI."}
                </p>
              </div>
              <div className="cw-actions">
                {canUseMode ? (
                  <Button primary disabled={!canInvestigate} onClick={start}>
                    {investigating ? (
                      <LoaderCircle className="cw-spin" size={18} />
                    ) : (
                      <Sparkles size={18} />
                    )}
                    {investigating
                      ? "Investigating…"
                      : mode === "bedrock"
                        ? "Investigate with AWS"
                        : "Run sample investigation"}
                  </Button>
                ) : (
                  <Button onClick={openConnections}>
                    <Cloud size={18} />
                    Set up AWS
                  </Button>
                )}
                <details className="cw-template-option">
                  <summary>Offline draft option</summary>
                  <Button
                    disabled={!canInvestigate}
                    onClick={() => void template()}
                  >
                    <FileText size={17} />
                    Prepare evidence template
                  </Button>
                  <p>No AI analysis. Uses only the attached records.</p>
                </details>
              </div>
            </div>
            <div className="cw-evidence-split">
              <aside className="cw-timeline">
                <div className="cw-timeline-head">
                  <h3>Evidence timeline</h3>
                  <span className="cw-caption">
                    {current.evidence.length} records
                  </span>
                </div>
                {current.evidence.length ? (
                  [...current.evidence]
                    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
                    .map((e) => (
                      <button
                        key={e.id}
                        className={`cw-evidence-row ${selected?.id === e.id ? "selected" : ""}`}
                        onClick={() => onEvidence(e.id)}
                      >
                        <span className="cw-date">{date(e.occurredAt)}</span>
                        <span>
                          <strong>{e.title}</strong>
                          <p>
                            {sourceName(e.source)}
                            {e.reference ? ` · ${e.reference}` : ""}
                          </p>
                        </span>
                      </button>
                    ))
                ) : (
                  <p>Added evidence appears here in chronological order.</p>
                )}
              </aside>
              <section className="cw-source-view">
                {selected ? (
                  <>
                    <div className="cw-source-meta">
                      <span className="cw-pill outline">
                        {(() => {
                          const Icon = sourceIcon(selected.source);
                          return <Icon size={17} />;
                        })()}
                        {sourceName(selected.source)}
                      </span>
                      {selected.downloadUrl ? (
                        <a
                          className="cw-text-link"
                          href={selected.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Original file
                          <ArrowDownToLine size={16} />
                        </a>
                      ) : (
                        <span className="cw-caption">Source record</span>
                      )}
                    </div>
                    <div className="cw-source-meta" style={{ marginBottom: 0 }}>
                      <h3 id="case-source-heading" tabIndex={-1}>
                        {selected.title}
                      </h3>
                      <span className="cw-caption">
                        {dateTime(selected.occurredAt)}
                      </span>
                    </div>
                    {selected.reference && <p>{selected.reference}</p>}
                    {selected.fileName && (
                      <div className="cw-original-file">
                        <FileText size={20} />
                        <div>
                          <h3>{selected.fileName}</h3>
                          <p>
                            {selected.mimeType ?? "Original attachment"} · Case{" "}
                            {current.orderRef || current.id}
                          </p>
                          <p>
                            PDF and image text has not been extracted. Inspect
                            the original file.
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="cw-source-content">
                      {selected.content ||
                        "This record contains an attachment. Open the original file to inspect its contents."}
                    </div>
                    {selected.provenance && (
                      <details className="cw-source-provenance">
                        <summary>Source details and limitations</summary>
                        <p className="cw-caption">
                          {selected.provenance.sourceMode === "synthetic"
                            ? "Synthetic sample record"
                            : selected.provenance.sourceMode ===
                                "anonymized_snapshot"
                              ? "Anonymized source snapshot"
                              : "Case-scoped source record"}{" "}
                          · {selected.provenance.section}
                        </p>
                        {Object.keys(selected.provenance.fields).length > 0 && (
                          <dl>
                            {Object.entries(selected.provenance.fields).map(
                              ([key, value]) => (
                                <div key={key}>
                                  <dt>{key.replaceAll("_", " ")}</dt>
                                  <dd>
                                    {value === null ? "Unknown" : String(value)}
                                  </dd>
                                </div>
                              ),
                            )}
                          </dl>
                        )}
                        {selected.provenance.limitations.length > 0 && (
                          <ul>
                            {selected.provenance.limitations.map(
                              (limitation, i) => (
                                <li key={i}>{limitation}</li>
                              ),
                            )}
                          </ul>
                        )}
                      </details>
                    )}
                    {selectedFindings.map((f, i) => (
                      <div
                        key={i}
                        className={`cw-banner ${f.kind === "supported" ? "neutral" : ""}`}
                      >
                        <TriangleAlert size={19} />
                        <p>{f.title}</p>
                      </div>
                    ))}
                  </>
                ) : (
                  <Empty
                    icon={FileText}
                    title="Build the evidence trail."
                    description="Add the payment record, relevant customer message, or company record to start this investigation."
                  >
                    <Button onClick={addEvidence}>
                      <Plus size={18} />
                      Add evidence
                    </Button>
                  </Empty>
                )}
              </section>
            </div>
          </div>
        )}
        {tab === "report" && (
          <div
            className="cw-report"
            role="tabpanel"
            id="case-panel-report"
            aria-labelledby="case-tab-report"
          >
            <div className="cw-page-head" style={{ marginBottom: 0 }}>
              <div>
                <h2>The case, assembled.</h2>
                <p>
                  Review the findings, inspect their sources, and make the
                  response your own.
                </p>
              </div>
              <div className="cw-actions">
                <Button onClick={() => exportDraft()} disabled={!canExport}>
                  <ArrowDownToLine size={18} />
                  Export report
                </Button>
                <Button
                  onClick={() => exportDraft("json")}
                  disabled={!canExport}
                >
                  Evidence JSON
                </Button>
                {investigationConfig?.archiveConfigured && (
                  <Button onClick={archive} disabled={busy || !canExport}>
                    <Cloud size={18} />
                    Archive to S3
                  </Button>
                )}
              </div>
            </div>
            {current.draft && (
              <div className="cw-draft-provenance">
                <span className="cw-pill outline">
                  {current.draft.method === "bedrock" ? (
                    <Cloud size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                  {draftMethodLabel(current.draft.method)}
                </span>
                <span className="cw-caption">
                  {current.draft.method === "sample_investigator"
                    ? "Deterministic sample. No AWS model was called."
                    : current.draft.method === "bedrock"
                      ? `Model-generated response requiring merchant review${analysis?.modelId ? ` · ${analysis.modelId}` : ""}`
                      : "No AI analysis was run."}
                </span>
              </div>
            )}
            {analysis && (
              <div className={`cw-analysis-summary ${analysis.assessment}`}>
                <div className="cw-analysis-heading">
                  <Sparkles size={19} />
                  <h3>
                    {analysis.assessment === "supported"
                      ? "Evidence supports a response."
                      : analysis.assessment === "mixed"
                        ? "The evidence needs a closer look."
                        : "More evidence is needed."}
                  </h3>
                </div>
                <p>{analysis.summary}</p>
                <div className="cw-analysis-metrics">
                  <span>{analysis.metrics.recordCount} records checked</span>
                  <span>{analysis.metrics.toolCalls} evidence requests</span>
                  <span>
                    {(analysis.metrics.durationMs / 1000).toFixed(1)}s elapsed
                  </span>
                </div>
                <div className="cw-analysis-next">
                  <strong>Recommended next step</strong>
                  <p>{analysis.recommendation}</p>
                </div>
              </div>
            )}
            {current.findings.length > 0 && (
              <div className="cw-findings">
                {current.findings.map((finding, i) => (
                  <div className="cw-finding" key={i}>
                    <h3>
                      {finding.kind === "conflict"
                        ? "Conflicting evidence · "
                        : finding.kind === "missing"
                          ? "Missing evidence · "
                          : "Supported · "}
                      {finding.title}
                    </h3>
                    <p>{finding.detail}</p>
                    {finding.evidenceIds.length > 0 && (
                      <div className="cw-citations">
                        {finding.evidenceIds.map((id) => {
                          const record = current.evidence.find(
                            (e) => e.id === id,
                          );
                          return (
                            <button
                              key={id}
                              className="cw-citation"
                              onClick={() => inspectEvidence(id)}
                              disabled={!record}
                            >
                              <FileText size={14} />
                              {record?.title || "Source unavailable"}
                              <ArrowRight size={13} />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {analysis?.gaps.length ? (
              <div className="cw-analysis-gaps">
                <h3>
                  <CircleHelp size={18} />
                  What remains unknown
                </h3>
                <ul>
                  {analysis.gaps.map((gap, i) => (
                    <li key={i}>{gap}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {current.draft ? (
              <>
                <Field
                  label="Merchant response draft"
                  hint="Edits are saved only when you choose Save changes. Approval and export apply to this exact saved version."
                >
                  <textarea
                    readOnly={frozen || investigating}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    minLength={30}
                    maxLength={50000}
                  />
                </Field>
                <div className="cw-review-bar" style={{ borderRadius: 16 }}>
                  <div>
                    <h3>
                      {dirty
                        ? "Unsaved changes"
                        : current.draft.status === "approved"
                          ? "Approved for submission"
                          : "Ready for your review"}
                    </h3>
                    <p>
                      {dirty
                        ? "Save and approve your changes before exporting."
                        : current.draft.status === "approved"
                          ? `Reviewed ${dateTime(current.draft.approvedAt)} by ${current.draft.approvedBy || "workspace owner"} · Revision ${current.draft.revision}`
                          : "Inspect the cited records before approving. Approval does not send anything."}
                    </p>
                  </div>
                  <div className="cw-actions">
                    <Button
                      disabled={busy || frozen || investigating || !dirty}
                      onClick={() =>
                        void mutate(
                          {
                            action: "saveDraft",
                            caseId: current.id,
                            content: draft,
                            revision: current.draft?.revision ?? 0,
                          },
                          "Draft saved. Approval is required for this version.",
                        )
                      }
                    >
                      Save changes
                    </Button>
                    <Button
                      primary
                      disabled={
                        busy ||
                        frozen ||
                        investigating ||
                        stale ||
                        dirty ||
                        current.draft.status === "approved"
                      }
                      onClick={() =>
                        void mutate(
                          {
                            action: "approveDraft",
                            caseId: current.id,
                            revision: current.draft?.revision ?? 0,
                          },
                          "This draft is approved. Nothing has been submitted.",
                        )
                      }
                    >
                      <CheckCheck size={18} />
                      Approve draft
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <Empty
                icon={FileText}
                title="Your response starts with evidence."
                description="Investigate the linked records to prepare a cited response for your team."
              >
                {canUseMode && (
                  <Button primary disabled={!canInvestigate} onClick={start}>
                    <Sparkles size={18} />
                    {mode === "bedrock"
                      ? "Investigate with AWS"
                      : "Run sample investigation"}
                  </Button>
                )}
                <Button
                  disabled={!canInvestigate}
                  onClick={() => void template()}
                >
                  Prepare evidence template
                </Button>
              </Empty>
            )}
          </div>
        )}
        {tab === "preview" && (
          <div
            role="tabpanel"
            id="case-panel-preview"
            aria-labelledby="case-tab-preview"
          >
            <ReportPreview
              current={current}
              draft={draft}
              dirty={dirty}
              exportEnabled={canExport}
              exportReport={() => exportDraft()}
              openEvidence={openEvidence}
            />
          </div>
        )}
        {tab === "submission" && (
          <div
            className="cw-report"
            role="tabpanel"
            id="case-panel-submission"
            aria-labelledby="case-tab-submission"
          >
            <div className="cw-page-head" style={{ marginBottom: 0 }}>
              <div>
                <h2>
                  {frozen
                    ? "A preserved case record."
                    : "Prepared. Then approved."}
                </h2>
                <p>
                  Inspect the exact response and supporting records before
                  submission.
                </p>
              </div>
              {current.draft && <Badge status={current.draft.status} />}
            </div>
            <div className="cw-banner neutral">
              <ShieldCheck size={20} />
              <p>
                Submission is a separate action. Approving a draft does not send
                it to Stripe.
              </p>
            </div>
            {current.source === "stripe" && hasAttachments && (
              <div className="cw-banner neutral">
                <FileText size={20} />
                <p>
                  This case contains file attachments. Export the report and
                  submit it with the original files in Stripe Dashboard. File
                  submission is not enabled in this build.
                </p>
              </div>
            )}
            {dirty && (
              <div className="cw-banner">
                <TriangleAlert size={20} />
                <p>
                  Your report has unsaved edits. This package shows the last
                  saved response. Save and approve the new revision before
                  reviewing submission.
                </p>
              </div>
            )}
            {!frozen && (
              <SubmissionReadiness
                current={current}
                submissionEnabled={submissionEnabled}
                connected={connected}
              />
            )}
            <div className="cw-two-col">
              <div>
                <h3>{frozen ? "Preserved response" : "Response"}</h3>
                <div className="cw-source-content">
                  {current.draft?.content ??
                    "Prepare and review a response in the Report tab."}
                </div>
              </div>
              <div>
                <h3>Supporting sources</h3>
                <ul className="cw-activity">
                  {current.evidence.map((e) => (
                    <li key={e.id}>
                      <FileText size={18} />
                      <div>
                        <strong>{e.title}</strong>
                        <p>
                          {sourceName(e.source)} ·{" "}
                          {e.reference || date(e.occurredAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="cw-review-bar" style={{ borderRadius: 16 }}>
              <div>
                <h3>
                  {current.source === "stripe"
                    ? "Submit through your Stripe connection"
                    : "Export for review"}
                </h3>
                <p>
                  {current.source === "demo"
                    ? "Synthetic sample cases cannot be submitted."
                    : current.source === "manual"
                      ? "This manual case is not linked to a Stripe dispute."
                      : "Requires an approved draft. Text-only submission is available when enabled by your Stripe operator."}
                </p>
              </div>
              <div className="cw-actions">
                <Button onClick={() => exportDraft()} disabled={!canExport}>
                  <ArrowDownToLine size={18} />
                  Export
                </Button>
                {current.source === "stripe" &&
                  submissionEnabled &&
                  connected && (
                    <Button
                      primary
                      disabled={
                        busy ||
                        frozen ||
                        investigating ||
                        stale ||
                        dirty ||
                        hasAttachments ||
                        current.draft?.status !== "approved"
                      }
                      onClick={submit}
                    >
                      Review submission
                      <ArrowRight size={18} />
                    </Button>
                  )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function InvestigationActivity({
  run,
  pending,
  cancelling,
  cancel,
}: {
  run: InvestigationRun | null;
  pending: boolean;
  cancelling: boolean;
  cancel: () => void;
}) {
  const active = run?.status === "running" || pending;
  const latest = run?.events.at(-1);
  const title = active
    ? "Following the evidence"
    : run?.status === "completed"
      ? "Investigation complete"
      : run?.status === "cancelled"
        ? "Investigation cancelled"
        : run?.status === "stale"
          ? "Evidence changed during the investigation"
          : "Investigation needs attention";
  return (
    <section
      className={`cw-investigation-run ${run?.status || "running"}`}
      aria-label="Investigation progress"
    >
      <div className="cw-run-heading">
        <span className="cw-run-symbol">
          {active ? (
            <LoaderCircle size={20} className="cw-spin" />
          ) : run?.status === "completed" ? (
            <CheckCheck size={20} />
          ) : (
            <TriangleAlert size={20} />
          )}
        </span>
        <div role="status">
          <h3>{title}</h3>
          <p>
            {active
              ? latest?.title || "Starting the investigation…"
              : run?.error ||
                (run?.mode === "sample"
                  ? "Sample investigation. No AWS model was called."
                  : "Prepared with Amazon Bedrock. Merchant review is required.")}
          </p>
        </div>
        {active && (
          <Button
            className="small"
            disabled={!run?.id || cancelling}
            onClick={cancel}
          >
            <Square size={13} />
            {cancelling ? "Cancelling…" : "Cancel investigation"}
          </Button>
        )}
      </div>
      {Boolean(run?.events.length) && (
        <details className="cw-run-events">
          <summary>
            {run!.events.length} recorded steps
            <span>
              {run?.mode === "bedrock" ? "AWS Bedrock" : "Sample mode"}
            </span>
          </summary>
          <ol>
            {run!.events.map((event) => (
              <li key={event.id}>
                <span className="cw-run-event-dot" />
                <div>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </div>
                <time dateTime={event.at}>
                  {new Date(event.at).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

function EvidenceForm({
  current,
  busy,
  submit,
  upload,
  initialMode = "record",
  defaultDate = "",
}: {
  initialMode?: string;
  defaultDate?: string;
  current: DisputeCase;
  busy: boolean;
  submit: (e: FormEvent<HTMLFormElement>) => void;
  upload: (e: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const [mode, setMode] = useState(initialMode);
  return (
    <>
      <div className="cw-tabs" style={{ padding: 0, marginBottom: 24 }}>
        <button
          className={mode === "record" ? "active" : ""}
          onClick={() => setMode("record")}
        >
          Add a record
        </button>
        <button
          className={mode === "file" ? "active" : ""}
          onClick={() => setMode("file")}
        >
          Upload a file
        </button>
      </div>
      {mode === "record" ? (
        <form className="cw-form" onSubmit={submit}>
          <Field label="Record title">
            <input
              name="title"
              required
              maxLength={160}
              placeholder="Customer disputes receipt"
            />
          </Field>
          <div className="cw-form-grid">
            <Field label="Source">
              <select name="source">
                <option value="manual">Manual record</option>
                <option value="gmail">Customer email</option>
                <option value="database">Company record</option>
                <option value="policy">Company policy</option>
                <option value="stripe">Stripe record</option>
              </select>
            </Field>
            <Field label="Record date">
              <input
                type="datetime-local"
                name="occurredAt"
                required
                defaultValue={defaultDate}
              />
            </Field>
          </div>
          <Field label="Original reference">
            <input
              name="reference"
              maxLength={300}
              placeholder="Order log #1048, email subject, or document reference"
            />
          </Field>
          <Field label="Source content">
            <textarea
              name="content"
              required
              maxLength={24000}
              placeholder="Include the original content and context. Avoid copying unrelated customer information."
              style={{ minHeight: 200 }}
            />
          </Field>
          <Button primary type="submit" disabled={busy}>
            {busy ? "Adding…" : "Add to case"}
            <ArrowRight size={18} />
          </Button>
        </form>
      ) : (
        <form
          className="cw-form"
          onSubmit={(e) => void upload(e)}
          encType="multipart/form-data"
        >
          <input type="hidden" name="caseId" value={current.id} />
          <input type="hidden" name="source" value="manual" />
          <Field label="Evidence title">
            <input
              name="title"
              required
              maxLength={160}
              placeholder="Delivery confirmation"
            />
          </Field>
          <label className="cw-upload">
            <Upload size={26} />
            <strong>Select a supporting file</strong>
            <p>PDF, PNG, JPEG, email, text, CSV or JSON · up to 10 MB</p>
            <input
              aria-label="Evidence file"
              type="file"
              name="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.json,.eml"
              required
            />
          </label>
          <p className="cw-caption">
            The original file is stored privately with this case. PDF and image
            text is not extracted. The upload timestamp is recorded; add a
            separate source record for the factual event date.
          </p>
          <Button primary type="submit" disabled={busy}>
            <Upload size={18} />
            {busy ? "Uploading…" : "Upload evidence"}
          </Button>
        </form>
      )}
    </>
  );
}

function EvidenceLibrary({
  state,
  search,
  setSearch,
  open,
}: {
  state: WorkspaceState;
  search: string;
  setSearch: (s: string) => void;
  open: (id: string, evidence: string) => void;
}) {
  const records = state.cases
    .flatMap((c) =>
      c.evidence.map((e) => ({
        ...e,
        caseName: c.title,
        customerName: c.customerName,
        sample: c.source === "demo",
      })),
    )
    .filter((e) =>
      `${e.title} ${e.caseName} ${e.reference} ${e.customerName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <>
      <div className="cw-page-head">
        <div>
          <h1>Evidence, with context.</h1>
          <p>
            Every record belongs to a case. Open its investigation to inspect
            the source or add more evidence.
          </p>
        </div>
        <span className="cw-pill">{records.length} records</span>
      </div>
      <div className="cw-toolbar">
        <div className="cw-search">
          <Search size={18} />
          <input
            aria-label="Search evidence"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search evidence, reference, or customer…"
          />
        </div>
      </div>
      <div className="cw-panel">
        {records.length ? (
          <div className="cw-table-wrap">
            <table className="cw-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Source</th>
                  <th>Case</th>
                  <th>Record date</th>
                  <th aria-label="Open case" />
                </tr>
              </thead>
              <tbody>
                {records.map((e) => (
                  <tr key={e.id} onClick={() => open(e.caseId, e.id)}>
                    <td>
                      <button
                        className="cw-row-link"
                        onClick={(x) => {
                          x.stopPropagation();
                          open(e.caseId, e.id);
                        }}
                      >
                        <span className="cw-case-name">{e.title}</span>
                        <p>
                          {e.fileName ?? e.reference}
                          {e.sample && " · Sample"}
                        </p>
                      </button>
                    </td>
                    <td>
                      <span className="cw-pill outline">
                        {sourceName(e.source)}
                      </span>
                    </td>
                    <td>
                      {e.customerName}
                      <p>{e.caseName}</p>
                    </td>
                    <td>{date(e.occurredAt)}</td>
                    <td>
                      <ArrowRight size={18} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={FileText}
            title="A clear source for every claim."
            description="Add evidence inside a case to keep customer records matched to the right investigation."
          />
        )}
      </div>
    </>
  );
}

function Integrations({
  state,
  stripe,
  investigationConfig,
  importCase,
  busy,
  stripeAction,
  requestAccess,
  navigate,
}: {
  state: WorkspaceState;
  stripe: StripeStatus | null;
  investigationConfig: InvestigationConfig | null;
  importCase: () => void;
  busy: boolean;
  stripeAction: (
    action: "connect" | "sync" | "disconnect" | "submit",
    body?: object,
  ) => Promise<void>;
  requestAccess: () => void;
  navigate: (
    view: string,
    id?: string,
    detail?: Record<string, string>,
  ) => void;
}) {
  const connection = state.integrations.find((i) => i.provider === "stripe"),
    connected = connection?.status === "connected";
  return (
    <>
      <div className="cw-page-head">
        <div>
          <h1>Evidence beyond the payment.</h1>
          <p>
            Connect permitted sources. Keep the scope of each investigation
            clear.
          </p>
        </div>
        <span className="cw-pill outline">
          <ShieldCheck size={16} />
          Workspace-scoped
        </span>
      </div>
      <div className="cw-integration-grid">
        <section className="cw-panel cw-integration">
          <div className="cw-integration-head">
            <span className="cw-integration-brand aws">
              <Cloud size={26} />
            </span>
            <h2>Amazon Bedrock</h2>
            <span
              className={`cw-pill ${investigationConfig?.bedrockConfigured ? "green" : ""}`}
            >
              {investigationConfig?.bedrockConfigured
                ? "Configured"
                : "Not configured"}
            </span>
          </div>
          <p>
            Investigate linked evidence, follow the source records, and prepare
            a cited response for merchant review.
          </p>
          <div className="cw-rule" />
          <ul className="cw-scope-list">
            <li>
              <Check size={19} />
              <span>Model and evidence requests stay on the server</span>
            </li>
            <li>
              <Check size={19} />
              <span>Findings cite records from the selected case</span>
            </li>
            <li>
              <LockKeyhole size={19} />
              <span>No automatic approval, refund, or submission</span>
            </li>
          </ul>
          {investigationConfig?.bedrockConfigured ? (
            <dl className="cw-connection-metadata">
              <div>
                <dt>Region</dt>
                <dd>{investigationConfig.region}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>
                  {investigationConfig.modelId || "Selected by your operator"}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="cw-banner neutral" style={{ marginBottom: 0 }}>
              <Settings2 size={20} />
              <p>
                Configure AWS credentials, a region, and a tool-capable Bedrock
                model on the server. Synthetic cases can use sample mode while
                AWS is being connected.
              </p>
            </div>
          )}
          <Button onClick={() => navigate("cases")}>
            Open cases
            <ArrowRight size={18} />
          </Button>
        </section>

        <section className="cw-panel cw-integration">
          <div className="cw-integration-head">
            <span className="cw-integration-brand stripe">S</span>
            <h2>Stripe</h2>
            <span className={`cw-pill ${connected ? "green" : ""}`}>
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p>
            Import disputes and their payment records. Review a response before
            submitting evidence through Stripe.
          </p>
          <div className="cw-rule" />
          <ul className="cw-scope-list">
            <li>
              <Check size={19} />
              <span>Dispute details, deadlines, and payment evidence</span>
            </li>
            <li>
              <Check size={19} />
              <span>Explicit merchant review before submission</span>
            </li>
            <li>
              <LockKeyhole size={19} />
              <span>Server-side credentials; no keys in your browser</span>
            </li>
          </ul>
          {connected ? (
            <p>
              {connection?.accountName ?? "Configured Stripe account"} ·{" "}
              {connection?.mode === "live" ? "Live mode" : "Sandbox"}
              {connection?.lastSyncAt && (
                <>
                  <br />
                  Last synchronized {dateTime(connection.lastSyncAt)}
                </>
              )}
            </p>
          ) : (
            stripe?.configured === false && (
              <div className="cw-banner neutral" style={{ marginBottom: 0 }}>
                <Settings2 size={20} />
                <p>
                  Stripe credentials need to be configured by the workspace
                  operator before a connection can be established.
                </p>
              </div>
            )
          )}
          <div className="cw-actions">
            <Button
              onClick={() =>
                navigate("integrations", undefined, { source: "stripe" })
              }
            >
              Setup & status
              <ArrowRight size={16} />
            </Button>
            {connected ? (
              <>
                <Button
                  primary
                  onClick={() => void stripeAction("sync")}
                  disabled={busy}
                >
                  <RefreshCw size={18} />
                  {busy ? "Syncing…" : "Sync disputes"}
                </Button>
                <Button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disconnect Stripe? Imported case records remain in your workspace.",
                      )
                    )
                      void stripeAction("disconnect");
                  }}
                  disabled={busy}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                primary
                onClick={() => void stripeAction("connect")}
                disabled={busy || stripe?.configured === false}
              >
                <Link2 size={18} />
                {busy
                  ? "Connecting…"
                  : stripe?.configured === false
                    ? "Configuration required"
                    : "Connect Stripe"}
              </Button>
            )}
          </div>
        </section>
        <section className="cw-panel cw-integration">
          <div className="cw-integration-head">
            <span className="cw-integration-brand">
              <Mail size={26} />
            </span>
            <h2>Customer messages</h2>
            <span className="cw-pill">Manual import</span>
          </div>
          <p>
            Keep the customer’s original account alongside the payment and
            delivery records.
          </p>
          <div className="cw-rule" />
          <ul className="cw-scope-list">
            <li>
              <Check size={19} />
              <span>Add a selected message as evidence within a case</span>
            </li>
            <li>
              <Check size={19} />
              <span>Upload an email export or supporting screenshot</span>
            </li>
            <li>
              <LockKeyhole size={19} />
              <span>No automatic mailbox access in this build</span>
            </li>
          </ul>
          <p>
            Direct Gmail authorization is a planned connection. Selected
            messages can be added now using Add evidence inside a case.
          </p>
          <Button
            onClick={() =>
              navigate("integrations", undefined, { source: "gmail" })
            }
          >
            Import instructions
            <ArrowRight size={18} />
          </Button>
        </section>
        <section className="cw-panel cw-integration">
          <div className="cw-integration-head">
            <span className="cw-integration-brand">
              <Database size={26} />
            </span>
            <h2>Company records</h2>
            <span
              className={`cw-pill ${investigationConfig?.merchantConfigured ? "green" : ""}`}
            >
              {investigationConfig?.merchantConfigured
                ? "Configured"
                : "Not connected"}
            </span>
          </div>
          <p>
            Use operational records relevant to the customer and transaction.
            Additional access requires an independent decision.
          </p>
          <div className="cw-rule" />
          <p>
            Import an approved case through your business’s evidence API. It
            verifies the case, follows linked records, and returns only
            permitted fields. Database credentials stay with the business.
          </p>
          {!investigationConfig?.merchantConfigured && (
            <p className="cw-caption">
              Configure the merchant endpoint and scoped access token on the
              server to enable import. You can still add selected evidence
              manually.
            </p>
          )}
          <div className="cw-actions">
            <Button
              primary
              onClick={importCase}
              disabled={busy || !investigationConfig?.merchantConfigured}
            >
              <Database size={18} />
              Import approved case
            </Button>
            <Button
              onClick={() =>
                navigate("integrations", undefined, { source: "database" })
              }
            >
              Access setup
              <ArrowRight size={18} />
            </Button>
            <Button onClick={requestAccess}>
              <ShieldCheck size={18} />
              Request a specific scope
            </Button>
          </div>
        </section>
        <section className="cw-panel cw-integration">
          <div className="cw-integration-head">
            <span className="cw-integration-brand">
              <FileText size={26} />
            </span>
            <h2>Company policies</h2>
            <span className="cw-pill">{state.policies.length} saved</span>
          </div>
          <p>
            Give each investigation the terms that applied at the time of the
            purchase.
          </p>
          <div className="cw-rule" />
          <p>
            Save policy text with its effective date, then add the relevant
            policy to the case as evidence. Policy text never grants data-access
            permissions.
          </p>
          <Button onClick={() => navigate("policies")}>
            Manage policies
            <ArrowRight size={18} />
          </Button>
        </section>
        <section className="cw-panel cw-integration">
          <div className="cw-integration-head">
            <span className="cw-integration-brand">
              <Database size={26} />
            </span>
            <h2>Amazon S3 archive</h2>
            <span
              className={`cw-pill ${investigationConfig?.archiveConfigured ? "green" : ""}`}
            >
              {investigationConfig?.archiveConfigured
                ? "Configured"
                : "Optional"}
            </span>
          </div>
          <p>
            Keep a private copy of the reviewed response, findings, and
            supporting evidence.
          </p>
          <div className="cw-rule" />
          <p>
            Archiving is a separate action on the Report tab. Only the exact
            approved draft revision can be archived. Downloads remain available
            without S3.
          </p>
        </section>
      </div>
    </>
  );
}

function ActivityList({
  state,
  limit = 100,
  openCase,
}: {
  state: WorkspaceState;
  limit?: number;
  openCase?: (id: string) => void;
}) {
  return state.activity.length ? (
    <ul className="cw-activity">
      {state.activity.slice(0, limit).map((a) => (
        <li key={a.id}>
          <span className="cw-activity-dot" />
          <div style={{ flex: 1 }}>
            <h3>{a.action.replaceAll("_", " ").replaceAll(".", " ")}</h3>
            <p>{a.detail}</p>
            <p>
              {a.actor} · {dateTime(a.createdAt)}
            </p>
          </div>
          {a.caseId && openCase && (
            <button
              className="cw-button ghost icon"
              aria-label="Open related case"
              onClick={() => openCase(a.caseId!)}
            >
              <ArrowRight size={17} />
            </button>
          )}
        </li>
      ))}
    </ul>
  ) : (
    <p>
      Workspace activity will appear here as you add evidence and review cases.
    </p>
  );
}

function Access({
  state,
  busy,
  mutate,
  request,
  openCase,
  initialTab = "requests",
  onTab,
  openRequest,
}: {
  state: WorkspaceState;
  busy: boolean;
  mutate: (a: WorkspaceAction, m?: string) => Promise<boolean>;
  request: () => void;
  openCase: (id: string) => void;
  initialTab?: string;
  onTab: (tab: string) => void;
  openRequest: (id: string) => void;
}) {
  const tab = initialTab,
    switchTab = onTab;
  return (
    <>
      <div className="cw-page-head">
        <div>
          <h1>Your data. Your boundaries.</h1>
          <p>
            Inspect requests, decisions, and the activity behind each
            investigation.
          </p>
        </div>
        <Button primary onClick={request}>
          <Plus size={18} />
          Request access
        </Button>
      </div>
      <div className="cw-grid">
        <div className="cw-stat">
          <div className="cw-stat-label">
            <span>Pending requests</span>
            <Clock3 size={20} />
          </div>
          <div className="cw-stat-value">
            {state.accessRequests.filter((r) => r.status === "pending").length}
          </div>
          <p>Awaiting independent review</p>
        </div>
        <div className="cw-stat">
          <div className="cw-stat-label">
            <span>Permission model</span>
            <ShieldCheck size={20} />
          </div>
          <div className="cw-stat-value">Case scoped</div>
          <p>Selected records and specific tools</p>
        </div>
        <div className="cw-stat">
          <div className="cw-stat-label">
            <span>Activity records</span>
            <FileText size={20} />
          </div>
          <div className="cw-stat-value">{state.activity.length}</div>
          <p>Recorded outside the draft context</p>
        </div>
      </div>
      <div className="cw-panel">
        <div className="cw-tabs">
          <button
            className={tab === "requests" ? "active" : ""}
            onClick={() => switchTab("requests")}
          >
            Access requests
          </button>
          <button
            className={tab === "activity" ? "active" : ""}
            onClick={() => switchTab("activity")}
          >
            Activity log
          </button>
          <button
            className={tab === "model" ? "active" : ""}
            onClick={() => switchTab("model")}
          >
            Access model
          </button>
        </div>
        {tab === "requests" &&
          (state.accessRequests.length ? (
            <div className="cw-panel-body">
              <div className="cw-banner neutral">
                <LockKeyhole size={20} />
                <p>
                  Requests must be reviewed independently. This single-owner
                  build requires reviewer configuration before decisions can be
                  made. Approval records do not provision a database connector.
                </p>
              </div>
              {state.accessRequests.map((r) => (
                <AccessRow
                  key={r.id}
                  request={r}
                  busy={busy}
                  mutate={mutate}
                  open={() => openRequest(r.id)}
                />
              ))}
            </div>
          ) : (
            <Empty
              icon={ShieldCheck}
              title="Access is intentional."
              description="When a case needs more evidence, request the exact records and explain why they’re needed."
            >
              <Button onClick={request}>
                <Plus size={18} />
                Request access
              </Button>
            </Empty>
          ))}
        {tab === "activity" && (
          <div className="cw-panel-body">
            <ActivityList state={state} openCase={openCase} />
          </div>
        )}
        {tab === "model" && (
          <div className="cw-panel-body cw-two-col">
            <div>
              <h2>Designed around a clear boundary.</h2>
              <p style={{ marginTop: 16 }}>
                Your workspace contains the records you add and explicitly
                import. Investigations do not have unrestricted access to your
                company systems.
              </p>
              <img
                src="/causality/access-architecture-compact.svg"
                alt="Company records pass through a policy gate into a fresh context, with company policy and audit logging outside that context"
                style={{ width: "100%", maxWidth: 480, marginTop: 24 }}
              />
            </div>
            <div className="cw-findings">
              <div className="cw-finding">
                <h3>Query only approved records.</h3>
                <p>
                  The merchant evidence API constrains access to the approved
                  case and permitted fields.
                </p>
              </div>
              <div className="cw-finding">
                <h3>Keep permission decisions independent.</h3>
                <p>
                  The requester cannot approve their own request. Access
                  decisions and audit history remain separate from draft
                  preparation.
                </p>
              </div>
              <div className="cw-finding">
                <h3>Understand what is running today.</h3>
                <p>
                  Investigations use Amazon Bedrock when configured, with a
                  labeled sample mode for synthetic cases. The merchant API
                  imports approved records. Gmail authorization remains a
                  separate integration.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
function AccessRow({
  request: r,
  busy,
  mutate,
  open,
}: {
  request: AccessRequest;
  busy: boolean;
  mutate: (a: WorkspaceAction, m?: string) => Promise<boolean>;
  open: () => void;
}) {
  return (
    <div className="cw-policy">
      <ShieldCheck size={21} />
      <div className="cw-policy-body">
        <h3>{r.scope}</h3>
        <p>{r.reason}</p>
        <p>
          {dateTime(r.createdAt)} · Requested by {r.requestedBy}
        </p>
        {r.status === "pending" && !r.canReview && (
          <p>An independent reviewer is required for this request.</p>
        )}
      </div>
      <div
        className="cw-panel-stack"
        style={{ alignItems: "flex-end", gap: 12 }}
      >
        <Badge status={r.status} />
        <Button className="small" onClick={open}>
          View request
          <ArrowRight size={16} />
        </Button>
        {r.status === "pending" && r.canReview && (
          <div className="cw-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void mutate(
                  {
                    action: "resolveAccess",
                    requestId: r.id,
                    decision: "denied",
                  },
                  "Request denied.",
                )
              }
            >
              Deny
            </Button>
            <Button
              primary
              disabled={busy}
              onClick={() =>
                void mutate(
                  {
                    action: "resolveAccess",
                    requestId: r.id,
                    decision: "approved",
                  },
                  "Request decision recorded.",
                )
              }
            >
              Approve
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Settings({
  state,
  busy,
  mutate,
}: {
  state: WorkspaceState;
  busy: boolean;
  mutate: (a: WorkspaceAction, m?: string) => Promise<boolean>;
}) {
  const workspace = state.workspace!;
  return (
    <>
      <div className="cw-page-head">
        <div>
          <h1>Your workspace.</h1>
          <p>
            Business context, policies, and the way your team handles evidence.
          </p>
        </div>
      </div>
      <div className="cw-panel-stack">
        <section className="cw-panel">
          <div className="cw-panel-header">
            <h3>Business details</h3>
            <Building2 size={20} />
          </div>
          <form
            className="cw-panel-body cw-form"
            key={workspace.name}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(
                {
                  action: "saveSettings",
                  name: formText(f, "name"),
                  industry: formText(f, "industry"),
                  website: formText(f, "website"),
                  retentionDays: Number(formText(f, "retentionDays")),
                },
                "Workspace settings saved.",
              );
            }}
          >
            <div className="cw-form-grid">
              <Field label="Business name">
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  defaultValue={workspace.name}
                />
              </Field>
              <Field label="Industry">
                <input
                  name="industry"
                  defaultValue={workspace.industry}
                  maxLength={100}
                />
              </Field>
            </div>
            <div className="cw-form-grid">
              <Field label="Website">
                <input
                  name="website"
                  maxLength={500}
                  type="url"
                  defaultValue={workspace.website}
                  placeholder="https://example.com"
                />
              </Field>
              <Field
                label="Retention preference"
                hint="Saved as a workspace preference. Automatic deletion is not enabled in this build."
              >
                <select
                  name="retentionDays"
                  defaultValue={workspace.retentionDays}
                >
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
              </Field>
            </div>
            <div className="cw-actions">
              <Button type="submit" primary disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
