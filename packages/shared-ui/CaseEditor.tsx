import { LOCAL_KIT_TAG } from "../core/local-kits";
import { useState } from "react";
import { useDialog } from "./useDialog";
import type { InvestigationCase } from "../core/cases";
import type { Store } from "../core/storage";
export function CaseEditor({
  value,
  store,
  save,
  close,
}: {
  value: InvestigationCase;
  store: Store;
  save: (value: InvestigationCase) => Promise<void>;
  close: () => void;
}) {
  const [draft, setDraft] = useState(value),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const ref = useDialog(close, busy);
  const toggle = (key: "workflowIds" | "runIds", id: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(id)
        ? d[key].filter((x) => x !== id)
        : [...d[key], id],
    }));
  const profile = store.targetProfiles?.find((p) => p.id === draft.profileId);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        data-case-dialog="true"
        data-unsaved={JSON.stringify(draft) !== JSON.stringify(value)}
        data-saving={busy}
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-editor-title"
        className="modal case-editor"
      >
        <h2 id="case-editor-title">
          {store.cases?.some((c) => c.id === value.id)
            ? "Edit investigation"
            : "New investigation"}
        </h2>
        <p>
          Local notes and references only. Saving a case never runs diagnostics
          or changes targets. Do not enter credentials.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (
              draft.profileId &&
              draft.profileId !== value.profileId &&
              !reviewed
            ) {
              setError("Review the selected target profile before saving.");
              return;
            }
            setBusy(true);
            try {
              await save({ ...draft, updated: new Date().toISOString() });
              close();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <p role="status">
            {busy
              ? "Waiting for investigation save acknowledgment…"
              : JSON.stringify(draft) !== JSON.stringify(value)
                ? "Unsaved case changes. Save investigation to keep these edits."
                : store.cases?.some((c) => c.id === value.id)
                  ? "Showing saved case details."
                  : "New case has not been saved."}
          </p>
          {value.archived && (
            <p role="status">
              Archived case: view only. Reopen before editing.
            </p>
          )}
          <fieldset disabled={busy || value.archived}>
            <label>
              Case name
              <input
                required
                maxLength={100}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Technician note (optional)
              <textarea
                maxLength={4000}
                rows={4}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="Observed symptoms, checks performed, next action. No passwords or keys."
              />
            </label>
            <label>
              Saved target profile (optional)
              <select
                aria-label="Case target profile"
                value={draft.profileId || ""}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    profileId: e.target.value || undefined,
                  });
                  setReviewed(false);
                }}
              >
                <option value="">No profile</option>
                {draft.profileId && !profile && (
                  <option value={draft.profileId}>
                    Missing profile · {draft.profileId}
                  </option>
                )}
                {store.targetProfiles?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {profile && (
              <p className="case-target">
                <strong>{profile.name}</strong> · {profile.host || "No host"} ·
                TCP {profile.port || "unchanged"} ·{" "}
                {profile.url || "No HTTP base"}
              </p>
            )}
            {draft.profileId && draft.profileId !== value.profileId && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I reviewed this saved profile. Applying targets still requires
                Quick Target preview and native approval.
              </label>
            )}
            <h3>Attach saved workflows</h3>
            <div className="case-attachments">
              {store.workflows.map((w) => (
                <label className="checkbox" key={w.id}>
                  <input
                    type="checkbox"
                    checked={draft.workflowIds.includes(w.id)}
                    disabled={
                      w.tags.includes(LOCAL_KIT_TAG) &&
                      !draft.workflowIds.includes(w.id)
                    }
                    onChange={() => toggle("workflowIds", w.id)}
                  />
                  {w.name}
                  {w.tags.includes(LOCAL_KIT_TAG)
                    ? " · reusable template; instantiate through New from Kit"
                    : ""}{" "}
                  <small>· {w.id}</small>
                </label>
              ))}
              {draft.workflowIds
                .filter((id) => !store.workflows.some((w) => w.id === id))
                .map((id) => (
                  <label className="checkbox missing-reference" key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => toggle("workflowIds", id)}
                    />
                    Missing workflow · {id} (uncheck to unlink)
                  </label>
                ))}
              {!store.workflows.length && (
                <p>
                  No saved workflows yet. Save a playbook in the editor, then
                  attach it here.
                </p>
              )}
            </div>
            <h3>Saved evidence links</h3>
            <p>
              {draft.runIds.length} existing references are preserved. Manage
              reports in the case's Evidence section: Review / Attach evidence
              shows origin and scope before linking, and Unlink asks for
              confirmation. Saving this form never changes evidence links.
            </p>
          </fieldset>
          {error && (
            <p role="alert" className="target-error">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={busy || value.archived || !draft.name.trim()}
            >
              {busy ? "Saving investigation…" : "Save investigation"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
