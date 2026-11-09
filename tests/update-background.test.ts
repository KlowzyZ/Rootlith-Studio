import { afterEach, expect, test, vi } from "vitest";
import { UpdateService } from "../packages/core/updates";
import {
  UpdateController,
  defaultUpdateState,
  type SavedUpdateState,
} from "../packages/core/update-controller";
const version = "0.13.0-alpha.1";
const publication = (v = "0.14.0", extra = {}) => ({
  tag_name: `v${v}`,
  html_url: `https://github.com/KlowzyZ/Rootlith-Studio/releases/tag/v${v}`,
  name: `Rootlith ${v}`,
  draft: false,
  prerelease: v.includes("-"),
  published_at: "2026-11-01T00:00:00Z",
  body: "Release notes <script>never executed</script>",
  ...extra,
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
function fixture(body: unknown = [publication()]) {
  const fetcher = vi.fn<typeof fetch>(async () => json(body));
  const service = new UpdateService(version, undefined, fetcher);
  const save = vi.fn<(state: SavedUpdateState) => Promise<void>>(
      async () => {},
    ),
    notify = vi.fn();
  const controller = new UpdateController(
    service,
    defaultUpdateState(version),
    save,
    notify,
  );
  return { fetcher, service, save, notify, controller };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test("enabled startup is delayed, checks daily and notifies once per version across checks/restarts", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.start();
  await vi.advanceTimersByTimeAsync(19999);
  expect(f.fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.notify).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(86400000);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(f.notify).toHaveBeenCalledTimes(1);
  const saved = f.save.mock.calls.at(-1)![0];
  f.controller.stop();
  const next = fixture();
  const restored = new UpdateController(
    next.service,
    saved,
    next.save,
    next.notify,
  );
  expect(restored.status().cached).toBe(true);
  expect(restored.status().lastSuccess).toBeTruthy();
  expect(restored.status().state).toBe("idle");
  restored.start();
  await vi.advanceTimersByTimeAsync(86400000);
  expect(next.notify).not.toHaveBeenCalled();
  restored.stop();
});
test("disable survives persistence and cancels future background checks, manual checks remain real", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.controller.start();
  await f.controller.configure({ automatic: false, includePreviews: false });
  await vi.advanceTimersByTimeAsync(172800000);
  expect(f.fetcher).not.toHaveBeenCalled();
  expect((await f.controller.check()).state).toBe("available");
  expect(f.save).toHaveBeenCalled();
  f.controller.stop();
});
test("preview preferences are explicit; stable never receives prereleases by default", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    json([publication("1.1.0-alpha.1"), publication("1.0.0")]),
  );
  const service = new UpdateService("1.0.0", undefined, fetcher);
  expect((await service.check()).state).toBe("up-to-date");
  service.configure(true, true);
  const preview = await service.check();
  expect(preview.release?.version).toBe("1.1.0-alpha.1");
  expect(preview.release?.notes).toContain("<script>");
  expect(preview.delivery).toBe("blocked");
});
test("rate limiting honors Retry-After, including manual clicks and scheduler", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.fetcher.mockImplementation(
    async () =>
      new Response("{}", { status: 429, headers: { "retry-after": "3600" } }),
  );
  f.controller.start();
  await vi.advanceTimersByTimeAsync(20000);
  expect(f.controller.status().state).toBe("unavailable");
  await vi.advanceTimersByTimeAsync(120000);
  await f.controller.check();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(3480000);
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  f.controller.stop();
});
test("offline checks do not fetch and retry exponentially without declaring current", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>();
  const service = new UpdateService(version, undefined, fetcher, () => false);
  const controller = new UpdateController(
    service,
    defaultUpdateState(version),
    vi.fn(async () => {}),
    vi.fn(),
  );
  controller.start();
  await vi.advanceTimersByTimeAsync(20000);
  expect(controller.status().state).toBe("offline");
  const retry1 = Date.parse(controller.status().retryAt!);
  await vi.advanceTimersByTimeAsync(60000);
  expect(Date.parse(controller.status().retryAt!) - retry1).toBe(120000);
  expect(fetcher).not.toHaveBeenCalled();
  controller.stop();
});
test("concurrent scheduled/manual checks share work, publish progress and throttle repeated clicks", async () => {
  const f = fixture();
  const states: string[] = [];
  f.service.subscribe((s) => states.push(s.state));
  const first = f.controller.check();
  const second = f.controller.check();
  expect(first).toBe(second);
  await first;
  expect(states).toContain("checking");
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  await f.controller.check();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
test("invalid metadata, full ambiguous windows and HTML notes cannot become executable delivery", async () => {
  for (const body of [
    [publication("0.14.0", { html_url: "https://evil.example/setup.exe" })],
    [publication("0.14.0", { body: {} })],
  ]) {
    const f = fixture(body);
    expect((await f.controller.check()).state).toBe("error");
    expect(f.service.releaseUrl()).toBeUndefined();
  }
  const f = fixture(Array.from({ length: 20 }, () => publication("0.12.0")));
  expect((await f.controller.check()).state).toBe("unavailable");
});
test("failed persistence never acknowledges a changed preference", async () => {
  const f = fixture();
  f.save.mockRejectedValue(new Error("disk full"));
  await expect(
    f.controller.configure({ automatic: false, includePreviews: false }),
  ).rejects.toThrow();
  expect(f.controller.status().automatic).toBe(true);
  await f.controller.check();
  expect(f.controller.status().persistenceError).toContain(
    "could not be saved",
  );
});
test("stopping main scheduler aborts pending requests, prevents notifications and retries", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let aborted = false;
  f.fetcher.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(Error("cancelled"));
        });
      }),
  );
  f.controller.start();
  await vi.advanceTimersByTimeAsync(20000);
  f.controller.stop();
  await vi.advanceTimersByTimeAsync(86400000);
  expect(aborted).toBe(true);
  expect(f.notify).not.toHaveBeenCalled();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
});
