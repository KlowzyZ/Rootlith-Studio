import os from "node:os";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { nodeSchema, type FlowNode, validHost } from "../schemas";
import type { Output } from "../workflow-engine";
export async function diagnose(
  input: FlowNode,
  signal: AbortSignal,
): Promise<Output> {
  const n = nodeSchema.parse(input);
  if (signal.aborted) throw Error("Cancelled");
  if (n.kind === "interfaces")
    return {
      ok: undefined,
      detail: JSON.stringify(
        os.networkInterfaces(),
        (key, value) => (key === "mac" ? "[withheld]" : value),
        2,
      ),
    };
  if (["dns", "tcp"].includes(n.kind) && !validHost(n.config.host || ""))
    throw Error("Invalid hostname");
  return new Promise<Output>((resolve, reject) => {
    let cleanup = () => {};
    let settled = false;
    const finish = (error: Error | null, output?: Output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      cleanup();
      if (error) reject(error);
      else resolve(output!);
    };
    const abort = () => finish(Error("Cancelled"));
    const timer = setTimeout(
      () =>
        finish(null, {
          ok: false,
          detail: `Timed out after ${n.config.timeout} ms. This does not establish a root cause.`,
        }),
      n.config.timeout,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (n.kind === "dns") {
      const resolver = new dns.Resolver();
      cleanup = () => resolver.cancel();
      resolver.resolve4(n.config.host!).then(
        (addresses) =>
          finish(null, {
            ok: addresses.length > 0,
            detail: `IPv4 DNS answers: ${addresses.join(", ")}. IPv6-only records are not checked.`,
          }),
        (e) =>
          finish(null, {
            ok: false,
            detail: `DNS: ${e.code || "resolution failed"}`,
          }),
      );
    } else if (n.kind === "tcp") {
      const socket = net.createConnection({
        host: n.config.host!,
        port: n.config.port!,
      });
      cleanup = () => socket.destroy();
      socket.once("connect", () =>
        finish(null, {
          ok: true,
          detail: "TCP connection accepted. Application health was not tested.",
        }),
      );
      socket.once("error", (e) =>
        finish(null, {
          ok: false,
          detail: `TCP: ${(e as NodeJS.ErrnoException).code || "connection failed"}`,
        }),
      );
    } else if (n.kind === "http") {
      let u: URL;
      try {
        u = new URL(n.config.url!);
        if (
          !["http:", "https:"].includes(u.protocol) ||
          u.username ||
          u.password ||
          u.search ||
          u.hash
        )
          throw Error();
      } catch {
        finish(Error("Invalid HTTP target"));
        return;
      }
      const req = (u.protocol === "https:" ? https : http).request(
        u,
        {
          method: "HEAD",
          headers: { "User-Agent": "FixFlow-Studio/0.1.0" },
          agent: false,
        },
        (res) => {
          const status = res.statusCode || 0;
          finish(null, {
            ok: status >= 200 && status < 400,
            status,
            detail: `HTTP ${status}${status >= 300 && status < 400 ? ". Redirect returned; destination was not followed or contacted." : ""}. HEAD only; no response body stored.`,
          });
          res.destroy();
        },
      );
      cleanup = () => req.destroy();
      req.once("error", (e) =>
        finish(null, {
          ok: false,
          detail: `HTTP: ${(e as NodeJS.ErrnoException).code || "request failed"}`,
        }),
      );
      req.end();
    } else finish(Error("Unsupported diagnostic"));
  });
}
