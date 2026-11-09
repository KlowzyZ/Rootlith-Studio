import { it, expect } from "vitest";
import http from "node:http";
import { diagnose } from "../packages/diagnostics";
import { template } from "../packages/core/templates";
it("uses HEAD, reports redirects without following, bounds and cancels requests", async () => {
  const methods: string[] = [];
  const server = http.createServer((req, res) => {
    methods.push(req.method!);
    if (req.url === "/wait") return;
    res.writeHead(302, { Location: "http://127.0.0.1:1/never-follow" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  const n = template().nodes.find((n) => n.kind === "http")!;
  n.config.url = `http://127.0.0.1:${address.port}`;
  try {
    const output = await diagnose(n, new AbortController().signal);
    expect(output.status).toBe(302);
    expect(methods).toEqual(["HEAD"]);
    n.config.url += "/wait";
    n.config.timeout = 100;
    expect((await diagnose(n, new AbortController().signal)).detail).toContain(
      "Timed out",
    );
    const c = new AbortController();
    const pending = diagnose(n, c.signal);
    c.abort();
    await expect(pending).rejects.toThrow("Cancelled");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
