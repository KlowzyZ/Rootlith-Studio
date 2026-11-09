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
// No public preview manifest exists. Enabling public delivery requires a reviewed configuration change.
export const officialProvider: ReleaseProvider = { kind: "private-preview" };
export type ReleaseInfo = {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
};
export type UpdateStatus = {
  state:
    "idle" | "available" | "up-to-date" | "unavailable" | "error" | "offline";
  installedVersion: string;
  channel: string;
  message: string;
  lastSuccess?: string;
  release?: ReleaseInfo;
  runtime?: {
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
    result.push({
      version,
      name: r.name || r.tag_name,
      url: r.html_url,
      publishedAt: r.published_at,
    });
  }
  return result;
}
export class UpdateService {
  private value: UpdateStatus;
  private pending?: Promise<UpdateStatus>;
  private verifiedRelease?: string;
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
          : "Updates are checked only when you request them.",
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
    return (this.pending ??= this.perform().finally(() => {
      this.pending = undefined;
    }));
  }
  private async perform(): Promise<UpdateStatus> {
    const base = {
      installedVersion: this.installedVersion,
      channel: this.value.channel,
      lastSuccess: this.value.lastSuccess,
    };
    const finish = (state: UpdateStatus["state"], message: string) => {
      this.value = { ...base, state, message };
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
    const controller = new AbortController();
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
        await response.body?.cancel();
        return finish(
          "unavailable",
          "The official service restricted this request or reached its rate limit. Try a manual check later.",
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw Error(`Official service returned HTTP ${response.status}.`);
      }
      const available = releases(await boundedJson(response))
        .filter(
          (r) =>
            parseVersion(this.installedVersion).prerelease.length ||
            !parseVersion(r.version).prerelease.length,
        )
        .sort((a, b) => compareVersions(b.version, a.version));
      if (!available.length)
        return finish(
          "unavailable",
          "No published releases for this channel were returned. No latest version can be confirmed.",
        );
      const latest = available[0];
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
            : "No newer published version was found in the official channel’s latest 20 releases.",
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
