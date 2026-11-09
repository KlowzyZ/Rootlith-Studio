import { useMemo, useState } from "react";
import { comparisonScope } from "../core/comparison";
import { unlinkCaseEvidence } from "../core/case-command";
import { localDate, type InvestigationCase } from "../core/cases";
import { filterHistory } from "../core/history";
import type { Store } from "../core/storage";
import type { Report } from "../workflow-engine";
export function CaseEvidence({
  value,
  store,
  disabled,
  save,
  openReport,
  compare,
  review,
}: {
  value: InvestigationCase;
  store: Store;
  disabled: boolean;
  save: (reduce: (s: Store) => Store) => Promise<void>;
  openReport: (r: Report) => void;
  compare: (a: string, b: string) => void;
  review: () => void;
}) {
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState("all"),
    [pair, setPair] = useState<string[]>([]),
    [remove, setRemove] = useState<string>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [limit, setLimit] = useState(10);
  const available = useMemo(
    () => store.reports.filter((r) => value.runIds.includes(r.id)),
    [store.reports, value.runIds],
  );
  const visible = useMemo(
    () =>
      filterHistory(available, [], {
        search: query,
        mode,
        status: "all",
        order: "newest",
        favoritesOnly: false,
      }),
    [available, query, mode],
  );
  const missing = value.runIds.filter(
    (id) => !available.some((r) => r.id === id),
  );
  const a = available.find((r) => r.id === pair[0]),
    b = available.find((r) => r.id === pair[1]);
  const scope = a && b && comparisonScope(a, b, store.runWorkflows),
    canCompare = scope === "verified" || scope === "legacy";
  return (
    <section aria-label="Case evidence manager">
      <div className="action-heading">
        <h4>
          Saved case evidence · {available.length} available /{" "}
          {value.runIds.length} references
        </h4>
        <button onClick={review}>Review / Attach evidence</button>
      </div>
      <p>
        Reports are referenced, not copied. Native/simulated modes and recorded
        targets remain distinct; missing history is never recreated. Baseline is
        your first selected report.
      </p>
      <div className="evidence-filters">
        <label>
          Search linked evidence
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(10);
            }}
          />
        </label>
        <label>
          Linked evidence mode
          <select
            aria-label="Linked evidence mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setLimit(10);
            }}
          >
            <option value="all">All modes</option>
            <option value="simulated">SIMULATED</option>
            <option value="native">NATIVE</option>
          </select>
        </label>
      </div>
      <div className="comparison-picker">
        <p>
          {a
            ? `Baseline: ${a.workflow} · ${localDate(a.date)}`
            : "No available baseline selected"}
          {b ? ` → Follow-up: ${b.workflow} · ${localDate(b.date)}` : ""}
        </p>
        {scope && !canCompare && <p>{scope}</p>}
        <button
          disabled={!canCompare}
          onClick={() => {
            if (a && b) compare(a.id, b.id);
          }}
        >
          Compare case runs
        </button>
        <button disabled={!pair.length} onClick={() => setPair([])}>
          Clear comparison selection
        </button>
      </div>
      {visible.slice(0, limit).map((r) => (
        <article className="case-link evidence-row" key={r.id}>
          <div>
            <strong>{r.workflow}</strong>
            <p>
              {r.demo ? "SIMULATED" : "NATIVE as recorded"} ·{" "}
              {localDate(r.date)} ·{" "}
              {r.steps.filter((s) => s.status === "failed").length} failed ·{" "}
              {r.steps.filter((s) => s.status === "inconclusive").length}{" "}
              inconclusive
            </p>
            <small>
              {r.id}
              {r.steps.some((s) => s.status === "cancelled")
                ? " · contains cancelled steps"
                : ""}
            </small>
          </div>
          <div className="workbench-actions">
            <button onClick={() => openReport(r)}>
              Review / export report
            </button>
            <button
              aria-pressed={pair.includes(r.id)}
              onClick={() =>
                setPair((p) =>
                  p.includes(r.id)
                    ? p.filter((id) => id !== r.id)
                    : p.length >= 2
                      ? [p[0], r.id]
                      : [...p, r.id],
                )
              }
            >
              {pair[0] === r.id
                ? "Baseline selected"
                : pair[1] === r.id
                  ? "Follow-up selected"
                  : "Select for comparison"}
            </button>
            <button
              disabled={disabled || busy || value.archived}
              aria-label={`Unlink report ${r.id}`}
              onClick={() => setRemove(r.id)}
            >
              Unlink from case
            </button>
          </div>
        </article>
      ))}
      {!visible.length && (
        <p>
          No linked reports match. Review saved evidence to attach an existing
          report, or configure and run a linked playbook deliberately.
        </p>
      )}
      {visible.length > limit && (
        <button onClick={() => setLimit((n) => n + 10)}>
          Show more linked reports ({visible.length - limit})
        </button>
      )}
      {!!missing.length && (
        <details open>
          <summary>Unavailable references · {missing.length}</summary>
          {missing.map((id) => (
            <div className="case-link missing-reference" key={id}>
              <p>
                Missing run · {id}. History was cleared/evicted or the report is
                no longer saved. Mode, targets and results are unavailable.
              </p>
              <button
                disabled={disabled || busy || value.archived}
                aria-label={`Unlink missing report ${id}`}
                onClick={() => setRemove(id)}
              >
                Unlink missing reference
              </button>
            </div>
          ))}
        </details>
      )}
      {remove && (
        <div className="task-confirm" role="alert">
          <p>
            Unlink {remove} from this case only? Saved history and other cases
            remain unchanged. Missing evidence is not restored. Save a handover
            first if you need this reference.
          </p>
          <button disabled={busy} onClick={() => setRemove(undefined)}>
            Keep evidence link
          </button>
          <button
            disabled={disabled || busy || value.archived}
            onClick={async () => {
              setBusy(true);
              setNotice("");
              try {
                await save((s) =>
                  unlinkCaseEvidence(s, value.id, value.created, remove),
                );
                setRemove(undefined);
                setPair((p) => p.filter((id) => id !== remove));
                setNotice(
                  "Case link removed after save acknowledgment. Saved history was not deleted.",
                );
              } catch (e) {
                setNotice((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm unlink evidence
          </button>
        </div>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
