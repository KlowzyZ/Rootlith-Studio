import { useDialog } from "./useDialog";
import { putProfile, type TargetProfile } from "../core/profiles";
import { useState } from "react";
import { target, type Workflow } from "../schemas";
import { quickTarget, type TargetInput } from "../core/quick-target";
export function QuickTarget({
  workflow,
  apply,
  close,
  profiles,
  saveProfiles,
  initialProfileId = "",
}: {
  workflow: Workflow;
  apply: (w: Workflow) => void;
  close: () => void;
  profiles: TargetProfile[];
  initialProfileId?: string;
  saveProfiles: (
    update: (profiles: TargetProfile[]) => TargetProfile[],
  ) => Promise<void>;
}) {
  const initialProfile = profiles.find((p) => p.id === initialProfileId);
  const [input, setInput] = useState<TargetInput>({
    host: initialProfile?.host || "",
    port: initialProfile?.port || "",
    url: initialProfile?.url || "",
  });
  const [profileId, setProfileId] = useState(initialProfile?.id || "");
  const [name, setName] = useState(initialProfile?.name || "");
  const [profileError, setProfileError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dialog = useDialog(close, busy);
  async function changeProfiles(
    next: (profiles: TargetProfile[]) => TargetProfile[],
    id: string,
  ) {
    setBusy(true);
    setProfileError("");
    try {
      await saveProfiles(next);
      setProfileId(id);
      setDeleting(false);
      return true;
    } catch (e) {
      setProfileError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function saveProfile(copy = false) {
    try {
      const id = copy || !profileId ? crypto.randomUUID() : profileId;
      const nextName = copy ? `${name.slice(0, 75)} copy` : name;
      const value = { id, name: nextName, ...input };
      putProfile(profiles, value); // immediate validation; revalidate against latest metadata at commit
      const next = (current: TargetProfile[]) => putProfile(current, value);
      void changeProfiles(next, id).then((saved) => {
        if (saved && copy) setName(nextName);
      });
    } catch (e) {
      setProfileError((e as Error).message);
    }
  }
  let result: ReturnType<typeof quickTarget> | undefined,
    error = "";
  try {
    result = quickTarget(workflow, input);
  } catch (e) {
    error = (e as Error).message;
  }
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        className="modal target-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-title"
      >
        <small className="mint">INVESTIGATION SETUP</small>
        <h2 id="target-title">Quick Target Setup</h2>
        <p>
          Apply concrete targets to this workflow. Blank fields keep current
          values. Timeouts and other settings stay intact.
        </p>
        <section className="profile-tools" aria-label="Target Profiles">
          <h3>Target Profiles</h3>
          <label>
            Saved profile
            <select
              aria-label="Saved profile"
              value={profileId}
              disabled={busy}
              onChange={(e) => {
                setProfileId(e.target.value);
                setDeleting(false);
                setProfileError("");
                const p = profiles.find((p) => p.id === e.target.value);
                setName(p?.name || "");
                setInput(
                  p
                    ? { host: p.host, port: p.port, url: p.url }
                    : { host: "", port: "", url: "" },
                );
              }}
            >
              <option value="">New profile / manual target</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Profile name
            <input
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workshop IP Camera"
            />
          </label>
          <p className="muted">
            Profiles store concrete targets only, without authentication.
            Editing a profile never changes saved workflows. Review and apply
            below.
          </p>
          <div className="modal-actions">
            <button
              disabled={busy || !name.trim()}
              onClick={() => saveProfile()}
            >
              Save profile
            </button>
            <button
              disabled={busy || !profileId}
              onClick={() => saveProfile(true)}
            >
              Duplicate profile
            </button>
            <button
              disabled={busy || !profileId}
              onClick={() => setDeleting(true)}
            >
              Delete profile
            </button>
          </div>
          {deleting && (
            <div role="alert">
              <p>Delete this profile? Existing workflows keep their targets.</p>
              <button disabled={busy} onClick={() => setDeleting(false)}>
                Cancel deletion
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  changeProfiles(
                    (current) => current.filter((p) => p.id !== profileId),
                    "",
                  )
                }
              >
                Confirm delete profile
              </button>
            </div>
          )}
          {profileError && <p role="alert">{profileError}</p>}
        </section>
        <div className="target-inputs">
          <label>
            DNS / TCP host
            <input
              maxLength={253}
              value={input.host}
              placeholder="service.example.com"
              onChange={(e) => setInput({ ...input, host: e.target.value })}
            />
          </label>
          <label>
            TCP port
            <input
              maxLength={5}
              inputMode="numeric"
              value={input.port}
              placeholder="443"
              onChange={(e) => setInput({ ...input, port: e.target.value })}
            />
          </label>
          <label>
            HTTP(S) base URL
            <input
              maxLength={2048}
              value={input.url}
              placeholder="https://service.example.com"
              onChange={(e) => setInput({ ...input, url: e.target.value })}
            />
            <small>
              Existing HTTP paths are preserved. Set the HTTP port in this URL
              if needed.
            </small>
          </label>
        </div>
        {error && (
          <p role="alert" className="target-error">
            {error}
          </p>
        )}
        <h3>Review exact changes · {result?.changes.length || 0} steps</h3>
        <div className="target-preview">
          {result?.changes.map(({ before, after }) => (
            <article key={before.id}>
              <strong>{before.label}</strong>
              <small>
                {before.kind.toUpperCase()} · {before.id}
              </small>
              <code>
                {target(before)} → {target(after)}
              </code>
              <details>
                <summary>Full configuration before / after</summary>
                <pre>
                  {JSON.stringify(before.config, null, 2)}
                  {"\n→\n"}
                  {JSON.stringify(after.config, null, 2)}
                </pre>
              </details>
            </article>
          ))}
          {!error && !result?.changes.length && (
            <p>
              Enter a target above to preview changes to DNS, TCP or HTTP steps.
            </p>
          )}
        </div>
        <p className="muted">
          This only edits the workflow. Before execution, the desktop still
          requires native approval of these exact targets.
        </p>
        <div className="modal-actions">
          <button onClick={close}>Cancel</button>
          <button
            className="primary"
            disabled={!result?.changes.length || !!error}
            onClick={() => {
              if (result) apply(result.workflow);
            }}
          >
            Apply target changes
          </button>
        </div>
      </section>
    </div>
  );
}
