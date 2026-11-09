import { prepareEditor } from "./EditorCanvas";
import {
  lazy,
  Suspense,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { editCaseFields } from "../core/action-plan";
import {
  filterCases,
  localDate,
  putCase,
  type InvestigationCase,
} from "../core/cases";
import type { CasePane } from "../core/case-command";
import type { Store } from "../core/storage";
import type { Workflow } from "../schemas";
import type { Report } from "../workflow-engine";
import type { ExportOutcome } from "../core/export-document";
import type { ExportRequest } from "../core/desktop-client";
import { CaseCommandCenter } from "./CaseCommandCenter";
const InvestigationKits = lazy(() =>
  import("./InvestigationKits").then((m) => ({ default: m.InvestigationKits })),
);
const CaseEditor = lazy(() =>
  import("./CaseEditor").then((m) => ({ default: m.CaseEditor })),
);
const CaseDossierDialog = lazy(() =>
  import("./CaseDossier").then((m) => ({ default: m.CaseDossierDialog })),
);
const EvidenceReview = lazy(() =>
  import("./EvidenceReview").then((m) => ({ default: m.EvidenceReview })),
);
export function CaseWorkbench({
  store,
  disabled,
  save,
  openWorkflow,
  configureWorkflow,
  openCaseWorkflow,
  openReport,
  compare,
  editor,
  starters,
  exportFile,
  selectedCaseId,
  selectCase,
  pane,
  navigate,
}: {
  store: Store;
  disabled: boolean;
  save: (reduce: (s: Store) => Store) => Promise<void>;
  openWorkflow: (w: Workflow, profileId?: string) => void;
  configureWorkflow: (w: Workflow) => void;
  openCaseWorkflow: (caseId: string, w: Workflow) => void;
  openReport: (r: Report) => void;
  compare: (a: string, b: string) => void;
  editor: () => void;
  starters: () => void;
  exportFile: (
    name: string,
    content: string,
    type?: ExportRequest["type"],
  ) => Promise<ExportOutcome>;
  selectedCaseId: string;
  selectCase: (id: string) => void;
  pane: CasePane;
  navigate: (pane: CasePane) => void;
}) {
  const [kitsOpen, setKitsOpen] = useState(false),
    [editing, setEditing] = useState<InvestigationCase>(),
    [review, setReview] = useState(false),
    [dossier, setDossier] = useState<{
      value: InvestigationCase;
      store: Store;
      handover: boolean;
    }>();
  const [query, setQuery] = useState(""),
    [state, setState] = useState("active"),
    [order, setOrder] = useState("newest"),
    [limit, setLimit] = useState(30),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const list = useRef<HTMLElement>(null);
  const deferredQuery = useDeferredValue(query);
  const cases = store.cases || [];
  const visible = useMemo(
    () => filterCases(cases, store, deferredQuery, state, order),
    [cases, store.workflows, store.targetProfiles, deferredQuery, state, order],
  );
  const current = cases.find((c) => c.id === selectedCaseId);
  const recent = useMemo(
    () =>
      [...cases]
        .filter((c) => !c.archived)
        .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))[0],
    [cases],
  );
  function select(id: string) {
    selectCase(id);
    setError("");
    requestAnimationFrame(() =>
      document.getElementById("selected-case-heading")?.focus(),
    );
  }
  async function archive() {
    if (!current || disabled || busy) return;
    setBusy(true);
    setError("");
    try {
      await save((s) => {
        const c = s.cases?.find(
          (c) => c.id === current.id && c.created === current.created,
        );
        if (!c) throw Error("Case changed or removed; reopen it.");
        return {
          ...s,
          cases: putCase(s.cases || [], {
            ...c,
            archived: !c.archived,
            updated: new Date().toISOString(),
          }),
        };
      });
      setNotice("Case status saved after workspace acknowledgment.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="case-workbench">
      <div className="workbench-intro">
        <div>
          <small className="mint">LOCAL TECHNICIAN WORKSPACE</small>
          <h2>Case Command Center</h2>
          <p>
            Plan, configure, collect evidence and hand over — one investigation
            at a time.
          </p>
        </div>
        <div className="workbench-actions">
          <button
            className="primary"
            disabled={disabled}
            onClick={() => {
              const now = new Date().toISOString();
              setEditing({
                id: crypto.randomUUID(),
                name: "",
                note: "",
                workflowIds: [],
                runIds: [],
                archived: false,
                created: now,
                updated: now,
              });
            }}
          >
            New investigation
          </button>
          <button disabled={disabled} onClick={() => setKitsOpen(true)}>
            New from Kit
          </button>
          <button
            disabled={!recent}
            onClick={() => {
              if (recent) {
                setQuery("");
                setState("active");
                select(recent.id);
              }
            }}
          >
            Resume case
          </button>
          <button
            onClick={editor}
            onPointerEnter={prepareEditor}
            onFocus={prepareEditor}
          >
            Open editor
          </button>
          <button onClick={starters}>Starter playbooks</button>
        </div>
      </div>
      <div className="workspace-overview" aria-label="Workspace summary">
        <button
          onClick={() => {
            setState("active");
            setQuery("");
          }}
        >
          <span>Investigation queue</span>
          <strong>
            {cases.filter((c) => !c.archived).length}
            <small>active cases</small>
          </strong>
        </button>
        <button onClick={editor}>
          <span>Playbook library</span>
          <strong>
            {store.workflows.length}
            <small>saved workflows & kits</small>
          </strong>
        </button>
        <button
          onClick={() => {
            if (current) navigate("evidence");
          }}
          disabled={!current}
        >
          <span>Evidence archive</span>
          <strong>
            {store.reports.length}
            <small>recorded reports</small>
          </strong>
        </button>
        <div className="workspace-principle">
          <span className="local-signal" />
          <div>
            <strong>Private workspace</strong>
            <small>On this device · deliberate execution</small>
          </div>
        </div>
      </div>
      <p className="simulation-context">
        {window.fixflow
          ? "Desktop · native exact-target approval required before every run."
          : "BROWSER SIMULATION · all diagnostic checks are simulated; no native Windows acceptance."}{" "}
        Cases and manual checkmarks never execute checks automatically.
      </p>
      <div className="case-columns">
        <section
          ref={list}
          aria-label="Investigation cases"
          className="case-list"
        >
          <div className="case-list-heading">
            <h3>Cases · {cases.length}/80</h3>
          </div>
          <div className="case-filters">
            <label>
              Search cases
              <input
                type="search"
                value={query}
                placeholder="Case, note, action, profile or playbook"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(30);
                }}
              />
            </label>
            <div className="case-filter-row">
              <label>
                Case status
                <select
                  aria-label="Case status"
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setLimit(30);
                  }}
                >
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                  <option value="all">All cases</option>
                </select>
              </label>
              <label>
                Order cases
                <select
                  aria-label="Order cases"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                >
                  <option value="newest">Last updated first</option>
                  <option value="oldest">Oldest update first</option>
                </select>
              </label>
            </div>
          </div>
          <p className="muted" role="status">
            {visible.length} matching cases. Arrow keys browse; Enter opens. Tab
            enters the command center.
          </p>
          <div
            className="case-card-list"
            aria-busy={query !== deferredQuery}
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
                return;
              const buttons = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                ],
                i = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
              if (i < 0) return;
              e.preventDefault();
              buttons[
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          buttons.length - 1,
                          i + (e.key === "ArrowDown" ? 1 : -1),
                        ),
                      )
              ]?.focus();
            }}
          >
            {visible.slice(0, limit).map((c) => (
              <button
                className={`case-card ${selectedCaseId === c.id ? "selected" : ""}`}
                key={c.id}
                aria-pressed={selectedCaseId === c.id}
                onClick={() => select(c.id)}
              >
                <strong>{c.name}</strong>
                <span>
                  {c.archived ? "Archived" : "Active"} · {c.runIds.length}{" "}
                  evidence links ·{" "}
                  {(c.actionPlan || []).filter((t) => t.done).length}/
                  {c.actionPlan?.length || 0} manual actions
                </span>
                <small>Updated {localDate(c.updated)}</small>
              </button>
            ))}
          </div>
          {visible.length > limit && (
            <button onClick={() => setLimit((n) => n + 30)}>
              Show more cases ({visible.length - limit})
            </button>
          )}
          {!visible.length && (
            <div className="case-empty">
              <p>
                {cases.length
                  ? "No cases match these filters."
                  : "No investigations yet. Inspect a kit or create a case to begin."}
              </p>
              {!!cases.length && (
                <button
                  onClick={() => {
                    setQuery("");
                    setState("all");
                  }}
                >
                  Show all cases
                </button>
              )}
            </div>
          )}
        </section>
        <section aria-label="Case overview" className="case-detail">
          {!current ? (
            <div className="case-empty">
              <h3>
                {selectedCaseId
                  ? "Selected case is unavailable"
                  : "Choose an investigation"}
              </h3>
              <p>
                {selectedCaseId
                  ? "It was removed or is absent from this workspace. No replacement context was inferred."
                  : "Inspect a kit or select a saved case. All execution remains deliberate and scoped."}
              </p>
            </div>
          ) : (
            <>
              {!visible.some((c) => c.id === current.id) && (
                <p className="muted">
                  Selected case is outside these filters.{" "}
                  <button
                    onClick={() => {
                      setQuery(current.name);
                      setState("all");
                    }}
                  >
                    Reveal selected case
                  </button>
                </p>
              )}
              <CaseCommandCenter
                key={`${current.id}:${current.created}`}
                value={current}
                store={store}
                disabled={disabled || busy}
                save={save}
                pane={pane}
                navigate={navigate}
                edit={() => setEditing(structuredClone(current))}
                archive={() => void archive()}
                dossier={(handover) =>
                  setDossier({
                    value: structuredClone(current),
                    store: structuredClone(store),
                    handover,
                  })
                }
                reviewEvidence={() => setReview(true)}
                configure={configureWorkflow}
                run={(w) => openCaseWorkflow(current.id, w)}
                open={openWorkflow}
                report={openReport}
                compare={compare}
                back={() =>
                  list.current
                    ?.querySelector<HTMLInputElement>('input[type="search"]')
                    ?.focus()
                }
              />
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <p role="status">
            {busy ? "Waiting for workspace save acknowledgment…" : notice}
          </p>
        </section>
      </div>
      <details className="saved-playbooks-disclosure">
        <summary>Saved workflows stay available in Open editor → Open</summary>
        <p>
          Local kits count toward the 100-workflow capacity. Open a saved
          playbook for editing or create an independent case from a reviewed
          kit.
        </p>
      </details>
      <Suspense fallback={<p role="status">Opening investigation tools…</p>}>
        {kitsOpen && (
          <InvestigationKits
            store={store}
            save={save}
            close={() => setKitsOpen(false)}
            created={(value) => {
              setKitsOpen(false);
              setQuery("");
              setState("active");
              select(value.id);
              navigate("playbooks");
              setNotice(
                "Case and independent playbook saved. Targets are blank: choose Run for this case or Configure targets, review explicit setup, then approve the run.",
              );
            }}
          />
        )}
        {editing && (
          <CaseEditor
            key={editing.id}
            value={editing}
            store={store}
            close={() => setEditing(undefined)}
            save={async (value) => {
              if (disabled)
                throw Error("Workspace is read-only; recover before saving.");
              await save((s) => {
                if (s.cases?.find((c) => c.id === editing.id)?.archived)
                  throw Error("Case is archived. Reopen before editing.");
                return editCaseFields(s, editing, value);
              });
              select(value.id);
              setNotice("Investigation saved after workspace acknowledgment.");
            }}
          />
        )}
        {dossier && (
          <CaseDossierDialog
            value={dossier.value}
            store={dossier.store}
            handover={dossier.handover}
            exportFile={exportFile}
            close={() => setDossier(undefined)}
          />
        )}
        {review && current && (
          <EvidenceReview
            key={`${current.id}:${current.created}`}
            value={current}
            store={store}
            save={save}
            close={() => setReview(false)}
            attached={() => {
              setReview(false);
              navigate("evidence");
              setNotice(
                "Reviewed report linked after workspace acknowledgment. Origin and recorded mode unchanged.",
              );
            }}
          />
        )}
      </Suspense>
    </section>
  );
}
