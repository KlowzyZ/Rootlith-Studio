import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SlidersHorizontal,
  RefreshCw,
  Database,
  Info,
  ArrowUpRight,
  ShieldCheck,
  Check,
  AlertCircle,
  X,
} from "lucide-react";
import { productVersion } from "../core/identity";
import {
  officialLink,
  type OfficialLink,
  repositoryUrl,
} from "../core/project";
import type { UpdateStatus } from "../core/updates";
import { useDialog } from "./useDialog";
import "./settings.css";
// Browser development mode never starts an independent renderer update client.
const browserStatus: UpdateStatus = {
  installedVersion: productVersion,
  channel: "Browser development",
  includePreviews: false,
  delivery: "blocked",
  deliveryReason:
    "Executable delivery requires a native application, publisher authentication and Windows upgrade validation.",
  automatic: false,
  state: "unavailable",
  message:
    "Browser development mode has no native update service. Use the official Releases page to review publications.",
};
const panes = [
  ["general", "General", SlidersHorizontal],
  ["updates", "Updates", RefreshCw],
  ["data", "Data & Recovery", Database],
  ["about", "About", Info],
] as const;
type Pane = (typeof panes)[number][0];
async function openLink(kind: OfficialLink, release?: string) {
  if (window.fixflow) await window.fixflow.openOfficialLink(kind);
  else
    window.open(officialLink(kind, release), "_blank", "noopener,noreferrer");
}
function Notices({
  kind,
  close,
}: {
  kind: "license" | "notices";
  close: () => void;
}) {
  const ref = useDialog(close);
  const [text, setText] = useState("Loading local notices…");
  useEffect(() => {
    let alive = true;
    const load =
      kind === "license"
        ? import("../../LICENSE?raw")
        : import("../../THIRD_PARTY_NOTICES.md?raw");
    void load
      .then((m) => {
        if (alive) setText(m.default);
      })
      .catch(() => {
        if (alive)
          setText(
            "Local notices could not be loaded. Consult the LICENSE and third-party notices supplied with the application.",
          );
      });
    return () => {
      alive = false;
    };
  }, [kind]);
  return (
    <div className="modal-backdrop">
      <section
        ref={ref}
        className="modal settings-notices"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notices-title"
      >
        <div className="report-heading">
          <h2 id="notices-title">
            {kind === "license" ? "MIT license" : "Third-party notices"}
          </h2>
          <button aria-label="Close notices" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <pre>{text}</pre>
        <p>
          Electron and Chromium also supply their notices alongside the
          executable. Installer component sources and licenses ship under
          resources/legal.
        </p>
      </section>
    </div>
  );
}
export function SettingsPage({
  compact,
  setCompact,
  renderData,
}: {
  compact: boolean;
  setCompact: (value: boolean) => void;
  renderData: () => ReactNode;
}) {
  const [pane, setPane] = useState<Pane>("general");
  const [status, setStatus] = useState<UpdateStatus>(() => browserStatus);
  const [checking, setChecking] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [notices, setNotices] = useState<"license" | "notices">();
  const alive = useRef(true);
  const section = useRef<HTMLElement>(null);
  function selectPane(next: Pane) {
    setPane(next);
    section.current
      ?.closest(".content-page")
      ?.scrollTo({ top: 0, behavior: "instant" });
  }
  useEffect(() => {
    alive.current = true;
    if (window.fixflow)
      void window.fixflow
        .updates("status")
        .then((s) => {
          if (alive.current) setStatus(s);
        })
        .catch(() => {
          if (alive.current)
            setStatus((s) => ({
              ...s,
              state: "unavailable",
              message:
                "The native update service is unavailable. No remote check was performed.",
            }));
        });
    const unsubscribe = window.fixflow?.onUpdateStatus((next) => {
      if (alive.current) setStatus(next);
    });
    return () => {
      unsubscribe?.();
      alive.current = false;
    };
  }, []);
  async function check() {
    if (checking || status.state === "checking" || !window.fixflow) return;
    setChecking(true);
    try {
      const s = await window.fixflow.updates("check");
      if (alive.current) setStatus(s);
    } catch {
      if (alive.current)
        setStatus((s) => ({
          ...s,
          state: "error",
          message:
            "The native update service did not respond. Installed version is unchanged.",
        }));
    } finally {
      if (alive.current) setChecking(false);
    }
  }
  async function preferences(automatic: boolean, includePreviews: boolean) {
    if (!window.fixflow || savingPreferences) return;
    setSavingPreferences(true);
    setPreferenceError("");
    try {
      const next = await window.fixflow.updatePreferences({
        automatic,
        includePreviews,
      });
      if (alive.current) setStatus(next);
    } catch {
      if (alive.current)
        setPreferenceError(
          "Update preferences could not be saved. Wait for any current check to finish, then try again.",
        );
    } finally {
      if (alive.current) setSavingPreferences(false);
    }
  }
  async function link(kind: OfficialLink) {
    setLinkError("");
    try {
      await openLink(kind, status.release?.url);
    } catch {
      setLinkError(
        "The verified official page could not be opened. No alternative destination was used.",
      );
    }
  }
  return (
    <section
      ref={section}
      className="settings-workspace"
      aria-label="Application settings"
    >
      <div className="settings-heading">
        <div>
          <small className="settings-eyebrow">YOUR APPLICATION</small>
          <h2>Settings</h2>
          <p>A private workspace. Clear choices. Your data stays yours.</p>
        </div>
        <span className="settings-version">
          Rootlith Studio <strong>{status.installedVersion}</strong>
        </span>
      </div>
      <div className="settings-layout">
        <nav
          className="settings-nav"
          aria-label="Settings sections"
          role="tablist"
          aria-orientation="vertical"
          onKeyDown={(e) => {
            if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const i = panes.findIndex((p) => p[0] === pane);
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? panes.length - 1
                  : (i + (e.key === "ArrowDown" ? 1 : -1) + panes.length) %
                    panes.length;
            selectPane(panes[next][0]);
            document.getElementById(`settings-tab-${panes[next][0]}`)?.focus();
          }}
        >
          {panes.map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={pane === id}
              aria-controls={`settings-panel-${id}`}
              tabIndex={pane === id ? 0 : -1}
              onClick={() => selectPane(id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
          <div className="settings-local">
            <ShieldCheck size={16} />
            <span>
              Local by design<small>No accounts or telemetry</small>
            </span>
          </div>
        </nav>
        <div
          className="settings-panel"
          role="tabpanel"
          id={`settings-panel-${pane}`}
          aria-labelledby={`settings-tab-${pane}`}
        >
          {pane === "general" && (
            <>
              <div className="settings-section-title">
                <h3>General</h3>
                <p>Keep the workspace comfortable and predictable.</p>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Compact navigation</strong>
                  <p>
                    Use an icon rail to make more room for your investigation.
                    Applies to this session.
                  </p>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="Compact navigation"
                    checked={compact}
                    onChange={(e) => setCompact(e.target.checked)}
                  />
                  <span>{compact ? "On" : "Off"}</span>
                </label>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Appearance</strong>
                  <p>
                    Graphite dark theme. Additional themes are not currently
                    configurable.
                  </p>
                </div>
                <span className="settings-value">Dark</span>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Motion</strong>
                  <p>
                    Interface feedback follows your system’s reduced-motion
                    preference.
                  </p>
                </div>
                <span className="settings-value">System preference</span>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Startup & saving</strong>
                  <p>
                    Your saved workspace and recoverable editor draft open on
                    startup. Saves still require storage acknowledgment.
                  </p>
                </div>
                <span className="settings-value">Local workspace</span>
              </div>
              <div className="settings-note">
                <ShieldCheck size={18} />
                <p>
                  Background release checks can be controlled in Updates. No
                  executable downloads or installations are enabled. Diagnostic
                  checks still require your explicit approval.
                </p>
              </div>
            </>
          )}
          {pane === "updates" && (
            <>
              <div className="settings-section-title">
                <h3>Updates</h3>
                <p>
                  Know which build you’re using, and where updates can come
                  from.
                </p>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Automatically check for updates</strong>
                  <p>
                    Check after startup and about every 24 hours. No downloads
                    or installation.
                  </p>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="Automatically check for updates"
                    checked={status.automatic}
                    disabled={
                      !window.fixflow ||
                      savingPreferences ||
                      checking ||
                      status.state === "checking"
                    }
                    onChange={(event) =>
                      void preferences(
                        event.target.checked,
                        status.includePreviews,
                      )
                    }
                  />
                  {status.automatic ? "On" : "Off"}
                </label>
              </div>
              <div className="preference-row">
                <div>
                  <strong>Include preview releases</strong>
                  <p>
                    Include alpha, beta and release candidates. Stable builds
                    start with this off.
                  </p>
                </div>
                <label className="settings-switch">
                  <input
                    type="checkbox"
                    aria-label="Include preview releases"
                    checked={status.includePreviews}
                    disabled={
                      !window.fixflow ||
                      savingPreferences ||
                      checking ||
                      status.state === "checking"
                    }
                    onChange={(event) =>
                      void preferences(status.automatic, event.target.checked)
                    }
                  />
                  {status.includePreviews ? "On" : "Off"}
                </label>
              </div>
              <dl className="settings-facts">
                <div>
                  <dt>Installed version</dt>
                  <dd>{status.installedVersion}</dd>
                </div>
                <div>
                  <dt>Update channel</dt>
                  <dd>{status.channel}</dd>
                </div>
                <div>
                  <dt>Last successful check</dt>
                  <dd>
                    {status.lastSuccess
                      ? new Date(status.lastSuccess).toLocaleString()
                      : "No successful public check yet"}
                  </dd>
                </div>
              </dl>
              <div
                className={`update-state ${status.state}`}
                aria-live="polite"
                aria-busy={checking || status.state === "checking"}
              >
                {checking || status.state === "checking" ? (
                  <RefreshCw size={20} />
                ) : status.state === "up-to-date" ? (
                  <Check size={20} />
                ) : (
                  <AlertCircle size={20} />
                )}
                <div>
                  <strong>
                    {checking || status.state === "checking"
                      ? "Checking official release information…"
                      : {
                          idle: "Ready to check",
                          checking: "Checking official release information…",
                          available: "Update available",
                          "up-to-date": "You’re up to date",
                          unavailable: "Update checking unavailable",
                          error: "Update check could not finish",
                          offline: "Device is offline",
                        }[status.state]}
                  </strong>
                  <p>
                    {checking || status.state === "checking"
                      ? "Contacting the official public repository. No executable files will be downloaded or installed."
                      : status.message}
                  </p>
                  {status.release && !checking && (
                    <p>
                      {status.cached
                        ? "Saved publication metadata (not a fresh check):"
                        : "Publication metadata:"}{" "}
                      <strong>{status.release.version}</strong> ·{" "}
                      {new Date(
                        status.release.publishedAt,
                      ).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="settings-actions">
                <button
                  className="primary"
                  onClick={() => void check()}
                  disabled={
                    checking || status.state === "checking" || !window.fixflow
                  }
                >
                  <RefreshCw size={15} />
                  Check for Updates
                </button>
                {status.release && !checking && (
                  <button onClick={() => void link("release")}>
                    Official release page
                    <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
              <button
                onClick={() => void link("releases")}
                className="settings-link"
              >
                Official GitHub Releases <ArrowUpRight size={14} />
              </button>
              {status.release?.notes && (
                <details className="update-notes">
                  <summary>Release notes — {status.release.version}</summary>
                  <pre>{status.release.notes}</pre>
                </details>
              )}
              {status.retryAt && (
                <p className="settings-footnote">
                  Retry after {new Date(status.retryAt).toLocaleString()}.
                  Repeated clicks do not bypass rate limits.
                </p>
              )}
              {status.runtime && (
                <p className="settings-footnote">
                  Build mode:{" "}
                  {status.runtime.distribution === "source"
                    ? "Development/source build — not an official installed release"
                    : status.runtime.distribution === "portable"
                      ? "Portable — replacement requires a verified download and closing the running application"
                      : "Packaged build — installer provenance has not been verified"}
                  .
                </p>
              )}
              <p className="settings-footnote">{status.deliveryReason}</p>
              {(preferenceError || status.persistenceError) && (
                <p role="alert">{preferenceError || status.persistenceError}</p>
              )}
            </>
          )}
          {pane === "data" && (
            <>
              <div className="settings-section-title">
                <h3>Data & Recovery</h3>
                <p>
                  Back up deliberately. Review before importing. Preserve a
                  recovery copy before resetting.
                </p>
              </div>
              {renderData()}
            </>
          )}
          {pane === "about" && (
            <>
              <div className="about-identity">
                <img
                  src="./favicon.svg"
                  alt="Rootlith Studio logo"
                  width="72"
                  height="72"
                />
                <div>
                  <small className="settings-eyebrow">
                    INDEPENDENT TECHNICIAN SOFTWARE
                  </small>
                  <h3>Rootlith Studio</h3>
                  <p>Clarity for every investigation.</p>
                  <span className="about-preview">
                    Public alpha · {status.installedVersion}
                  </span>
                </div>
              </div>
              <p className="about-description">
                Build a diagnostic path, keep the evidence in context, and hand
                over a clear record. Designed for deliberate, read-only
                technical investigations.
              </p>
              <dl className="settings-facts">
                <div>
                  <dt>Developer</dt>
                  <dd>KLOWZY</dd>
                </div>
                <div>
                  <dt>Website</dt>
                  <dd>
                    <button
                      className="settings-link"
                      onClick={() => void link("website")}
                    >
                      klowzy.com
                      <ArrowUpRight size={13} />
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>Repository</dt>
                  <dd>
                    <button
                      className="settings-link"
                      title={repositoryUrl}
                      onClick={() => void link("repository")}
                    >
                      {repositoryUrl.replace("https://github.com/", "")}
                      <ArrowUpRight size={13} />
                    </button>
                  </dd>
                </div>
                <div>
                  <dt>License</dt>
                  <dd>MIT · Third-party notices apply</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>
                    {status.runtime
                      ? `${status.runtime.platform} / ${status.runtime.arch} · ${status.runtime.packaged ? "Packaged desktop" : "Development desktop"}`
                      : "BROWSER SIMULATION · native runtime unavailable"}
                  </dd>
                </div>
                {status.runtime && (
                  <div>
                    <dt>Runtime</dt>
                    <dd>
                      Electron {status.runtime.electron} · Chromium{" "}
                      {status.runtime.chromium}
                    </dd>
                  </div>
                )}
              </dl>
              <div className="settings-actions">
                <button onClick={() => setNotices("license")}>
                  MIT license
                </button>
                <button onClick={() => setNotices("notices")}>
                  Third-party notices
                </button>
              </div>
              <p className="settings-footnote">
                Unsigned private preview. Native Windows upgrade and identity
                acceptance remain specific to each candidate.
              </p>
            </>
          )}
          {linkError && <p role="alert">{linkError}</p>}
        </div>
      </div>
      {notices && (
        <Notices kind={notices} close={() => setNotices(undefined)} />
      )}
    </section>
  );
}
