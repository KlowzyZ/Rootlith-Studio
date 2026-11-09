import { expect, test, vi } from "vitest";
import {
  parseVersion,
  compareVersions,
  UpdateService,
} from "../packages/core/updates";
import { officialLink, isOfficialReleaseUrl } from "../packages/core/project";
const provider = {
  kind: "public-github" as const,
  repository: "KlowzyZ/Rootlith-Studio" as const,
};
const release = (version: string, extra = {}) => ({
  tag_name: `v${version}`,
  name: `Rootlith ${version}`,
  html_url: `https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v${version}`,
  draft: false,
  prerelease: version.includes("-"),
  published_at: "2026-11-01T00:00:00Z",
  ...extra,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const transport = (body: unknown) =>
  vi.fn<typeof fetch>(async () => response(body));
test("strict semver and prerelease precedence match release ordering without downgrades", () => {
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];
  for (let i = 1; i < ordered.length; i++)
    expect(compareVersions(ordered[i - 1], ordered[i])).toBe(-1);
  expect(compareVersions("0.13.0-alpha.1", "0.12.0")).toBe(1);
  expect(compareVersions("1.0.0+one", "1.0.0+two")).toBe(0);
  expect(
    compareVersions(
      "1.0.0-alpha.99999999999999999999",
      "1.0.0-alpha.100000000000000000000",
    ),
  ).toBe(-1);
  for (const value of [
    "01.0.0",
    "1.0",
    "1.0.0-01",
    "v1.0.0",
    "1.0.0-",
    "9007199254740992.0.0",
    "1.0.0\n",
  ])
    expect(() => parseVersion(value)).toThrow();
});
test("private channel cannot query Drafts, claim latest or bundle authentication", async () => {
  const fetcher = transport([]);
  const service = new UpdateService("0.13.0-alpha.1", { kind: "private-preview" }, fetcher);
  const state = await service.check();
  expect(state.state).toBe("unavailable");
  expect(state.lastSuccess).toBeUndefined();
  expect(state.installedVersion).toBe("0.13.0-alpha.1");
  expect(fetcher).not.toHaveBeenCalled();
});
test("official public provider handles published versions, same-version builds and stable-channel filtering", async () => {
  const fetcher = transport([
    release("0.12.0"),
    release("0.13.0-alpha.2"),
    release("1.0.0", { draft: true }),
  ]);
  const service = new UpdateService("0.13.0-alpha.1", provider, fetcher);
  const result = await service.check();
  expect(result.state).toBe("available");
  expect(result.release?.version).toBe("0.13.0-alpha.2");
  expect(result.lastSuccess).toBeTruthy();
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.github.com/repos/KlowzyZ/Rootlith-Studio/releases?per_page=20",
  );
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    credentials: "omit",
  });
  expect(
    (
      await new UpdateService(
        "0.13.0-alpha.1",
        provider,
        transport([release("0.12.0")]),
      ).check()
    ).state,
  ).toBe("up-to-date");
  expect(
    (
      await new UpdateService(
        "0.12.0",
        provider,
        transport([release("0.13.0-alpha.1"), release("0.12.0")]),
      ).check()
    ).release?.version,
  ).toBe("0.12.0");
});
test("build metadata tags are accepted without changing precedence", async () => {
  const result = await new UpdateService(
    "1.0.0+local",
    provider,
    transport([
      release("1.0.0+official", {
        html_url:
          "https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v1.0.0%2Bofficial",
      }),
    ]),
  ).check();
  expect(result.state).toBe("up-to-date");
});
test("404, rate limits, empty results and offline are honest unavailability rather than current-version claims", async () => {
  for (const status of [404, 403, 429])
    expect(
      (
        await new UpdateService(
          "0.13.0-alpha.1",
          provider,
          vi.fn(async () => response({}, status)),
        ).check()
      ).state,
    ).toBe("unavailable");
  expect(
    (await new UpdateService("0.13.0-alpha.1", provider, transport([])).check())
      .state,
  ).toBe("unavailable");
  const fetcher = transport([]);
  expect(
    (
      await new UpdateService(
        "0.13.0-alpha.1",
        provider,
        fetcher,
        () => false,
      ).check()
    ).state,
  ).toBe("offline");
  expect(fetcher).not.toHaveBeenCalled();
});
test("failed checks preserve installed version and last success; request concurrency is bounded", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response([release("0.13.0-alpha.2")]))
    .mockRejectedValue(new TypeError("Network unavailable"));
  const service = new UpdateService("0.13.0-alpha.1", provider, fetcher);
  const previous = await service.check();
  const a = service.check(),
    b = service.check();
  expect(a).toBe(b);
  const result = await a;
  expect(result.state).toBe("error");
  expect(result.lastSuccess).toBe(previous.lastSuccess);
  expect(result.installedVersion).toBe(previous.installedVersion);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
test("timeouts abort networking and never conclude latest", async () => {
  const fetcher = vi.fn<typeof fetch>(
    (_, options) =>
      new Promise((_, reject) =>
        options?.signal?.addEventListener("abort", () =>
          reject(new Error("Aborted")),
        ),
      ),
  );
  const result = await new UpdateService(
    "0.13.0-alpha.1",
    provider,
    fetcher,
    () => true,
    10,
  ).check();
  expect(result.state).toBe("error");
  expect(result.message).toContain("timed out");
  expect(result.lastSuccess).toBeUndefined();
});
test("malformed, oversized, redirected and mismatched release metadata fail closed", async () => {
  const bad = [
    {},
    Array.from({ length: 21 }, () => release("0.14.0")),
    [release("0.14.0", { html_url: "https://evil.example/file.exe" })],
    [
      release("0.14.0", {
        html_url:
          "https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v0.15.0",
      }),
    ],
    [release("0.14.0", { prerelease: true })],
  ];
  for (const body of bad)
    expect(
      (
        await new UpdateService(
          "0.13.0-alpha.1",
          provider,
          transport(body),
        ).check()
      ).state,
    ).toBe("error");
  for (const r of [
    new Response("x".repeat(132000), {
      headers: { "content-type": "application/json" },
    }),
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": "999999",
      },
    }),
  ])
    expect(
      (
        await new UpdateService(
          "0.13.0-alpha.1",
          provider,
          vi.fn(async () => r),
        ).check()
      ).state,
    ).toBe("error");
  expect(
    (
      await new UpdateService(
        "0.13.0-alpha.1",
        provider,
        vi.fn(async () => {
          throw new TypeError("Redirect disallowed");
        }),
      ).check()
    ).state,
  ).toBe("error");
});
test("external links accept only fixed official destinations and verified release pages", () => {
  expect(officialLink("website")).toBe("https://klowzy.com/");
  expect(officialLink("repository")).toBe(
    "https://github.com/KlowzyZ/Rootlith-Studio",
  );
  expect(() => officialLink("release")).toThrow();
  for (const url of [
    "file:///C:/Windows/cmd.exe",
    "https://github.com.evil.example/KlowzyZ/Rootlith-Studio/releases/tag/v1.0.0",
    "https://github.com@evil.example/KlowzyZ/Rootlith-Studio/releases/tag/v1.0.0",
    "https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v1.0.0?next=evil",
    "https://github.com/KlowzyZ/Other/releases/tag/v1.0.0",
    "https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v1.0.0#x",
    "https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/%2e%2e",
  ])
    expect(isOfficialReleaseUrl(url)).toBe(false);
  expect(
    isOfficialReleaseUrl(
      "https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v1.0.0",
    ),
  ).toBe(true);
  expect(() => officialLink("https://evil.example")).toThrow();
});

test("HTTP errors release unread response bodies and abort the request", async () => {
  let cancelled = false;
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>(async (_, options) => {
    signal = options?.signal || undefined;
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  });
  const result = await new UpdateService(
    "0.13.0-alpha.1",
    provider,
    fetcher,
  ).check();
  expect(result.state).toBe("error");
  expect(cancelled).toBe(true);
  expect(signal?.aborted).toBe(true);
});
