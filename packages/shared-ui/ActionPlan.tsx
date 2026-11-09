import { useRef, useState } from "react";
import {
  caseTimeline,
  newTask,
  updateActionPlan,
  type TaskChange,
} from "../core/action-plan";
import {
  localDate,
  type ActionTask,
  type InvestigationCase,
} from "../core/cases";
import type { Store } from "../core/storage";
import { useDialog } from "./useDialog";
function TaskEditor({
  task,
  save,
  close,
}: {
  task?: ActionTask;
  save: (task: ActionTask) => Promise<void>;
  close: () => void;
}) {
  const [title, setTitle] = useState(task?.title || ""),
    [comment, setComment] = useState(task?.comment || ""),
    [author, setAuthor] = useState(task?.recordedBy || "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  const ref = useDialog(close, busy);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className="modal task-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-title"
        data-case-dialog="true"
        data-unsaved={
          title !== (task?.title || "") ||
          comment !== (task?.comment || "") ||
          author !== (task?.recordedBy || "")
        }
        data-saving={busy}
      >
        <h2 id="task-title">{task ? "Edit action" : "Add action"}</h2>
        <p>
          Human-authored checklist only. No task executes diagnostics or becomes
          checked automatically. Do not enter credentials.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError("");
            try {
              await save(
                task
                  ? { ...task, title, comment, recordedBy: author }
                  : newTask(title, comment, author),
              );
              close();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
              lock.current = false;
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Action title
              <input
                required
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              Comment (optional)
              <textarea
                maxLength={500}
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <label>
              Recorded by (self-reported, optional)
              <input
                maxLength={80}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </label>
          </fieldset>
          <p role="status">
            {busy
              ? "Waiting for action save acknowledgment…"
              : "Unsaved action draft. Save explicitly to keep it."}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || !title.trim()}
            >
              Save action
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
export function ActionPlan({
  value,
  store,
  disabled,
  save,
  timelineOnly = false,
}: {
  timelineOnly?: boolean;
  value: InvestigationCase;
  store: Store;
  disabled: boolean;
  save: (reduce: (s: Store) => Store) => Promise<void>;
}) {
  const tasks = value.actionPlan || [];
  const checked = tasks.filter((t) => t.done).length;
  const [editor, setEditor] = useState<{ task?: ActionTask }>(),
    [remove, setRemove] = useState<ActionTask>();
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const readOnly = disabled || value.archived;
  async function write(change: TaskChange) {
    if (readOnly)
      throw Error("Reopen this case or recover storage before changing tasks.");
    setBusy(true);
    setStatus("Waiting for action plan save acknowledgment…");
    try {
      await save((s) => updateActionPlan(s, value.id, value.created, change));
      setStatus(
        window.fixflow
          ? "Action plan saved after native acknowledgment."
          : "Browser simulation: action plan saved locally.",
      );
    } catch (e) {
      setStatus(`Save not acknowledged: ${(e as Error).message}`);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const timeline = caseTimeline(value, store);
  return (
    <>
      {!timelineOnly && (
        <section className="action-plan" aria-label="Case action plan">
          <div className="action-heading">
            <h4>
              Action plan · {checked}/{tasks.length} checked
            </h4>
            <button
              disabled={readOnly || busy || tasks.length >= 30}
              onClick={() => setEditor({})}
            >
              Add action
            </button>
          </div>
          <p>
            Next pending:{" "}
            {tasks.find((t) => !t.done)?.title || "No pending item recorded"}
          </p>
          <p className="muted">
            Manual checkmarks are technician claims, never proof that
            diagnostics ran. Maximum 30 actions.{" "}
            {value.archived
              ? "Archived plan is read-only until the case is reopened."
              : "Changes wait for save acknowledgment."}
          </p>
          {!tasks.length && (
            <p>
              No structured actions yet. Existing technician notes are
              preserved.
            </p>
          )}
          <ol className="action-list">
            {tasks.map((task, index) => (
              <li key={task.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={readOnly || busy}
                    aria-label={`Check action: ${task.title}`}
                    onChange={() =>
                      void write({ kind: "toggle", id: task.id }).catch(
                        () => {},
                      )
                    }
                  />
                  <strong>{task.title}</strong>
                </label>
                {task.suggested && (
                  <small>
                    Suggested human action · guidance, not executed evidence
                  </small>
                )}
                {task.comment && <p>{task.comment}</p>}
                <small>
                  Created {localDate(task.created)} · Last recorded update{" "}
                  {localDate(task.updated)} · Author (self-reported):{" "}
                  {task.recordedBy || "Not recorded"}
                </small>
                <div className="workbench-actions">
                  <button
                    disabled={readOnly || busy}
                    onClick={() => setEditor({ task: structuredClone(task) })}
                    aria-label={`Edit action: ${task.title}`}
                  >
                    Edit
                  </button>
                  <button
                    disabled={readOnly || busy || index === 0}
                    onClick={() =>
                      void write({
                        kind: "move",
                        id: task.id,
                        direction: -1,
                      }).catch(() => {})
                    }
                    aria-label={`Move up: ${task.title}`}
                  >
                    Move up
                  </button>
                  <button
                    disabled={readOnly || busy || index === tasks.length - 1}
                    onClick={() =>
                      void write({
                        kind: "move",
                        id: task.id,
                        direction: 1,
                      }).catch(() => {})
                    }
                    aria-label={`Move down: ${task.title}`}
                  >
                    Move down
                  </button>
                  <button
                    disabled={readOnly || busy}
                    onClick={() => setRemove(structuredClone(task))}
                    aria-label={`Remove action: ${task.title}`}
                  >
                    Remove
                  </button>
                </div>
                {remove?.id === task.id && (
                  <div className="task-confirm" role="alert">
                    <p>
                      Remove this action and its recorded details? Export a
                      handover first if you need a copy.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => setRemove(undefined)}
                    >
                      Keep action
                    </button>
                    <button
                      disabled={busy || readOnly}
                      onClick={() =>
                        void write({ kind: "remove", before: remove })
                          .then(() => setRemove(undefined))
                          .catch(() => {})
                      }
                    >
                      Confirm remove action
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p role="status">{status}</p>
        </section>
      )}
      {timelineOnly && (
        <details open className="case-timeline">
          <summary>Case timeline · saved timestamps</summary>
          <p>
            This is a view of current records, not a full audit log. Last task
            update does not prove when a task was completed. Removed tasks and
            earlier edits have no retained events.
          </p>
          <ol>
            {timeline.events.map((event, i) => (
              <li key={`${event.reference}:${i}`}>
                <strong>
                  {localDate(event.at)} ·{" "}
                  {event.kind === "execution"
                    ? `Recorded execution · ${event.mode}`
                    : event.kind === "authored"
                      ? "Authored checklist record"
                      : "Case metadata"}
                </strong>
                <p>{event.label}</p>
                {event.recordedBy && (
                  <small>Self-reported author: {event.recordedBy}</small>
                )}
              </li>
            ))}
          </ol>
          {timeline.missingRuns.map((id) => (
            <p key={id}>
              Missing report · {id}. Timestamp, mode and result are unavailable;
              no event is inferred.
            </p>
          ))}
        </details>
      )}
      {editor && (
        <TaskEditor
          task={editor.task}
          close={() => setEditor(undefined)}
          save={(task) =>
            write(
              editor.task
                ? { kind: "edit", before: editor.task, task }
                : { kind: "add", task },
            )
          }
        />
      )}
    </>
  );
}
