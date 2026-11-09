import { lazy, Suspense, useMemo } from "react";
const ActionPlan = lazy(() =>
  import("./ActionPlan").then((m) => ({ default: m.ActionPlan })),
);
import { LOCAL_KIT_TAG } from "../core/local-kits";
import { CaseEvidence } from "./CaseEvidence";
import { commandOverview, type CasePane } from "../core/case-command";
import { localDate, type InvestigationCase } from "../core/cases";
import type { Store } from "../core/storage";
import type { Workflow } from "../schemas";
import type { Report } from "../workflow-engine";
const panes: [CasePane, string][] = [
  ["overview", "Overview"],
  ["playbooks", "Playbooks"],
  ["evidence", "Evidence"],
  ["actions", "Action plan"],
  ["timeline", "Notes & timeline"],
];
export function CaseCommandCenter({
  value,
  store,
  disabled,
  save,
  pane,
  navigate,
  edit,
  archive,
  dossier,
  reviewEvidence,
  configure,
  run,
  open,
  report,
  compare,
  back,
}: {
  value: InvestigationCase;
  store: Store;
  disabled: boolean;
  save: (reduce: (s: Store) => Store) => Promise<void>;
  pane: CasePane;
  navigate: (p: CasePane) => void;
  edit: () => void;
  archive: () => void;
  dossier: (handover: boolean) => void;
  reviewEvidence: () => void;
  configure: (w: Workflow) => void;
  run: (w: Workflow) => void;
  open: (w: Workflow, profileId?: string) => void;
  report: (r: Report) => void;
  compare: (a: string, b: string) => void;
  back: () => void;
}) {
  const model = useMemo(() => commandOverview(value, store), [value, store]);
  const profile = store.targetProfiles?.find((p) => p.id === value.profileId);
  const nextPane: CasePane =
    model.missingWorkflows.length || !value.workflowIds.length
      ? "playbooks"
      : model.evidence.missing
        ? "evidence"
        : !model.evidence.available
          ? "playbooks"
          : model.next
            ? "actions"
            : "evidence";
  const next = () => navigate(nextPane);
  return (
    <section className="command-center" aria-label="Case Command Center">
      <div className="case-detail-heading">
        <div>
          <small>
            {value.archived ? "ARCHIVED CASE" : "ACTIVE INVESTIGATION"} ·{" "}
            {model.status}
          </small>
          <h3 tabIndex={-1} id="selected-case-heading">
            {value.name}
          </h3>
          <p className="muted">
            Saved case record · updated {localDate(value.updated)}
          </p>
        </div>
        <div className="workbench-actions">
          <button onClick={back}>Back to case list</button>
          <button onClick={() => dossier(true)}>Handover Summary</button>
          <button onClick={() => dossier(false)}>Export case dossier</button>
          <button disabled={disabled} onClick={edit}>
            Edit case
          </button>
          <button disabled={disabled} onClick={archive}>
            {value.archived ? "Reopen case" : "Archive case"}
          </button>
        </div>
      </div>
      <div
        className="command-tabs"
        role="tablist"
        aria-label="Case sections"
        onKeyDown={(e) => {
          if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key))
            return;
          const tabs = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]',
              ),
            ],
            i = tabs.indexOf(document.activeElement as HTMLButtonElement);
          if (i < 0) return;
          e.preventDefault();
          const n =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? tabs.length - 1
                : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length;
          navigate(panes[n][0]);
          tabs[n].focus();
        }}
      >
        {panes.map(([id, title]) => (
          <button
            key={id}
            role="tab"
            id={`case-tab-${id}`}
            aria-selected={pane === id}
            aria-controls="case-command-panel"
            tabIndex={pane === id ? 0 : -1}
            onClick={() => navigate(id)}
          >
            {title}
            {id === "evidence"
              ? ` (${model.evidence.available})`
              : id === "actions"
                ? ` (${model.checked}/${model.tasks})`
                : ""}
          </button>
        ))}
      </div>
      <section
        id="case-command-panel"
        role="tabpanel"
        aria-labelledby={`case-tab-${pane}`}
        tabIndex={0}
      >
        {pane === "overview" && (
          <>
            <div className="command-metrics">
              <button onClick={() => navigate("playbooks")}>
                <strong>
                  {value.workflowIds.length - model.missingWorkflows.length}/
                  {value.workflowIds.length}
                </strong>
                <span>available playbooks</span>
              </button>
              <button onClick={() => navigate("evidence")}>
                <strong>{model.evidence.available}</strong>
                <span>saved reports · {model.evidence.missing} missing</span>
              </button>
              <button onClick={() => navigate("actions")}>
                <strong>
                  {model.checked}/{model.tasks}
                </strong>
                <span>manually checked actions</span>
              </button>
            </div>
            <section className="command-next" aria-label="Next deliberate step">
              <small>NEXT DELIBERATE STEP · HUMAN GUIDANCE</small>
              <h4>{model.nextStep}</h4>
              <div className="workbench-actions">
                {value.archived ? (
                  <button disabled={disabled} onClick={archive}>
                    Reopen case
                  </button>
                ) : (
                  <button className="primary" onClick={next}>
                    {nextPane === "playbooks"
                      ? "Review / configure playbooks"
                      : nextPane === "actions"
                        ? "Open next pending action"
                        : model.evidence.missing
                          ? "Review missing evidence"
                          : "Review saved evidence"}
                  </button>
                )}
                <button onClick={reviewEvidence}>
                  Review / Attach evidence
                </button>
              </div>
              <p>
                No action executes a diagnostic automatically. Manual completion
                is not proof of execution or resolution.
              </p>
            </section>
            <section
              className="case-evidence"
              aria-label="Recorded case evidence"
            >
              <h4>Last recorded run</h4>
              {model.evidence.latest ? (
                <>
                  <strong>
                    {model.evidence.latest.workflow} ·{" "}
                    {model.evidence.latest.demo
                      ? "SIMULATED"
                      : "NATIVE as recorded"}
                  </strong>
                  <p>
                    {localDate(model.evidence.latest.date)}
                    {model.evidence.latest.steps.some(
                      (s) => s.status === "cancelled",
                    )
                      ? " · contains cancelled steps"
                      : ""}
                  </p>
                  <button onClick={() => report(model.evidence.latest!)}>
                    Review latest report
                  </button>
                </>
              ) : (
                <p>
                  No dated saved execution is linked. This does not establish
                  device health.
                </p>
              )}
              <p>
                {model.evidence.failed} failed · {model.evidence.inconclusive}{" "}
                inconclusive diagnostic records across all available linked
                reports. These counts are historical observations, not a current
                root cause.
              </p>
            </section>
            <section className="command-context">
              <h4>Target-profile context</h4>
              <p>
                {profile
                  ? `${profile.name} · ${profile.host || "No host"} · TCP ${profile.port || "not set"} · ${profile.url || "No HTTP base"}`
                  : value.profileId
                    ? "Linked profile is unavailable"
                    : "No contextual profile linked"}
              </p>
              <p className="muted">
                A profile is not evidence of targets tested. Targets are applied
                only through the explicit Quick Target preview; native
                exact-scope approval remains mandatory.
              </p>
            </section>
            {(model.missingWorkflows.length > 0 ||
              model.missingProfile ||
              model.evidence.missing > 0) && (
              <div className="command-warning" role="status">
                <strong>Unavailable references need review</strong>
                <p>
                  {model.missingWorkflows.length} playbook references ·{" "}
                  {model.evidence.missing} report references ·{" "}
                  {model.missingProfile ? 1 : 0} profile references unavailable.
                  Nothing is silently restored or relinked.
                </p>
                <button onClick={() => navigate("evidence")}>
                  Review missing evidence
                </button>
                <button disabled={disabled} onClick={edit}>
                  Edit case links
                </button>
              </div>
            )}
          </>
        )}
        {pane === "playbooks" && (
          <>
            <h4>Linked playbooks · explicit setup and approval</h4>
            <p>
              Configure opens a preview; Run for this case binds only the next
              deliberately approved execution. It never starts a check here.
              Opening an ordinary playbook clears run context.
            </p>
            {value.runIds.length >= 50 && (
              <p role="alert">
                Case has 50 references, including missing history. Unlink old
                references explicitly in Evidence before another case-bound run.
              </p>
            )}
            {value.workflowIds.map((id) => {
              const w = store.workflows.find((w) => w.id === id);
              return (
                <article className="case-link" key={id}>
                  {w ? (
                    <>
                      <strong>{w.name}</strong>
                      <p>{w.description}</p>
                      <div className="workbench-actions">
                        <button
                          className="primary"
                          disabled={
                            disabled ||
                            value.archived ||
                            value.runIds.length >= 50 ||
                            w.tags.includes(LOCAL_KIT_TAG)
                          }
                          onClick={() => run(w)}
                        >
                          Run for this case
                        </button>
                        <button onClick={() => configure(w)}>
                          Configure targets
                        </button>
                        <button onClick={() => open(w)}>Open playbook</button>
                        {profile && (
                          <button onClick={() => open(w, profile.id)}>
                            Preview case target
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="missing-reference">
                      Missing workflow · {id}. Link the intended saved playbook
                      explicitly; no replacement was inferred.
                    </p>
                  )}
                </article>
              );
            })}
            {!value.workflowIds.length && (
              <p>
                No playbooks linked. Edit case to attach a saved workflow or
                create a fresh investigation from a kit.
              </p>
            )}
            <button disabled={disabled} onClick={edit}>
              Edit playbook links
            </button>
          </>
        )}
        {pane === "evidence" && (
          <CaseEvidence
            key={value.id}
            value={value}
            store={store}
            disabled={disabled}
            save={save}
            openReport={report}
            compare={compare}
            review={reviewEvidence}
          />
        )}
        {(pane === "actions" || pane === "timeline") && (
          <>
            {pane === "timeline" && (
              <>
                <h4>Technician notes</h4>
                <p className="case-note">{value.note || "No note recorded."}</p>
                <button disabled={disabled} onClick={edit}>
                  Edit notes and links
                </button>
              </>
            )}
            <Suspense
              fallback={<p role="status">Opening saved action plan…</p>}
            >
              <ActionPlan
                key={value.id}
                value={value}
                store={store}
                disabled={disabled}
                save={save}
                timelineOnly={pane === "timeline"}
              />
            </Suspense>
          </>
        )}
      </section>
    </section>
  );
}
