import { isOfficialReleaseUrl, repositoryNames } from "./project";
export type SemVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  text: string;
};
export function parseVersion(text: string): SemVersion {
  if (text.length > 96) throw Error("Version is too long.");
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      text,
    );
  if (!match) throw Error("Invalid semantic version.");
  const parts = match.slice(1, 4).map(Number);
  if (parts.some((n) => !Number.isSafeInteger(n)))
    throw Error("Version number exceeds safe bounds.");
  const prerelease = match[4]?.split(".") || [];
  if (
    prerelease.some((p) => /^\d+$/.test(p) && p.length > 1 && p.startsWith("0"))
  )
    throw Error("Invalid numeric prerelease identifier.");
  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2],
    prerelease,
    text,
  };
}
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left),
    b = parseVersion(right);
  for (const key of ["major", "minor", "patch"] as const)
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  if (!a.prerelease.length || !b.prerelease.length)
    return a.prerelease.length === b.prerelease.length
      ? 0
      : a.prerelease.length
        ? -1
        : 1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i];
    if (x === undefined || y === undefined)
      return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn)
      return x.length === y.length
        ? x > y
          ? 1
          : -1
        : x.length > y.length
          ? 1
          : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export type ReleaseProvider =
  | { kind: "private-preview" }
  | { kind: "public-github"; repository: (typeof repositoryNames)[number] };
// Discovery only. Publisher-authenticated executable delivery is a separate gate.
export const officialProvider: ReleaseProvider = {
  kind: "public-github",
  repository: repositoryNames[0],
};
export type ReleaseInfo = {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  notes: string;
};
export type UpdateStatus = {
  state:
    | "idle"
    | "checking"
    | "available"
    | "up-to-date"
    | "unavailable"
    | "error"
    | "offline";
  automatic: boolean;
  includePreviews: boolean;
  retryAt?: string;
  persistenceError?: string;
  cached?: boolean;
  installedVersion: string;
  channel: string;
  message: string;
  lastSuccess?: string;
  release?: ReleaseInfo;
  delivery: "blocked";
  deliveryReason: string;
  runtime?: {
    distribution: "source" | "portable" | "packaged-unverified";
    platform: string;
    arch: string;
    electron: string;
    chromium: string;
    packaged: boolean;
  };
};
const MAX_BYTES = 128 * 1024;
const privateMessage =
  "Private preview releases are unpublished GitHub Drafts. This build has no authenticated preview distribution service; it cannot securely discover those drafts. No credentials are bundled.";
async function boundedJson(response: Response): Promise<unknown> {
  if (
    !response.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw Error("Official service returned an unexpected content type.");
  const length = response.headers.get("content-length");
  if (length && (Number(length) > MAX_BYTES || !/^\d+$/.test(length)))
    throw Error("Official response exceeds the size limit.");
  if (!response.body)
    throw Error("Official service returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES)
        throw Error("Official response exceeds the size limit.");
      chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
}
function releases(input: unknown): ReleaseInfo[] {
  if (!Array.isArray(input) || input.length > 20)
    throw Error("Official release list is malformed.");
  const result: ReleaseInfo[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw Error("Official release entry is malformed.");
    const r = item as Record<string, unknown>;
    if (
      typeof r.draft !== "boolean" ||
      typeof r.prerelease !== "boolean" ||
      typeof r.tag_name !== "string" ||
      r.tag_name.length > 97 ||
      typeof r.html_url !== "string" ||
      (typeof r.name !== "string" && r.name !== null) ||
      (typeof r.name === "string" && r.name.length > 160)
    )
      throw Error("Official release metadata is malformed.");
    if (r.draft) continue;
    if (
      typeof r.published_at !== "string" ||
      r.published_at.length > 40 ||
      !/^\d{4}-\d\d-\d\dT/.test(r.published_at) ||
      !Number.isFinite(Date.parse(r.published_at))
    )
      throw Error("Official publication time is malformed.");
    const version = r.tag_name.replace(/^v/, "");
    const parsed = parseVersion(version);
    if (
      r.prerelease !== !!parsed.prerelease.length ||
      !isOfficialReleaseUrl(r.html_url)
    )
      throw Error("Official release identity is inconsistent.");
    const tag = decodeURIComponent(
      new URL(r.html_url).pathname.split("/").at(-1)!,
    );
    if (tag !== r.tag_name)
      throw Error("Official release tag does not match its page.");
    if (r.body !== undefined && r.body !== null && typeof r.body !== "string")
      throw Error("Official release notes are malformed.");
    result.push({
      version,
      name: r.name || r.tag_name,
      url: r.html_url,
      publishedAt: r.published_at,
      notes: typeof r.body === "string" ? r.body.slice(0, 12000) : "",
    });
  }
  return result;
}
export class UpdateService {
  private value: UpdateStatus;
  private pending?: Promise<UpdateStatus>;
  private verifiedRelease?: string;
  private retryAfter = 0;
  private failures = 0;
  private controller?: AbortController;
  dispose() {
    this.controller?.abort();
  }
  private listeners = new Set<(status: UpdateStatus) => void>();
  subscribe(listener: (status: UpdateStatus) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish() {
    for (const listener of this.listeners) listener(this.status());
  }
  configure(automatic: boolean, includePreviews: boolean) {
    if (this.pending)
      throw Error("Wait for the current update check to finish.");
    this.value = {
      ...this.value,
      automatic,
      includePreviews,
      channel: includePreviews
        ? "Preview (alpha, beta, rc and stable)"
        : "Stable",
      state: "idle",
      release: undefined,
      message: "Update preferences saved for this device.",
    };
    this.verifiedRelease = undefined;
    this.value.cached = false;
    this.publish();
  }
  restorePublication(release: ReleaseInfo) {
    const checked = releases([
      {
        tag_name: new URL(release.url).pathname.split("/").at(-1)
          ? decodeURIComponent(new URL(release.url).pathname.split("/").at(-1)!)
          : "",
        name: release.name,
        html_url: release.url,
        published_at: release.publishedAt,
        body: release.notes,
        draft: false,
        prerelease: !!parseVersion(release.version).prerelease.length,
      },
    ])[0];
    if (checked.version !== release.version)
      throw Error("Cached release mismatch");
    if (
      !this.value.includePreviews &&
      parseVersion(checked.version).prerelease.length
    )
      return;
    this.value.release = checked;
    this.value.cached = true;
    this.value.message =
      "Saved publication metadata; the next successful check will refresh it.";
    this.verifiedRelease = checked.url;
  }
  restoreRetryAt(value: number) {
    if (Number.isFinite(value) && value > Date.now()) {
      this.retryAfter = Math.min(value, Date.now() + 7 * 86400000);
      this.value.retryAt = new Date(this.retryAfter).toISOString();
    }
  }
  restoreLastSuccess(value: string) {
    if (Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now())
      this.value.lastSuccess = value;
  }
  constructor(
    private installedVersion: string,
    private provider: ReleaseProvider = officialProvider,
    private transport: typeof fetch = fetch,
    private online: () => boolean = () => true,
    private timeoutMs = 8000,
  ) {
    const v = parseVersion(installedVersion);
    this.value = {
      state: provider.kind === "private-preview" ? "unavailable" : "idle",
      installedVersion,
      automatic: true,
      includePreviews: !!v.prerelease.length,
      delivery: "blocked",
      deliveryReason:
        "Downloads and installation are disabled: no pinned publisher verification policy or validated Windows upgrade path exists. Review the official release page; metadata checks do not authenticate executables.",
      channel:
        provider.kind === "private-preview"
          ? v.prerelease.length
            ? `Private ${v.prerelease[0]} preview`
            : "Private preview"
          : v.prerelease.length
            ? "Public preview"
            : "Stable",
      message:
        provider.kind === "private-preview"
          ? privateMessage
          : "Official public releases will be checked in the background when enabled.",
    };
  }
  status(): UpdateStatus {
    return {
      ...this.value,
      release: this.value.release ? { ...this.value.release } : undefined,
    };
  }
  releaseUrl() {
    return this.verifiedRelease;
  }
  check(): Promise<UpdateStatus> {
    if (this.pending) return this.pending;
    if (Date.now() < this.retryAfter) return Promise.resolve(this.status());
    this.pending = this.perform().finally(() => {
      this.pending = undefined;
      this.publish();
    });
    this.publish();
    return this.pending;
  }
  private async perform(): Promise<UpdateStatus> {
    const base = {
      ...this.value,
      release: undefined,
      cached: false,
      channel: this.value.channel,
      lastSuccess: this.value.lastSuccess,
    };
    const finish = (state: UpdateStatus["state"], message: string) => {
      this.verifiedRelease = undefined;
      this.value = { ...base, state, message };
      if (state === "error" || state === "offline") {
        this.retryAfter =
          Date.now() +
          Math.min(86400000, 60000 * 2 ** Math.min(this.failures++, 10));
        this.value.retryAt = new Date(this.retryAfter).toISOString();
      }
      return this.status();
    };
    if (!this.online())
      return finish(
        "offline",
        "The device reports no network connection. Installed version and last successful check are unchanged.",
      );
    if (this.provider.kind === "private-preview")
      return finish("unavailable", privateMessage);
    if (!repositoryNames.includes(this.provider.repository))
      return finish(
        "error",
        "Update provider is not an authorized official repository.",
      );
    this.value = {
      ...base,
      state: "checking",
      message: "Checking official public release information…",
    };
    const controller = new AbortController();
    this.controller = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.transport(
        `https://api.github.com/repos/${this.provider.repository}/releases?per_page=20`,
        {
          method: "GET",
          redirect: "error",
          credentials: "omit",
          signal: controller.signal,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return finish(
          "unavailable",
          "Official releases are not publicly discoverable. A private repository or unpublished Draft is not evidence that this version is current.",
        );
      }
      if (response.status === 403 || response.status === 429) {
        const retry = response.headers.get("retry-after");
        const reset = response.headers.get("x-ratelimit-reset");
        const retryTime =
          retry && /^\d+$/.test(retry)
            ? Date.now() + Number(retry) * 1000
            : retry
              ? Date.parse(retry)
              : 0;
        const resetTime =
          reset && /^\d+$/.test(reset) ? Number(reset) * 1000 : 0;
        this.retryAfter = Math.max(
          Date.now() + 15 * 60000,
          Number.isFinite(retryTime) ? retryTime : 0,
          Number.isFinite(resetTime) ? resetTime : 0,
        );
        base.retryAt = new Date(
          Math.min(this.retryAfter, 8640000000000000),
        ).toISOString();
        await response.body?.cancel();
        return finish(
          "unavailable",
          "The official service restricted this request or reached its rate limit. Checks will wait until the retry time shown.",
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`Official service returned HTTP ${response.status}.`);
      }
      if (response.redirected)
        throw Error("Redirected release metadata is not accepted.");
      const parsedReleases = releases(await boundedJson(response));
      this.failures = 0;
      this.retryAfter = 0;
      base.retryAt = undefined;
      base.lastSuccess = new Date().toISOString();
      const available = parsedReleases
        .filter(
          (r) =>
            this.value.includePreviews ||
            !parseVersion(r.version).prerelease.length,
        )
        .sort((a, b) => compareVersions(b.version, a.version));
      if (!available.length)
        return finish(
          "unavailable",
          "No published releases for this channel were returned. No latest version can be confirmed.",
        );
      const latest = available[0];
      if (
        parsedReleases.length === 20 &&
        compareVersions(latest.version, this.installedVersion) <= 0
      )
        return finish(
          "unavailable",
          "The bounded release window is full. No newer version was found here, but current-version status cannot be confirmed. Review the official Releases page.",
        );
      this.verifiedRelease = latest.url;
      this.value = {
        ...base,
        state:
          compareVersions(latest.version, this.installedVersion) > 0
            ? "available"
            : "up-to-date",
        message:
          compareVersions(latest.version, this.installedVersion) > 0
            ? "A newer official published version is available."
            : "You’re up to date with the official channel’s checked publications (latest 20 entries).",
        lastSuccess: new Date().toISOString(),
        release: latest,
      };
      return this.status();
    } catch (e) {
      return finish(
        "error",
        timedOut
          ? "Update check timed out. No version decision was made."
          : `Update check failed. ${e instanceof Error ? e.message : "Network or response error."}`,
      );
    } finally {
      controller.abort(); // Release unread error bodies as well as completed requests.
      clearTimeout(timer);
    }
  }
}
