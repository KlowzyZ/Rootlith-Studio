import { useWorkspaceState } from "./useWorkspaceState";
import {
  EditorCanvas,
  prepareEditor,
} from "../../../packages/shared-ui/EditorCanvas";
import {
  LOCAL_KIT_TAG,
  instantiateLocalTemplate,
} from "../../../packages/core/local-kits";
import { prepareWorkspaceClose } from "../../../packages/core/workspace-close";
import {
  beginCaseSession,
  validateCaseSession,
  recordCaseRun,
  type CaseSession,
} from "../../../packages/core/case-session";

import { createPortal } from "react-dom";
import { exportDocument } from "../../../packages/core/export-document";
import { workspaceWriter } from "../../../packages/core/workspace-writer";
import { CaseWorkbench } from "../../../packages/shared-ui/CaseWorkbench";
import {
  filterHistory,
  retainedFavorites,
  type HistoryFilter,
} from "../../../packages/core/history";
import {
  lazy,
  Suspense,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Network,
  LayoutDashboard,
  Workflow as WorkflowIcon,
  Plus,
  Layers,
  History,
  ChartNoAxesCombined,
  Settings,
  Search,
  Upload,
  Download,
  Play,
  Undo2,
  Redo2,
  ArrowUpRight,
  X,
  ShieldCheck,
  Square,
  FolderOpen,
  Save,
  FileJson,
  FileText,
} from "lucide-react";
import { icons, labels } from "../../../packages/shared-ui/node-library";
import { arrangeWorkflow } from "../../../packages/core/arrange";
import { starters, starter } from "../../../packages/core/starters";
import { comparisonScope } from "../../../packages/core/comparison";

import { QuickTarget } from "../../../packages/shared-ui/QuickTarget";
import { EvidenceTimeline } from "../../../packages/shared-ui/EvidenceTimeline";
import { duplicateWorkflow } from "../../../packages/core/quick-target";
import { Inspector } from "../../../packages/shared-ui/Inspector";
import { template } from "../../../packages/core/templates";
import {
  load,
  stageDraft,
  draftRecord,
  primaryRecord,
  restoreBackup,
  recoveryExport,
  resetStorage,
  storageKeys,
  putWorkflow,
  type Store,
} from "../../../packages/core/storage";
import { flushDesktop } from "../../../packages/core/desktop-client";
import { reportHTML, redactedReport } from "../../../packages/core/reports";
import {
  kinds,
  parseWorkflow,
  validate,
  workflowSchema,
  withCapabilities,
  connectionError,
  target,
  diagnosticKinds,
  type Workflow,
  type FlowNode,
} from "../../../packages/schemas";
import {
  execute,
  demoProvider,
  type Report,
  type Step,
} from "../../../packages/workflow-engine";
import { productVersion } from "../../../packages/core/identity";
const SettingsPage = lazy(() =>
  import("../../../packages/shared-ui/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);
const BackupTransfer = lazy(() =>
  import("../../../packages/shared-ui/BackupTransfer").then((m) => ({
    default: m.BackupTransfer,
  })),
);
const RunComparison = lazy(() =>
  import("../../../packages/shared-ui/RunComparison").then((m) => ({
    default: m.RunComparison,
  })),
);
const nav = [
  ["Dashboard", LayoutDashboard],
  ["My Workflows", WorkflowIcon],
  ["Create Workflow", Plus],
  ["Templates", Layers],
  ["Run History", History],
  ["Reports", ChartNoAxesCombined],
  ["Settings", Settings],
] as const;
export function App({ startupNotice = "" }: { startupNotice?: string }) {
  const fitRef = useRef<
    (options?: {
      padding?: number;
      maxZoom?: number;
      duration?: number;
    }) => Promise<boolean>
  >(async () => false);
  const readyCanvas = useCallback((fit: typeof fitRef.current) => {
    fitRef.current = fit;
  }, []);
  const fitView = (options?: Parameters<typeof fitRef.current>[0]) =>
    fitRef.current({
      ...options,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : options?.duration,
    });
  const [compactNav, setCompactNav] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>({
    search: "",
    mode: "all",
    status: "all",
    order: "newest",
    favoritesOnly: false,
  });
  const [saving, setSaving] = useState(0);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const {
    store: [store, setStore],
    workflow: [w, setW],
    caseView: [caseView, setCaseView],
    message: [message, setMessage],
    dirty: [dirty, setDirty],
    blocked: [blocked, setBlocked],
  } = useWorkspaceState(startupNotice);
  const expectedRecord = useRef<string | null | undefined>(undefined);
  if (expectedRecord.current === undefined) {
    try {
      expectedRecord.current = primaryRecord();
    } catch {
      /* Storage blocked; loadWorkspace supplies recovery notice. */
    }
  }
  const [caseSession, setCaseSession] = useState<CaseSession>();
  const [runSaveStatus, setRunSaveStatus] = useState<{
    id: string;
    text: string;
  }>();
  const [runPhase, setRunPhase] = useState("idle");
  const runLock = useRef(false);
  const [page, setPageState] = useState("Dashboard");
  function setPage(next: string) {
    if (runLock.current) return;
    setCaseSession(undefined);
    setReport(undefined);
    setPreview(false);
    if (next === "My Workflows") prepareEditor();
    setPageState(next);
  }
  const [selected, setSelected] = useState<string>("dns");
  const [search, setSearch] = useState("");
  async function download(
    name: string,
    content: string,
    type = "application/json",
  ) {
    try {
      const outcome = await exportDocument(name, content, type);
      setMessage(
        outcome === "saved"
          ? "Export saved after native acknowledgment."
          : outcome === "cancelled"
            ? "Save cancelled. No file was exported."
            : "Download requested. Confirm it in your browser downloads.",
      );
    } catch (e) {
      setMessage(`Export failed: ${(e as Error).message}`);
    }
  }
  const [past, setPast] = useState<Workflow[]>([]),
    [future, setFuture] = useState<Workflow[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState(false);
  const [question, setQuestion] = useState<{
    node: FlowNode;
    answer: (v: string | boolean) => void;
  }>();
  const [report, setReport] = useState<Report>();
  const [preview, setPreview] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [metadata, setMetadata] = useState(false);
  const copyPending = useRef(false);
  const [duplicating, setDuplicating] = useState(false);
  const [targetProfileId, setTargetProfileId] = useState("");
  const [targetSetup, setTargetSetup] = useState(false);
  const [showEvidence, setShowEvidence] = useState(true);
  const [library, setLibrary] = useState(false);
  const [workflowSearch, setWorkflowSearch] = useState("");
  const abort = useRef<AbortController>(undefined);
  const questionRef = useRef<typeof question>(undefined);
  const file = useRef<HTMLInputElement>(null);
  const desktop = !!window.fixflow;
  const editGroup = useRef<{ key: string; time: number }>({ key: "", time: 0 });
  const dragOrigin = useRef<Workflow | undefined>(undefined);
  const editVersion = useRef(0);
  const [writer] = useState(() =>
    workspaceWriter({
      expected: expectedRecord,
      flush: flushDesktop,
      committed: setStore,
      pending: setSaving,
      failed: (error) => {
        setSaveError(error.message);
        setBlocked(true);
      },
    }),
  );
  const writeStore = useCallback(
    (
      reduce: (current: Store) => Store,
      clearId?: string,
      clearHistory = false,
    ) => {
      if (closingRef.current)
        return Promise.reject(
          Error("Close is in progress; no new workspace writes accepted."),
        );
      if (blocked)
        return Promise.reject(
          Error("Storage is read-only; export recovery data and reload."),
        );
      return writer.update(
        reduce,
        clearId ? { id: clearId, raw: draftRecord() } : undefined,
        clearHistory,
      );
    },
    [blocked, writer],
  );
  const updateWorkflow = useCallback(
    (next: Workflow) => {
      if (closingRef.current) return;
      editVersion.current++;
      setW(next);
      if (!blocked) {
        try {
          stageDraft(next, expectedRecord.current);
          void flushDesktop().catch((e) => {
            const reason = e instanceof Error ? e.message : "Save failed";
            setSaveError(reason);
            setBlocked(true);
            setMessage(
              `Native draft was not confirmed: ${reason}. Export your canvas before closing.`,
            );
          });
        } catch (e) {
          setMessage(
            `Draft recovery unavailable: ${e instanceof Error ? e.message : "Storage unavailable"}`,
          );
        }
      }
    },
    [blocked],
  );
  const commit = useCallback(
    (next: Workflow, group = "") => {
      if (running || closingRef.current) return;
      const now = Date.now();
      if (
        !group ||
        editGroup.current.key !== group ||
        now - editGroup.current.time > 800
      )
        setPast((p) => [...p.slice(-39), w]);
      editGroup.current = { key: group, time: now };
      setFuture([]);
      updateWorkflow(withCapabilities(next));
      setDirty(true);
    },
    [w, running, updateWorkflow],
  );
  const persist = useCallback(async () => {
    if (blocked || copyPending.current || closingRef.current) return;
    try {
      if (w.tags.includes(LOCAL_KIT_TAG))
        throw Error(
          "Reusable templates are edited through New from Kit. Export this recovered draft before reopening it as an independent playbook.",
        );
      const version = editVersion.current;
      await writeStore(
        (current) => ({
          ...current,
          workflows: putWorkflow(current.workflows, w),
        }),
        w.id,
      );
      if (version === editVersion.current) setDirty(false);
    } catch (e) {
      setMessage(
        `Save failed: ${e instanceof Error ? e.message : "Storage unavailable"}. Export your workflow to keep a copy.`,
      );
    }
  }, [w, blocked, writeStore]);
  useEffect(() => {
    if (!dirty || blocked || dragOrigin.current) return;
    const timer = setTimeout(persist, 1200);
    return () => clearTimeout(timer);
  }, [dirty, blocked, persist]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (
        dirty ||
        running ||
        saving ||
        document.querySelector('[data-unsaved="true"]')
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    if (window.fixflow) return;
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, running, saving]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === storageKeys.primary || event.key === null) {
        setBlocked(true);
        setMessage(
          "Storage changed in another window. Autosave paused. Export your current canvas, then reload to use the other window’s changes.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(
    () =>
      window.fixflow?.onCloseRequested(() => {
        void (async () => {
          if (closingRef.current) return;
          closingRef.current = true;
          setClosing(true);
          try {
            const ok = await prepareWorkspaceClose({
              activeRun: () => runLock.current,
              blocked: () => blocked,
              unsavedForm: () =>
                !!document.querySelector(
                  '[data-unsaved="true"][data-saving="false"]',
                ),
              version: () => editVersion.current,
              stage: () => {
                if (dirty) stageDraft(w, expectedRecord.current);
              },
              drain: () => writer.idle(),
              flush: flushDesktop,
            });
            await window.fixflow!.finishClose(ok);
          } catch {
            await window.fixflow!.finishClose(false);
          } finally {
            closingRef.current = false;
            setClosing(false);
          }
        })();
      }),
    [w, dirty, blocked, writer],
  );
  const undo = useCallback(() => {
    if (running || closingRef.current || !past.length) return;
    setFuture((f) => [w, ...f]);
    editGroup.current = { key: "", time: 0 };
    updateWorkflow(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  }, [past, w, running, updateWorkflow]);
  const redo = useCallback(() => {
    if (running || closingRef.current || !future.length) return;
    setPast((p) => [...p, w]);
    editGroup.current = { key: "", time: 0 };
    updateWorkflow(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  }, [future, w, running, updateWorkflow]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        persist();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        ["z", "y"].includes(e.key.toLowerCase()) &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        if (e.shiftKey || e.key.toLowerCase() === "y") redo();
        else undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [persist, undo, redo]);
  function open(next: Workflow) {
    if (runLock.current) return false;
    if (next.tags.includes(LOCAL_KIT_TAG)) {
      try {
        if (
          !window.confirm(
            "Open this local kit as an independent playbook with new identities and blank targets? The reusable template stays unchanged.",
          )
        )
          return false;
        next = instantiateLocalTemplate(next);
      } catch (e) {
        setMessage((e as Error).message);
        return false;
      }
    }
    setCaseSession(undefined);
    if (
      dirty &&
      !window.confirm(
        "Leave this workflow? Export or save first if storage is unavailable.",
      )
    )
      return false;
    updateWorkflow(withCapabilities(next));
    setPast([]);
    setFuture([]);
    setSelected("");
    setSteps([]);
    requestAnimationFrame(() => {
      void fitView({ padding: 0.18, maxZoom: 0.9, duration: 250 });
    });
    setPage("My Workflows");
    setDirty(true);
    return true;
  }
  function add(
    kind: FlowNode["kind"],
    position = { x: 650, y: w.nodes.length * 90 },
  ) {
    if (!kinds.includes(kind) || w.nodes.length >= 150) {
      setMessage(
        "Choose a supported node. Workflows are limited to 150 steps.",
      );
      return;
    }
    const n: FlowNode = {
      id: crypto.randomUUID(),
      kind,
      label: labels[kind],
      description: "",
      position,
      config: {
        timeout: 3000,
        ...(["dns", "tcp"].includes(kind) ? { host: "example.com" } : {}),
        ...(kind === "tcp" ? { port: 443 } : {}),
        ...(kind === "http" ? { url: "https://example.com" } : {}),
        ...(kind === "choice" ? { choices: ["Option A", "Option B"] } : {}),
        ...(kind === "condition"
          ? { field: "ok", operator: "equals", value: true }
          : {}),
      },
    };
    commit({ ...w, nodes: [...w.nodes, n] });
    setSelected(n.id);
  }
  function remove() {
    commit({
      ...w,
      nodes: w.nodes.filter((n) => n.id !== selected),
      edges: w.edges.filter(
        (e) => e.source !== selected && e.target !== selected,
      ),
    });
    setSelected("");
  }
  function onNodes(changes: NodeChange[]) {
    if (running) return;
    const relevant = changes.filter(
      (c) => c.type === "position" || c.type === "remove",
    );
    if (!relevant.length) return;
    const removed = new Set(
      relevant.filter((c) => c.type === "remove").map((c) => c.id),
    );
    const moved = new Map(
      relevant
        .filter((c) => c.type === "position" && c.position)
        .map((c) => [
          c.id,
          c.type === "position" ? c.position! : { x: 0, y: 0 },
        ]),
    );
    const result = w.nodes
      .filter((n) => !removed.has(n.id))
      .map((n) => ({ id: n.id, position: moved.get(n.id) || n.position }));
    const ids = new Set(result.map((n) => n.id));
    const positions = new Map(result.map((n) => [n.id, n.position]));
    const next = {
      ...w,
      nodes: w.nodes
        .filter((n) => ids.has(n.id))
        .map((n) =>
          n.position === positions.get(n.id)
            ? n
            : {
                ...n,
                position: positions.get(n.id)!,
              },
        ),
      edges: w.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
    const moving = relevant.some((c) => c.type === "position" && c.dragging);
    if (moving) {
      dragOrigin.current ??= w;
      editVersion.current++;
      setW(next);
      setDirty(true);
    } else if (dragOrigin.current) {
      const origin = dragOrigin.current;
      setPast((p) => [...p.slice(-39), origin]);
      dragOrigin.current = undefined;
      setFuture([]);
      updateWorkflow(next);
      setDirty(true);
    } else commit(next);
  }
  function onEdges(changes: EdgeChange[]) {
    if (running) return;
    const relevant = changes.filter((c) => c.type === "remove");
    if (relevant.length)
      commit({
        ...w,
        edges: w.edges
          .filter((e) => !relevant.some((c) => c.id === e.id))
          .map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            ...("branch" in e ? { branch: e.branch as string } : {}),
          })),
      });
  }
  function connect(c: Connection, replacing?: string) {
    if (running) return;
    const error = connectionError(w, c, replacing);
    if (error) {
      setMessage(error);
      return;
    }
    commit({
      ...w,
      edges: [
        ...w.edges.filter((e) => e.id !== replacing),
        {
          id: replacing || crypto.randomUUID(),
          source: c.source,
          target: c.target,
          ...(c.sourceHandle ? { branch: c.sourceHandle } : {}),
        },
      ],
    });
  }
  async function run() {
    setApproval(false);
    if (runLock.current) return;
    runLock.current = true;
    const session = caseSession;
    const snapshot = structuredClone(w);
    let result: Report | undefined;
    setRunning(true);
    setRunPhase("approval");
    setSteps([]);
    setRunSaveStatus(undefined);
    setMessage("");
    try {
      workflowSchema.parse(snapshot);
      if (snapshot.tags.includes(LOCAL_KIT_TAG))
        throw Error(
          "Instantiate the reusable kit as a new investigation before running it.",
        );
      const errors = validate(snapshot);
      if (errors.length) throw Error(errors.join("\n"));
      if (blocked)
        throw Error("Storage is read-only; recover before starting a run.");
      // Save the exact editor snapshot and validate the case before requesting any diagnostics.
      await writeStore((current) => {
        if (session) validateCaseSession(current, session, snapshot.id);
        return {
          ...current,
          workflows: putWorkflow(current.workflows, snapshot),
        };
      }, snapshot.id);
      setDirty(false);
      if (desktop && !(await window.fixflow!.approve(snapshot))) {
        setMessage("Native approval cancelled. No report attached.");
        return;
      }
      if (session) validateCaseSession(load(), session, snapshot.id);
      setSteps([]);
      setShowEvidence(true);
      setRunPhase("executing");
      abort.current = new AbortController();
      const signal = abort.current.signal;
      result = await execute(
        snapshot,
        desktop ? (n) => window.fixflow!.diagnose(n) : demoProvider,
        (n) =>
          new Promise((resolve, reject) => {
            const q = { node: n, answer: resolve };
            questionRef.current = q;
            setQuestion(q);
            signal.addEventListener(
              "abort",
              () => {
                setQuestion(undefined);
                reject(Error("Cancelled"));
              },
              { once: true },
            );
          }),
        signal,
        (s) =>
          setSteps((old) => [...old.filter((x) => x.nodeId !== s.nodeId), s]),
        !desktop,
      );
      const cancelled =
        signal.aborted || result.steps.some((s) => s.status === "cancelled");
      if (cancelled) setCaseSession(undefined);
      setReport(result);
      setRunPhase("saving");
      setRunSaveStatus({
        id: result.id,
        text: "Report save pending — awaiting workspace acknowledgment; not yet attached.",
      });
      const completed = result;
      await writeStore((current) =>
        recordCaseRun(current, snapshot, completed, session, cancelled),
      );
      const text = cancelled
        ? "Cancelled run saved to history; not attached to a case."
        : session
          ? desktop
            ? "Report and case link saved — native durable acknowledgment received."
            : "SIMULATED report and case link saved to this browser workspace."
          : "Report saved to history without a case link.";
      setRunSaveStatus({ id: result.id, text });
      setMessage(text);
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Execution failed";
      const text = result
        ? `Report save not acknowledged; not successfully attached. ${reason} Export this report before closing, then reopen the case for a safe retry.`
        : reason;
      if (result) setRunSaveStatus({ id: result.id, text });
      setMessage(text);
    } finally {
      setCaseSession(undefined);
      setRunning(false);
      setRunPhase("idle");
      setQuestion(undefined);
      questionRef.current = undefined;
      abort.current = undefined;
      try {
        await window.fixflow?.cancel();
      } catch {
        setMessage(
          "Native diagnostic cleanup was not acknowledged. Reopen the app before another run; inspect the report save status separately.",
        );
      } finally {
        runLock.current = false;
      }
    }
  }
  useEffect(() => {
    if (!caseSession || running) return;
    try {
      validateCaseSession(store, caseSession, w.id);
    } catch (e) {
      setCaseSession(undefined);
      setMessage((e as Error).message);
    }
  }, [caseSession, running, store, w.id]);
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog || dialog.dataset.caseDialog) return;
    const previous = document.activeElement as HTMLElement;
    const items = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      );
    items()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || e.defaultPrevented) return;
      const elements = items();
      const first = elements[0],
        last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [
    approval,
    question,
    report,
    metadata,
    preview,
    library,
    targetSetup,
    comparing,
  ]);
  const visibleReports = useMemo(
    () =>
      page === "Run History" || page === "Reports"
        ? filterHistory(store.reports, store.favoriteRuns || [], historyFilter)
        : [],
    [page, store.reports, store.favoriteRuns, historyFilter],
  );
  const active = w.nodes.find((n) => n.id === selected);
  const editor = page === "My Workflows";
  return (
    <div
      className={`app-shell ${compactNav ? "compact-nav" : ""}`}
      inert={closing}
      aria-busy={closing}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("Dashboard");
          }}
        >
          <img
            className="brand-mark"
            src="./favicon.svg"
            alt=""
            width="38"
            height="38"
          />
          <div>
            Rootlith<span>STUDIO</span>
          </div>
        </a>
        <button
          className="nav-toggle"
          aria-label={compactNav ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!compactNav}
          onClick={() => setCompactNav((v) => !v)}
        >
          {compactNav ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
          <span>Workspace</span>
        </button>
        <div className="workspace-label">TECHNICIAN WORKSPACE</div>
        <nav>
          {nav.map(([name, Icon]) => (
            <button
              disabled={running}
              key={name}
              onPointerEnter={
                name === "My Workflows" || name === "Create Workflow"
                  ? prepareEditor
                  : undefined
              }
              onFocus={
                name === "My Workflows" || name === "Create Workflow"
                  ? prepareEditor
                  : undefined
              }
              title={name === "Dashboard" ? "Workbench" : name}
              aria-label={name === "Dashboard" ? "Workbench" : name}
              aria-current={page === name ? "page" : undefined}
              className={page === name ? "active" : ""}
              onClick={() =>
                name === "Create Workflow"
                  ? open({
                      ...template(),
                      id: crypto.randomUUID(),
                      name: "Untitled workflow",
                      nodes: [
                        {
                          id: "start",
                          kind: "start",
                          label: "Start",
                          position: { x: 300, y: 0 },
                          description: "",
                          config: { timeout: 3000 },
                        },
                        {
                          id: "end",
                          kind: "end",
                          label: "End",
                          position: { x: 300, y: 200 },
                          description: "",
                          config: { timeout: 3000 },
                        },
                      ],
                      edges: [{ id: "first", source: "start", target: "end" }],
                    })
                  : setPage(name)
              }
            >
              <Icon size={18} />
              <span>{name === "Dashboard" ? "Workbench" : name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <div>
            Local by design<small>No accounts. No telemetry.</small>
          </div>
        </div>
        <div className="version">
          v{productVersion} <span>ALPHA</span>
        </div>
      </aside>
      <main>
        <header>
          <div className="header-title">
            <span className="breadcrumb">
              Workspace <span>/</span>{" "}
              {editor
                ? "Workflow editor"
                : page === "Dashboard"
                  ? "Workbench"
                  : page}
            </span>
            <button
              className="title-button"
              disabled={!editor}
              onClick={() => setMetadata(true)}
            >
              <h1>
                {editor ? w.name : page === "Dashboard" ? "Workbench" : page}
              </h1>
              {editor && <span>↗</span>}
            </button>
          </div>
          <div className="header-actions">
            <span className="demo-indicator">
              <i />
              {desktop
                ? "Desktop · native checks"
                : "Browser demo · simulated checks"}
            </span>
            {editor && (
              <>
                <button
                  onClick={() =>
                    download(
                      `${w.name}.fixflow.json`,
                      JSON.stringify(w, null, 2),
                    )
                  }
                >
                  <Download size={15} /> Export
                </button>
                <button
                  className="primary"
                  disabled={running}
                  onClick={() => {
                    try {
                      workflowSchema.parse(w);
                      const errors = validate(w);
                      if (errors.length) throw Error(errors.join("\n"));
                      setApproval(true);
                    } catch (e) {
                      setMessage(
                        e instanceof Error ? e.message : "Invalid workflow",
                      );
                    }
                  }}
                >
                  <Play size={15} fill="currentColor" /> Run workflow
                </button>
              </>
            )}
          </div>
        </header>
        <div
          className={`workspace-status ${saveError ? "target-error" : ""}`}
          role="status"
        >
          {saveError
            ? `Save not confirmed: ${saveError}. Export recovery data before reopening.`
            : saving
              ? "Saving workspace… waiting for persistence"
              : blocked
                ? "Storage is read-only; recovery required"
                : dirty
                  ? "Canvas has unsaved changes"
                  : "Workspace saved on this device"}
        </div>
        {editor && caseSession && (
          <section className="case-context" aria-label="Case execution context">
            <div>
              <strong>
                Run for case:{" "}
                {store.cases?.find((c) => c.id === caseSession.caseId)?.name}
              </strong>
              <p>
                {running
                  ? runPhase === "saving"
                    ? "Execution finished; report and case link await save acknowledgment."
                    : runPhase === "approval"
                      ? "Preparing saved targets and awaiting approval; no checks started."
                      : "Case-bound execution in progress. Cancelled runs are not attached."
                  : "One-run context · next explicitly approved run only. No diagnostic has started. Leaving this editor or cancelling clears the context."}
              </p>
            </div>
            <button
              disabled={running}
              onClick={() => {
                setCaseSession(undefined);
                setMessage(
                  "Case context cleared. Future runs remain unlinked.",
                );
              }}
            >
              Clear case context
            </button>
          </section>
        )}
        {message && (
          <div className="notice" role="alert">
            <span>{message}</span>
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {editor ? (
          <>
            <div className="workspace-toolbar">
              <div>
                <WorkflowIcon size={15} />
                <span>{w.description}</span>
              </div>
              <div>
                <button
                  title="Undo (Ctrl+Z)"
                  disabled={!past.length || running}
                  onClick={undo}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  title="Redo (Ctrl+Shift+Z)"
                  disabled={!future.length || running}
                  onClick={redo}
                >
                  <Redo2 size={16} />
                </button>
                <span className="separator" />
                <button
                  title="Save (Ctrl+S)"
                  disabled={blocked}
                  onClick={persist}
                >
                  <Save size={15} />
                </button>
                <button
                  title="Open saved workflow"
                  disabled={running}
                  onClick={() => setLibrary(true)}
                >
                  <FolderOpen size={15} /> Open
                </button>
                <button disabled={running} onClick={() => setMetadata(true)}>
                  Edit details
                </button>
                <button
                  disabled={running || !w.nodes.length}
                  onClick={() => {
                    try {
                      commit(arrangeWorkflow(w));
                      requestAnimationFrame(() => {
                        void fitView({
                          padding: 0.18,
                          maxZoom: 0.9,
                          duration: 250,
                        });
                      });
                    } catch (e) {
                      setMessage(
                        e instanceof Error
                          ? e.message
                          : "Could not arrange graph",
                      );
                    }
                  }}
                >
                  Auto Arrange
                </button>
                <button
                  disabled={running}
                  onClick={() => {
                    setTargetProfileId("");
                    setTargetSetup(true);
                  }}
                >
                  Quick Target Setup
                </button>
                <button
                  title="Import workflow"
                  disabled={running}
                  onClick={() => file.current?.click()}
                >
                  <Upload size={15} />
                </button>
              </div>
            </div>
            <div className="editor-layout">
              <aside className="palette">
                <div className="palette-heading">
                  <h3>Node library</h3>
                  <span>{kinds.length}</span>
                </div>
                <label className="search">
                  <Search size={15} />
                  <input
                    aria-label="Search nodes"
                    placeholder="Search nodes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <kbd>⌕</kbd>
                </label>
                {["Flow", "Diagnostics", "Interaction"].map((group) => (
                  <section key={group}>
                    <h4>{group}</h4>
                    {kinds
                      .filter((k) =>
                        group === "Diagnostics"
                          ? diagnosticKinds.includes(k)
                          : group === "Interaction"
                            ? ["choice", "confirmation", "question"].includes(k)
                            : !diagnosticKinds.includes(k) &&
                              !["choice", "confirmation", "question"].includes(
                                k,
                              ),
                      )
                      .filter((k) =>
                        labels[k].toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((k) => {
                        const Icon = icons[k];
                        return (
                          <button
                            aria-label={labels[k]}
                            draggable={!running}
                            disabled={running}
                            onDragStart={(e) =>
                              e.dataTransfer.setData("application/fixflow", k)
                            }
                            key={k}
                            onClick={() => add(k)}
                          >
                            <span className={`palette-icon ${k}`}>
                              <Icon size={15} />
                            </span>
                            {labels[k]}
                            <Plus size={12} />
                          </button>
                        );
                      })}
                  </section>
                ))}
                <div className="palette-tip">
                  Click or drag to add a step.
                  <br />
                  Connect handles to build a path. Select an edge to delete it;
                  drag an endpoint to reconnect.
                </div>
              </aside>
              <div className="canvas-wrap">
                <div className="canvas-label">
                  PLAYBOOK CANVAS <span>· {w.nodes.length} steps</span>
                  {!desktop && <span> · SIMULATED DEMO</span>}
                </div>
                <EditorCanvas
                  key={w.id}
                  ready={readyCanvas}
                  workflow={w}
                  selected={selected}
                  steps={steps}
                  onSelect={setSelected}
                  onNodesChange={onNodes}
                  onEdgesChange={onEdges}
                  onConnect={connect}
                  onDrop={add}
                  disabled={running}
                />
                {steps.length > 0 && (
                  <div className="live-timeline">
                    <button
                      className="timeline-toggle"
                      aria-expanded={showEvidence}
                      onClick={() => setShowEvidence(!showEvidence)}
                    >
                      {showEvidence ? "Hide" : "Show"} evidence timeline
                    </button>
                    {showEvidence && (
                      <EvidenceTimeline steps={steps} demo={!desktop} />
                    )}
                  </div>
                )}
                {(running || steps.length > 0) && (
                  <div className="run-strip">
                    <div>
                      <i className={running ? "pulse" : ""} />
                      <strong>
                        {running
                          ? runPhase === "saving"
                            ? "Saving report; awaiting acknowledgment"
                            : runPhase === "approval"
                              ? "Awaiting approval"
                              : "Workflow in progress"
                          : steps.some((s) => s.status === "cancelled")
                            ? "Run cancelled"
                            : "Execution finished"}
                      </strong>
                      <span>
                        {
                          steps.filter(
                            (s) => !["running", "pending"].includes(s.status),
                          ).length
                        }{" "}
                        / {w.nodes.length} steps
                      </span>
                    </div>
                    {running && (
                      <p className="live-evidence" aria-live="polite">
                        <strong>
                          {steps.find((s) => s.status === "running")?.label}
                        </strong>
                        <br />
                        {
                          [...steps].reverse().find((s) => s.output)?.output
                            ?.detail
                        }
                      </p>
                    )}
                    <button
                      disabled={running && runPhase !== "executing"}
                      onClick={() =>
                        running
                          ? (abort.current?.abort(),
                            void window.fixflow?.cancel())
                          : setPage("Run History")
                      }
                    >
                      {running ? (
                        <>
                          <Square size={13} /> Cancel
                        </>
                      ) : (
                        <>
                          View report <ArrowUpRight size={14} />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
              <fieldset disabled={running} className="inspector-fieldset">
                <Inspector
                  node={active}
                  workflow={w}
                  change={(n) =>
                    commit(
                      {
                        ...w,
                        nodes: w.nodes.map((x) => (x.id === n.id ? n : x)),
                      },
                      `inspector-${n.id}`,
                    )
                  }
                  remove={remove}
                  duplicate={() => {
                    if (active) {
                      const n = {
                        ...active,
                        id: crypto.randomUUID(),
                        position: {
                          x: active.position.x + 50,
                          y: active.position.y + 50,
                        },
                        label: active.label + " copy",
                      };
                      commit({ ...w, nodes: [...w.nodes, n] });
                      setSelected(n.id);
                    }
                  }}
                />
              </fieldset>
            </div>
            <footer>
              <span>
                {w.name}
                <b>·</b>Schema v1 <b>·</b>
                {desktop ? "Native storage" : "Browser storage"}
              </span>
              <span className={dirty ? "muted" : "saved"}>
                <i />
                {blocked
                  ? "Storage needs recovery"
                  : dirty || saving
                    ? "Saving changes…"
                    : "All changes saved locally"}
              </span>
              <span>
                Ctrl S <b>Save</b> Ctrl Z <b>Undo</b>
              </span>
            </footer>
          </>
        ) : (
          <div className="content-page">
            {page === "Dashboard" && (
              <CaseWorkbench
                store={store}
                selectedCaseId={caseView.id}
                selectCase={(id) => setCaseView({ id, pane: "overview" })}
                pane={caseView.pane}
                navigate={(pane) => setCaseView((v) => ({ ...v, pane }))}
                disabled={blocked}
                save={writeStore}
                exportFile={exportDocument}
                openCaseWorkflow={(caseId, workflow) => {
                  try {
                    if (workflow.tags.includes(LOCAL_KIT_TAG))
                      throw Error(
                        "Use New from Kit to create an independent investigation before a case run.",
                      );
                    const context = beginCaseSession(
                      store,
                      caseId,
                      workflow.id,
                    );
                    if (open(workflow)) {
                      setCaseSession(context);
                      setCaseView({ id: caseId, pane: "playbooks" });
                      if (
                        workflow.nodes.some(
                          (n) =>
                            (["dns", "tcp"].includes(n.kind) &&
                              !n.config.host) ||
                            (n.kind === "tcp" && !n.config.port) ||
                            (n.kind === "http" && !n.config.url),
                        )
                      ) {
                        setTargetProfileId("");
                        setTargetSetup(true);
                      }
                      setMessage(
                        "Case context ready. Review targets, then choose Run workflow explicitly.",
                      );
                    }
                  } catch (e) {
                    setCaseSession(undefined);
                    setMessage((e as Error).message);
                  }
                }}
                configureWorkflow={(workflow) => {
                  if (open(workflow)) {
                    setTargetProfileId("");
                    setTargetSetup(true);
                  }
                }}
                openWorkflow={(workflow, profileId) => {
                  if (open(workflow) && profileId) {
                    setTargetProfileId(profileId);
                    setTargetSetup(true);
                  }
                }}
                openReport={(value) => {
                  setReport(value);
                  setPreview(false);
                  setSensitive(false);
                }}
                compare={(a, b) => {
                  setCompareIds([a, b]);
                  setComparing(true);
                }}
                editor={() => setPage("My Workflows")}
                starters={() => setPage("Templates")}
              />
            )}
            {page === "Templates" && (
              <>
                <h2>A useful place to start.</h2>
                <p className="muted">
                  Open a starter, use Quick Target Setup, then review and run.
                  Your changes save as a workflow; the starter stays available.
                </p>
                <h3>Investigation starters · configure your own targets</h3>
                {starters.map((entry, i) => (
                  <button
                    className="template-row"
                    key={entry.key}
                    onClick={() => {
                      if (open(starter(entry.key))) {
                        setTargetProfileId("");
                        setTargetSetup(true);
                      }
                    }}
                  >
                    <span className="template-number">0{i + 1}</span>
                    <span className="template-icon">
                      <Network size={25} />
                    </span>
                    <div>
                      <h3>{entry.name}</h3>
                      <p>{entry.description}</p>
                      <small>
                        Own targets required · read-only · no scanning
                      </small>
                    </div>
                    <span>
                      Configure playbook <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
                <h3>Classic examples</h3>
                {[
                  [
                    "internet",
                    "Internet Connection",
                    "Investigate adapters, DNS, and connectivity.",
                  ],
                  [
                    "website",
                    "Website Reachability",
                    "Follow a request from hostname to HTTP response.",
                  ],
                  [
                    "local",
                    "Local Development Server",
                    "Check your local service and development port.",
                  ],
                ].map(([key, name, description], i) => (
                  <button
                    className="template-row"
                    key={key}
                    onClick={() => open(template(key))}
                  >
                    <span className="template-number">0{i + 1}</span>
                    <span className="template-icon">
                      <Network size={25} />
                    </span>
                    <div>
                      <h3>{name}</h3>
                      <p>{description}</p>
                      <small>Guided branching · Read-only</small>
                    </div>
                    <span>
                      Open template <ArrowUpRight size={15} />
                    </span>
                  </button>
                ))}
              </>
            )}
            {page === "Run History" || page === "Reports" ? (
              <>
                <h2>
                  {page === "Reports"
                    ? "Evidence you can share."
                    : "Every run tells a story."}
                </h2>
                <p className="muted">
                  Latest 50 runs retained on this device. Select a run to
                  inspect its evidence.
                </p>
                {!store.reports.length && (
                  <div className="empty">
                    <History size={36} />
                    <h3>No runs yet</h3>
                    <p>
                      Open a workflow and run it to collect your first report.
                    </p>
                    <button onClick={() => setPage("My Workflows")}>
                      Open editor
                    </button>
                  </div>
                )}
                {store.reports.length > 0 && (
                  <div className="comparison-picker">
                    <strong>Compare two runs</strong>
                    <p className="muted">
                      Select a baseline first, then a follow-up of the same
                      workflow and execution mode.
                    </p>
                    {compareIds.length > 0 && (
                      <p>
                        {compareIds
                          .map((id, i) => {
                            const r = store.reports.find((r) => r.id === id);
                            return `${i === 0 ? "Baseline" : "Follow-up"}: ${r?.workflow || "Unavailable run"} · ${r ? new Date(r.date).toLocaleString() : ""}`;
                          })
                          .join(" → ")}
                      </p>
                    )}
                    <button
                      className="primary"
                      disabled={compareIds.length !== 2}
                      onClick={() => setComparing(true)}
                    >
                      Compare selected runs
                    </button>
                    {compareIds.length > 0 && (
                      <button onClick={() => setCompareIds([])}>
                        Clear selection
                      </button>
                    )}
                  </div>
                )}
                {!!store.reports.length && (
                  <div className="history-tools">
                    <label>
                      Search runs
                      <input
                        value={historyFilter.search}
                        maxLength={120}
                        placeholder="Workflow or step label"
                        onChange={(e) =>
                          setHistoryFilter({
                            ...historyFilter,
                            search: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Execution mode
                      <select
                        aria-label="Execution mode"
                        value={historyFilter.mode}
                        onChange={(e) =>
                          setHistoryFilter({
                            ...historyFilter,
                            mode: e.target.value,
                          })
                        }
                      >
                        <option value="all">All modes</option>
                        <option value="simulated">Simulated</option>
                        <option value="native">Native</option>
                      </select>
                    </label>
                    <label>
                      Contains step status
                      <select
                        aria-label="Contains step status"
                        value={historyFilter.status}
                        onChange={(e) =>
                          setHistoryFilter({
                            ...historyFilter,
                            status: e.target.value,
                          })
                        }
                      >
                        {[
                          "all",
                          "passed",
                          "failed",
                          "inconclusive",
                          "cancelled",
                          "skipped",
                          "pending",
                          "running",
                        ].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Sort runs
                      <select
                        aria-label="Sort runs"
                        value={historyFilter.order}
                        onChange={(e) =>
                          setHistoryFilter({
                            ...historyFilter,
                            order: e.target.value,
                          })
                        }
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                      </select>
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={historyFilter.favoritesOnly}
                        onChange={(e) =>
                          setHistoryFilter({
                            ...historyFilter,
                            favoritesOnly: e.target.checked,
                          })
                        }
                      />
                      Favorites only
                    </label>
                    <p role="status">
                      {visibleReports.length} matching runs ·{" "}
                      {compareIds.length}/2 selected
                    </p>
                    {!visibleReports.length && (
                      <p>No runs match. Change the search or filters.</p>
                    )}
                  </div>
                )}
                {visibleReports.map((r) => {
                  const first = store.reports.find(
                    (x) => x.id === compareIds[0],
                  );
                  const scope =
                    first && comparisonScope(first, r, store.runWorkflows);
                  const selectedRun = compareIds.includes(r.id);
                  const unavailable =
                    !selectedRun &&
                    (compareIds.length === 2 ||
                      (!!first && scope !== "verified" && scope !== "legacy"));
                  return (
                    <div className="run-history-row" key={r.id}>
                      <button
                        aria-label={`Favorite run ${r.id}`}
                        aria-pressed={
                          store.favoriteRuns?.includes(r.id) || false
                        }
                        disabled={blocked || metadataBusy}
                        onClick={async () => {
                          setMetadataBusy(true);
                          try {
                            await writeStore((current) => {
                              const favorites = current.favoriteRuns || [];
                              return {
                                ...current,
                                favoriteRuns: retainedFavorites(
                                  current.reports,
                                  favorites.includes(r.id)
                                    ? favorites.filter((id) => id !== r.id)
                                    : [...favorites, r.id],
                                ),
                              };
                            });
                          } catch (e) {
                            setMessage(
                              `Favorite was not saved: ${(e as Error).message}`,
                            );
                          } finally {
                            setMetadataBusy(false);
                          }
                        }}
                      >
                        {store.favoriteRuns?.includes(r.id) ? "★" : "☆"}
                      </button>
                      <label
                        className="run-select"
                        title={
                          unavailable
                            ? "Choose runs of the same workflow and execution mode"
                            : "First selected run is the baseline"
                        }
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select run ${r.id}`}
                          checked={selectedRun}
                          disabled={unavailable}
                          onChange={() =>
                            setCompareIds((ids) =>
                              selectedRun
                                ? ids.filter((id) => id !== r.id)
                                : [...ids, r.id],
                            )
                          }
                        />
                        <span>
                          {selectedRun
                            ? compareIds.indexOf(r.id) === 0
                              ? "Baseline"
                              : "Follow-up"
                            : "Select"}
                        </span>
                      </label>
                      <button
                        className="workflow-row"
                        onClick={() => setReport(r)}
                      >
                        <ChartNoAxesCombined />
                        <div>
                          <strong>{r.workflow}</strong>
                          <p>
                            {new Date(r.date).toLocaleString()} ·{" "}
                            {r.demo ? "SIMULATED DEMO" : "Desktop diagnostics"}{" "}
                            ·{" "}
                            {
                              r.steps.filter((s) => s.status === "passed")
                                .length
                            }{" "}
                            passed
                          </p>
                        </div>
                        <ArrowUpRight />
                      </button>
                    </div>
                  );
                })}
              </>
            ) : null}
            {page === "Settings" && (
              <Suspense fallback={<p role="status">Opening Settings…</p>}>
                <SettingsPage
                  compact={compactNav}
                  setCompact={setCompactNav}
                  renderData={() => (
                    <>
                      {" "}
                      <Suspense
                        fallback={
                          <div className="tool-loading" role="status">
                            Opening backup tools…
                          </div>
                        }
                      >
                        <BackupTransfer
                          store={store}
                          blocked={blocked}
                          idle={() => writer.idle()}
                          write={writeStore}
                        />
                      </Suspense>
                      <section className="settings-section">
                        <h3>Privacy & retention</h3>
                        <p>
                          No telemetry or accounts. Update checks never send
                          investigation data. Network checks contact only
                          explicitly approved targets.{" "}
                          {desktop
                            ? "Your data is stored by the main process; the renderer has no filesystem paths or Node access."
                            : "Browser storage is specific to this origin."}
                        </p>
                        <p>
                          Runs may contain private hostnames and addresses.
                          Reports export with evidence withheld by default. The
                          most recent 50 runs are retained. Clearing history
                          also clears reports from the last-good backup.
                          Quarantined damaged records may retain old evidence;
                          Reset local data erases all recovery records.
                        </p>
                        <button
                          onClick={async () => {
                            if (
                              !confirm(
                                "Clear retained run history and its last-good backup? Case links to removed reports will become missing references. Export needed reports first.",
                              )
                            )
                              return;
                            try {
                              await writeStore(
                                (current) => current,
                                undefined,
                                true,
                              );
                              setCompareIds([]);
                              setComparing(false);
                              setMessage(
                                "Run history cleared from active storage and its last-good backup. Quarantined damaged data is retained until Reset local data.",
                              );
                            } catch {
                              setMessage("Could not clear history.");
                            }
                          }}
                        >
                          Clear run history
                        </button>
                      </section>
                      <section className="settings-section">
                        <h3>Storage & recovery</h3>
                        <button
                          disabled={saving > 0}
                          onClick={async () => {
                            if (
                              !confirm(
                                "Restore the last good storage backup? The current record will be preserved in recovery data.",
                              )
                            )
                              return;
                            try {
                              await writer.idle();
                              restoreBackup();
                              await flushDesktop();
                              window.location.reload();
                            } catch (e) {
                              setMessage(
                                e instanceof Error
                                  ? e.message
                                  : "Restore failed.",
                              );
                            }
                          }}
                        >
                          Restore last good backup
                        </button>
                        <p>
                          {desktop
                            ? "Native data stays in the existing fixflow-studio profile. Saves are confirmed after durable writes, with a verified recovery generation and revision protection."
                            : "Versioned browser storage with a last-good backup and a draft journal."}{" "}
                          Export recovery copies before resetting data.
                        </p>
                        <button
                          onClick={async () => {
                            try {
                              if (window.fixflow) {
                                const saved =
                                  await window.fixflow.exportRecovery();
                                setMessage(
                                  saved
                                    ? "Recovery copy saved after native acknowledgment."
                                    : "Save cancelled. No recovery copy was exported.",
                                );
                              } else
                                await download(
                                  "rootlith-recovery.json",
                                  recoveryExport(),
                                );
                            } catch (e) {
                              setMessage(String(e));
                            }
                          }}
                        >
                          Export storage recovery copy
                        </button>
                        <button
                          className="danger"
                          disabled={saving > 0}
                          onClick={async () => {
                            if (
                              confirm(
                                "Erase all saved workflows, cases and history? Export the open canvas and a recovery copy first. The app will reload.",
                              )
                            ) {
                              try {
                                await writer.idle();
                                resetStorage();
                                await flushDesktop();
                                expectedRecord.current = null;
                                setBlocked(false);
                                setStore({
                                  version: 1,
                                  workflows: [],
                                  reports: [],
                                });
                                window.location.reload();
                                setMessage(
                                  "Storage reset. Reloading the workspace.",
                                );
                              } catch (e) {
                                setMessage(
                                  `Reset was not confirmed: ${String(e)}. Reopen the app for recovery.`,
                                );
                              }
                            }
                          }}
                        >
                          Reset local data
                        </button>
                      </section>
                    </>
                  )}
                />
              </Suspense>
            )}
            {page === "Dashboard" && (
              <details className="saved-playbooks-disclosure">
                <summary>Manage saved playbooks</summary>
                {store.workflows
                  .filter((w) => !w.tags.includes(LOCAL_KIT_TAG))
                  .map((x) => (
                    <div className="saved-workflow" key={x.id}>
                      <button
                        className="workflow-row"
                        key={x.id}
                        onClick={() => open(x)}
                      >
                        <FolderOpen />
                        <div>
                          <strong>{x.name}</strong>
                          <p>{x.nodes.length} steps · Saved playbook</p>
                        </div>
                        <ArrowUpRight />
                      </button>
                      <button
                        className="danger"
                        aria-label={`Remove saved ${x.name}`}
                        disabled={blocked || dirty || saving > 0 || running}
                        title={
                          dirty || saving
                            ? "Wait for the canvas to finish saving before removing a playbook"
                            : "Remove saved playbook; case links will show it as missing"
                        }
                        onClick={async () => {
                          if (
                            !confirm(
                              `Remove saved workflow “${x.name}”? Export a copy first. The open canvas is retained.`,
                            )
                          )
                            return;
                          try {
                            await writeStore((current) => ({
                              ...current,
                              workflows: current.workflows.filter(
                                (w) => w.id !== x.id,
                              ),
                            }));
                          } catch {
                            setMessage(
                              "Could not remove saved workflow. Existing data was preserved.",
                            );
                          }
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
              </details>
            )}
          </div>
        )}
      </main>
      <input
        type="file"
        hidden
        ref={file}
        accept=".json,.fixflow.json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 512000) throw Error("Workflow exceeds 500 KB");
            const next = parseWorkflow(await f.text());
            open(next);
            setMessage(
              "Imported as untrusted data. Review all targets and guidance before running.",
            );
          } catch (e) {
            setMessage(
              `Import rejected: ${e instanceof Error ? e.message : "Invalid data"}`,
            );
          } finally {
            if (file.current) file.current.value = "";
          }
        }}
      />
      {comparing &&
        compareIds.length === 2 &&
        (() => {
          const baseline = store.reports.find((r) => r.id === compareIds[0]);
          const followup = store.reports.find((r) => r.id === compareIds[1]);
          return baseline && followup ? (
            <Suspense
              fallback={
                <div className="tool-loading" role="status">
                  Opening comparison…
                </div>
              }
            >
              <RunComparison
                key={`${baseline.id}:${followup.id}`}
                baseline={baseline}
                followup={followup}
                origins={store.runWorkflows || {}}
                exportFile={download}
                close={() => setComparing(false)}
                swap={() => setCompareIds((ids) => [...ids].reverse())}
              />
            </Suspense>
          ) : null;
        })()}
      {targetSetup && (
        <QuickTarget
          workflow={w}
          profiles={store.targetProfiles || []}
          initialProfileId={targetProfileId}
          saveProfiles={async (update) => {
            if (blocked)
              throw Error(
                "Storage is read-only. Restore it in Settings before saving profiles.",
              );
            await writeStore((current) => ({
              ...current,
              targetProfiles: update(current.targetProfiles || []),
            }));
          }}
          close={() => setTargetSetup(false)}
          apply={(next) => {
            commit(next);
            setTargetSetup(false);
          }}
        />
      )}
      {approval && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approval-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setApproval(false);
                setCaseSession(undefined);
                setMessage(
                  "Run approval cancelled. Case context cleared; no report attached.",
                );
              }
            }}
          >
            <ShieldCheck className="mint" size={30} />
            <h2 id="approval-title">Review execution scope</h2>
            <p>
              {desktop
                ? "The desktop will request native approval for these read-only checks."
                : "Demo run: the following checks will use SIMULATED data. No real diagnostic network requests will be made."}
            </p>
            {caseSession && (
              <p>
                Case-bound run:{" "}
                {store.cases?.find((c) => c.id === caseSession.caseId)?.name}.
                The report links only after a successful workspace save.
              </p>
            )}
            <div className="scope-list">
              {w.nodes
                .filter((n) => diagnosticKinds.includes(n.kind))
                .map((n) => (
                  <div key={n.id}>
                    <strong>{n.label}</strong>
                    <code>{target(n) || "Local adapter information"}</code>
                    <small>{n.config.timeout} ms limit</small>
                  </div>
                ))}
            </div>
            <p className="muted">
              Only test systems you own or are authorized to inspect. No
              changes, repairs, scripts, or redirect following.
            </p>
            <div className="modal-actions">
              <button
                onClick={() => {
                  setApproval(false);
                  setCaseSession(undefined);
                  setMessage(
                    "Run approval cancelled. Case context cleared; no report attached.",
                  );
                }}
              >
                Cancel
              </button>
              <button autoFocus className="primary" onClick={run}>
                {desktop ? "Continue to approval" : "Start simulated run"}{" "}
                <Play size={14} />
              </button>
            </div>
          </section>
        </div>
      )}
      {question && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="question-title"
          >
            <h2 id="question-title">{question.node.label}</h2>
            <p>{question.node.description}</p>
            <div className="modal-actions">
              <button
                onClick={() => {
                  abort.current?.abort();
                  void window.fixflow?.cancel();
                }}
              >
                Cancel run
              </button>
              {(question.node.kind === "choice"
                ? question.node.config.choices || []
                : ["Yes", "No"]
              ).map((choice, i) => (
                <button
                  autoFocus={i === 0}
                  className={i === 0 ? "primary" : ""}
                  key={choice}
                  onClick={() => {
                    question.answer(
                      question.node.kind === "choice" ? choice : i === 0,
                    );
                    setQuestion(undefined);
                  }}
                >
                  {choice}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {library && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Open saved workflow"
          >
            <div className="report-heading">
              <h2>Open a saved workflow</h2>
              <button
                aria-label="Close workflow library"
                onClick={() => setLibrary(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label>
              Find a workflow
              <input
                value={workflowSearch}
                onChange={(e) => setWorkflowSearch(e.target.value)}
              />
            </label>
            <p className="muted">
              Open to edit or run. Duplicate creates a separate saved workflow;
              exports preserve the original identity.
            </p>
            <p className="muted">
              Reusable templates are managed in Workbench → New from Kit; they
              create independent blank-target investigations.
            </p>
            {store.workflows
              .filter((w) => !w.tags.includes(LOCAL_KIT_TAG))
              .filter((x) =>
                `${x.name} ${x.description} ${x.tags.join(" ")}`
                  .toLowerCase()
                  .includes(workflowSearch.toLowerCase()),
              )
              .map((x) => (
                <div className="library-item" key={x.id}>
                  <button
                    className="workflow-row"
                    onClick={() => {
                      if (open(x)) setLibrary(false);
                    }}
                  >
                    <FolderOpen size={20} />
                    <div>
                      <strong>{x.name}</strong>
                      <p>
                        {x.nodes.length} steps · {x.version}
                      </p>
                    </div>
                    <span>Open / edit ↗</span>
                  </button>
                  <div className="library-actions">
                    <button
                      disabled={
                        blocked ||
                        dirty ||
                        duplicating ||
                        store.workflows.length >= 100
                      }
                      title={
                        dirty
                          ? "Wait for the current canvas to finish saving"
                          : "Save a separate copy with a new identity"
                      }
                      onClick={async () => {
                        if (copyPending.current || dirty) return;
                        copyPending.current = true;
                        setDuplicating(true);
                        try {
                          const copy = duplicateWorkflow(x);
                          await writeStore((current) => ({
                            ...current,
                            workflows: putWorkflow(current.workflows, copy),
                          }));
                          setMessage(
                            `Saved “${copy.name}” as a separate workflow.`,
                          );
                        } catch (e) {
                          setMessage(
                            `Duplication failed: ${e instanceof Error ? e.message : "Storage unavailable"}`,
                          );
                        } finally {
                          copyPending.current = false;
                          setDuplicating(false);
                        }
                      }}
                    >
                      Duplicate {x.name}
                    </button>
                    <button
                      onClick={() =>
                        download(
                          `${x.name}.fixflow.json`,
                          JSON.stringify(x, null, 2),
                        )
                      }
                    >
                      Export {x.name}
                    </button>
                  </div>
                </div>
              ))}
            {store.workflows.length > 0 &&
              !store.workflows.some((x) =>
                `${x.name} ${x.description} ${x.tags.join(" ")}`
                  .toLowerCase()
                  .includes(workflowSearch.toLowerCase()),
              ) && <p>No workflows match this name. Try another search.</p>}
            {!store.workflows.length && (
              <p>
                No workflows saved yet. Save the current canvas or start from a
                template.
              </p>
            )}
            <button
              onClick={() => {
                setLibrary(false);
                setPage("Templates");
              }}
            >
              Browse starter templates
            </button>
          </section>
        </div>
      )}
      {metadata && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Workflow metadata"
          >
            <h2>Workflow details</h2>
            <label>
              Name
              <input
                value={w.name}
                maxLength={120}
                onChange={(e) => commit({ ...w, name: e.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                value={w.description}
                onChange={(e) => commit({ ...w, description: e.target.value })}
              />
            </label>
            <label>
              Author
              <input
                value={w.author}
                onChange={(e) => commit({ ...w, author: e.target.value })}
              />
            </label>
            <button className="primary" onClick={() => setMetadata(false)}>
              Done
            </button>
          </section>
        </div>
      )}
      {report && (
        <div className="modal-backdrop">
          <section
            className="modal report-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Diagnostic report"
          >
            <div className="report-heading">
              <div>
                <small>
                  {report.demo ? "SIMULATED DEMO REPORT" : "DIAGNOSTIC REPORT"}
                </small>
                <h2>{report.workflow}</h2>
                <p>
                  {new Date(report.date).toLocaleString()} · v{report.version}
                </p>
              </div>
              <button
                aria-label="Close report"
                onClick={() => {
                  setReport(undefined);
                  setPreview(false);
                }}
              >
                <X size={18} />
              </button>
            </div>
            {store.cases?.some((c) => c.id === caseView.id) && (
              <button
                onClick={() => {
                  setReport(undefined);
                  setPreview(false);
                  setPage("Dashboard");
                  setCaseView((v) => ({ ...v, pane: "evidence" }));
                }}
              >
                Return to selected case
                {store.cases
                  ?.find((c) => c.id === caseView.id)
                  ?.runIds.includes(report.id)
                  ? " · report linked"
                  : " · report not linked"}
              </button>
            )}
            {runSaveStatus?.id === report.id && (
              <p className="run-save-status" role="status">
                {runSaveStatus.text}
              </p>
            )}
            {preview && (
              <div className="export-preview">
                <h3>Export preview</h3>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={sensitive}
                    onChange={(e) => setSensitive(e.target.checked)}
                  />
                  Include identifying details after review
                </label>
                <p>
                  {sensitive
                    ? "Step labels and evidence may reveal IP addresses, hostnames, and adapter names. Review the exact payload below."
                    : "Workflow name, step labels, answers, and evidence are withheld. Statuses and durations remain."}
                </p>
                <pre>
                  {JSON.stringify(
                    sensitive ? report : redactedReport(report),
                    null,
                    2,
                  )}
                </pre>
                <div className="modal-actions">
                  <button
                    onClick={() =>
                      download(
                        "rootlith-report.json",
                        JSON.stringify(
                          sensitive ? report : redactedReport(report),
                          null,
                          2,
                        ),
                      )
                    }
                  >
                    <FileJson size={15} /> Export JSON
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "rootlith-report.html",
                        reportHTML(sensitive ? report : redactedReport(report)),
                        "text/html",
                      )
                    }
                  >
                    <FileText size={15} /> Export HTML
                  </button>
                </div>
              </div>
            )}
            {!preview && (
              <>
                <EvidenceTimeline steps={report.steps} demo={report.demo} />
                <div className="explanation">
                  <strong>Interpretation & next steps</strong>
                  <p>
                    Review failed and inconclusive checks with your support
                    technician. Verify the target and service configuration
                    before changing settings.
                  </p>
                  {report.limitations.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </div>
                <div className="modal-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      setPreview(true);
                      setSensitive(false);
                    }}
                  >
                    <Download size={15} /> Preview export
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {closing &&
        createPortal(
          <div className="closing-screen" role="status">
            Finalizing saved workspace before closing…
          </div>,
          document.body,
        )}
    </div>
  );
}
