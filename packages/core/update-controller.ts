import {
  UpdateService,
  parseVersion,
  type ReleaseInfo,
  type UpdateStatus,
} from "./updates";
export type UpdatePreferences = {
  automatic: boolean;
  includePreviews: boolean;
};
export type SavedUpdateState = UpdatePreferences & {
  format: 1;
  lastSuccess?: string;
  lastNotified?: string;
  nextCheck?: number;
  retryAt?: number;
  publication?: ReleaseInfo;
};
const DAY = 24 * 60 * 60 * 1000;
// Main-process scheduler. It owns no workspace records and exposes no file/download APIs.
export class UpdateController {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<UpdateStatus>;
  private running = false;
  private configuring = false;
  private lastAttempt = 0;
  private persistenceError = "";
  constructor(
    readonly service: UpdateService,
    private saved: SavedUpdateState,
    private save: (state: SavedUpdateState) => Promise<void>,
    private notify: (status: UpdateStatus) => void,
    private changed: () => void = () => {},
  ) {
    service.configure(saved.automatic, saved.includePreviews);
    if (saved.retryAt) service.restoreRetryAt(saved.retryAt);
    if (saved.lastSuccess) service.restoreLastSuccess(saved.lastSuccess);
    if (saved.publication) {
      try {
        service.restorePublication(saved.publication);
      } catch {
        this.saved.publication = undefined;
      }
    }
  }
  status(): UpdateStatus {
    return {
      ...this.service.status(),
      persistenceError: this.persistenceError || undefined,
    };
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(Math.max(20000, (this.saved.nextCheck || 0) - Date.now()));
  }
  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.service.dispose();
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.running || !this.saved.automatic) return;
    this.timer = setTimeout(
      () => {
        void this.check().catch(() => {
          this.schedule(60000);
        });
      },
      Math.min(DAY, Math.max(1000, delay)),
    );
  }
  async configure(settings: UpdatePreferences) {
    if (this.pending || this.configuring)
      throw Error("Wait for the current update operation to finish.");
    this.configuring = true;
    clearTimeout(this.timer);
    try {
      const next = {
        ...this.saved,
        ...settings,
        publication: undefined,
        nextCheck: undefined,
      };
      await this.save(next);
      this.saved = next;
      this.persistenceError = "";
      this.service.configure(settings.automatic, settings.includePreviews);
      return this.status();
    } finally {
      this.configuring = false;
      this.schedule(20000);
    }
  }
  check(): Promise<UpdateStatus> {
    if (this.pending) return this.pending;
    if (this.configuring) return Promise.resolve(this.status());
    // Manual clicks cannot exhaust an anonymous API quota either.
    if (this.lastAttempt && Date.now() - this.lastAttempt < 60000) {
      this.schedule(60000 - (Date.now() - this.lastAttempt));
      return Promise.resolve(this.status());
    }
    this.lastAttempt = Date.now();
    this.pending = this.perform().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async perform() {
    const result = await this.service.check();
    const retry = result.retryAt ? Date.parse(result.retryAt) : 0;
    this.saved.lastSuccess = result.lastSuccess;
    this.saved.retryAt = retry || undefined;
    if (result.release) this.saved.publication = { ...result.release };
    this.saved.nextCheck = Math.max(
      Date.now() +
        (result.state === "error" || result.state === "offline" ? 60000 : DAY),
      retry || 0,
    );
    if (retry) this.saved.nextCheck = retry;
    const freshVersion =
      result.state === "available" && result.release?.version;
    const announce = freshVersion && freshVersion !== this.saved.lastNotified;
    if (announce) this.saved.lastNotified = freshVersion;
    try {
      await this.save({ ...this.saved });
      this.persistenceError = "";
    } catch {
      this.persistenceError =
        "Update history could not be saved. Preferences may not survive restart; workspace data is unaffected.";
    }
    if (announce && this.running) {
      try {
        this.notify(result);
      } catch {
        /* OS notifications are best effort; Settings remains authoritative. */
      }
    }
    this.changed();
    this.schedule(this.saved.nextCheck - Date.now());
    return this.status();
  }
}
export function defaultUpdateState(version: string): SavedUpdateState {
  return {
    format: 1,
    automatic: true,
    includePreviews: !!parseVersion(version).prerelease.length,
  };
}
