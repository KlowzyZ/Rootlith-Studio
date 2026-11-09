import { UpdateService } from "../../packages/core/updates";
import { officialLink } from "../../packages/core/project";
import { saveExport } from "./export-file";
import { app, BrowserWindow, ipcMain, dialog, net, shell } from "electron";
import path from "node:path";
import { productName } from "../../packages/core/identity";
import { mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  workflowSchema,
  nodeSchema,
  validate,
  target,
  diagnosticKinds,
} from "../../packages/schemas";
import { NativeStorage, atomicWrite } from "./native-storage";
import {
  recordsSchema,
  commitSchema,
} from "../../packages/core/native-contract";
import { diagnose } from "../../packages/diagnostics";
const here = path.dirname(fileURLToPath(import.meta.url));
const rendererFile = path.join(here, "../dist/index.html");
let win: BrowserWindow;
let approved = new Set<string>();
let active: AbortController | undefined;
let remaining = 0;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let authorizationEpoch = 0;
let closing = false;
let closeRequested = false;
const userDataArg = process.argv.find((a) => a.startsWith("--user-data-dir="));
if (userDataArg) {
  mkdirSync(path.resolve(userDataArg.slice("--user-data-dir=".length)), {
    recursive: true,
  });
  app.setPath(
    "userData",
    path.resolve(userDataArg.slice("--user-data-dir=".length)),
  );
} else {
  // Measured on packaged Alpha.2/Alpha.3: preserve this legacy per-user path.
  // Branding must never create, select or relocate a differently named profile.
  const legacyData = path.join(app.getPath("appData"), "fixflow-studio");
  mkdirSync(legacyData, { recursive: true });
  app.setPath("userData", legacyData);
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
const storage = new NativeStorage(
  path.join(app.getPath("userData"), "fixflow-data"),
);

function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame
  )
    throw Error("Untrusted sender");
  try {
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== "file:" || url.search || url.hash) throw Error();
    const canonical = (file: string) => {
      const actual = realpathSync(file);
      return process.platform === "win32" ? actual.toLowerCase() : actual;
    };
    if (canonical(fileURLToPath(url)) !== canonical(rendererFile))
      throw Error();
  } catch {
    throw Error("Untrusted sender");
  }
}

app
  .whenReady()
  .then(() => {
    if (!locked) return;
    win = new BrowserWindow({
      width: 1540,
      height: 1000,
      minWidth: 1000,
      minHeight: 680,
      backgroundColor: "#101417",
      title: productName,
      icon: path.join(here, "../dist/app-icon.png"),
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const updates = new UpdateService(app.getVersion(), undefined, fetch, () =>
      net.isOnline(),
    );
    ipcMain.handle("updates", async (event, action: unknown) => {
      trusted(event);
      if (action !== "status" && action !== "check")
        throw Error("Unsupported update action");
      const result =
        action === "check" ? await updates.check() : updates.status();
      return {
        ...result,
        runtime: {
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          chromium: process.versions.chrome,
          packaged: app.isPackaged,
        },
      };
    });
    ipcMain.handle("open-official-link", async (event, kind: unknown) => {
      trusted(event);
      await shell.openExternal(officialLink(kind, updates.releaseUrl()));
    });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== win.webContents.getURL()) event.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, cb) => cb(false),
    );
    win.loadFile(path.join(here, "../dist/index.html")).catch(() => {
      dialog.showErrorBox(
        `${productName} startup failed`,
        "The application interface could not be loaded. Reinstall the validation build; user data was preserved.",
      );
      app.quit();
    });
    app.on("second-instance", () => {
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    win.on("close", (event) => {
      if (closing) return;
      event.preventDefault();
      if (closeRequested) return;
      closeRequested = true;
      win.webContents.send("prepare-close");
      closeTimer = setTimeout(async () => {
        if (!closeRequested || closing) return;
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          message: "The interface has not responded to the close request.",
          detail:
            "Native writes will be drained before closing. Unconfirmed renderer changes may be lost.",
          buttons: ["Stay open", "Close application"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          await storage.drain();
          active?.abort();
          closing = true;
          win.destroy();
        } else closeRequested = false;
      }, 5000);
    });
    win.webContents.on("render-process-gone", () => {
      active?.abort();
      dialog.showErrorBox(
        `${productName} stopped`,
        "The interface stopped unexpectedly. Reopen the app to recover the latest native draft.",
      );
      closing = true;
      app.quit();
    });
    ipcMain.handle("storage-initialize", (event, input) => {
      trusted(event);
      return storage.initialize(recordsSchema.parse(input));
    });
    ipcMain.handle("storage-write", (event, input) => {
      trusted(event);
      const value = commitSchema.parse(input);
      return storage.write(value.revision, value.records);
    });
    ipcMain.handle("export-recovery", async (event) => {
      trusted(event);
      const choice = await dialog.showSaveDialog(win, {
        defaultPath: "rootlith-native-recovery.json",
        filters: [{ name: "JSON recovery", extensions: ["json"] }],
      });
      if (choice.canceled || !choice.filePath) return false;
      if (path.extname(choice.filePath).toLowerCase() !== ".json")
        throw Error("Choose a JSON recovery filename");
      await atomicWrite(choice.filePath, await storage.recovery());
      return true;
    });
    ipcMain.handle("export-file", async (event, input) => {
      trusted(event);
      return saveExport(
        input,
        (options) => dialog.showSaveDialog(win, options),
        atomicWrite,
      );
    });
    ipcMain.handle("finish-close", async (event, ok) => {
      trusted(event);
      if (typeof ok !== "boolean") throw Error("Invalid close response");
      if (!closeRequested) throw Error("Close was not requested");
      clearTimeout(closeTimer);
      await storage.drain();
      if (!ok) {
        const result = await dialog.showMessageBox(win, {
          type: "warning",
          message: "Some changes are not confirmed saved.",
          detail:
            "Stay open to save investigation notes or export recovery data. Closing without saving discards unsubmitted notes and may lose unconfirmed edits.",
          buttons: ["Stay open", "Close without saving"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) {
          closeRequested = false;
          return;
        }
      }
      if (active) {
        const result = await dialog.showMessageBox(win, {
          type: "question",
          message: "Cancel the active diagnostic and close?",
          buttons: ["Keep running", "Cancel and close"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) {
          closeRequested = false;
          return;
        }
      }
      authorizationEpoch++;
      approved.clear();
      active?.abort();
      closing = true;
      win.close();
    });
    ipcMain.handle("approve", async (event, input) => {
      trusted(event);
      const epoch = ++authorizationEpoch;
      approved.clear();
      active?.abort();
      const w = workflowSchema.parse(input);
      const errors = validate(w);
      if (errors.length) throw Error(errors.join("\n"));
      const nodes = w.nodes.filter((n) => diagnosticKinds.includes(n.kind));
      const result = await dialog.showMessageBox(win, {
        type: "question",
        title: "Approve diagnostic scope",
        message: "Allow these read-only diagnostics?",
        detail:
          nodes
            .map(
              (n) =>
                `${n.label}: ${n.kind === "interfaces" ? "local adapter information" : target(n)} (${n.config.timeout} ms)`,
            )
            .join("\n") +
          "\n\nOnly approve systems you own or are authorized to test. No redirects are followed. No repairs or shell commands.",
        buttons: ["Cancel", "Approve checks"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1 || epoch !== authorizationEpoch) return false;
      approved = new Set(nodes.map((n) => JSON.stringify(n)));
      remaining = 150;
      return true;
    });
    ipcMain.handle("diagnose", async (event, input) => {
      trusted(event);
      const n = nodeSchema.parse(input);
      if (!approved.has(JSON.stringify(n)) || remaining-- <= 0 || active)
        throw Error("Check not approved or already running");
      active = new AbortController();
      try {
        return await diagnose(n, active.signal);
      } finally {
        active = undefined;
      }
    });
    ipcMain.handle("cancel", (event) => {
      trusted(event);
      authorizationEpoch++;
      approved.clear();
      active?.abort();
      return true;
    });
  })
  .catch(() => {
    dialog.showErrorBox(
      `${productName} startup failed`,
      "Initialization failed. Existing application data was preserved.",
    );
    app.quit();
  });
app.on("window-all-closed", () => {
  active?.abort();
  app.quit();
});
