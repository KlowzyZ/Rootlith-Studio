import type { UpdateStatus } from "./updates";
import type { OfficialLink } from "./project";
import { useStoragePort, storageKeys } from "./storage";
import {
  emptyRecords,
  type Records,
  type NativeSnapshot,
} from "./native-contract";
import type { Workflow, FlowNode } from "../schemas";
import type { Output } from "../workflow-engine";
export type ExportRequest = {
  name: string;
  content: string;
  type: "application/json" | "text/html";
};
export interface DesktopBridge {
  updatePreferences(settings: {
    automatic: boolean;
    includePreviews: boolean;
  }): Promise<UpdateStatus>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  updates(action: "status" | "check"): Promise<UpdateStatus>;
  openOfficialLink(kind: OfficialLink): Promise<void>;
  approve(w: Workflow): Promise<boolean>;
  diagnose(n: FlowNode): Promise<Output>;
  cancel(): Promise<boolean>;
  storageInitialize(records: Records): Promise<NativeSnapshot>;
  storageWrite(input: {
    revision: number;
    records: Records;
  }): Promise<NativeSnapshot>;
  exportRecovery(): Promise<boolean>;
  exportFile(input: ExportRequest): Promise<boolean>;
  onCloseRequested(callback: () => void): () => void;
  finishClose(ok: boolean): Promise<void>;
}
declare global {
  interface Window {
    fixflow?: DesktopBridge;
  }
}
let records = emptyRecords(),
  revision = 0,
  generation = 0,
  ack = 0;
let pending: Promise<void> | undefined;
let failure: Error | undefined;
export async function initializeDesktop() {
  if (!window.fixflow) {
    if (navigator.userAgent.includes("Electron/"))
      throw Error(
        "The native bridge did not initialize. Desktop diagnostics and storage are unavailable; simulated browser results have been disabled.",
      );
    return "";
  }
  const legacy = emptyRecords();
  for (const key of Object.values(storageKeys))
    legacy[key] = localStorage.getItem(key);
  const state = await window.fixflow.storageInitialize(legacy);
  records = state.records;
  revision = state.revision;
  useStoragePort({
    getItem: (key) => records[key as keyof Records] ?? null,
    setItem: (key, value) => {
      if (!(key in records)) throw Error("Unsupported storage key");
      records[key as keyof Records] = value;
      generation++;
    },
    removeItem: (key) => {
      if (!(key in records)) throw Error("Unsupported storage key");
      records[key as keyof Records] = null;
      generation++;
    },
  });
  // Native commit has succeeded before touching old browser records. The main process retained the untouched migration copy.
  if (state.migrated) {
    for (const key of Object.values(storageKeys)) localStorage.removeItem(key);
  }
  return state.notice;
}
export async function flushDesktop(): Promise<void> {
  if (!window.fixflow) return;
  // Every caller fences the current generation, including edits queued between
  // the drain loop finishing and its shared promise's finally handler.
  for (;;) {
    if (failure) throw failure;
    if (!pending && ack >= generation) return;
    if (!pending)
      pending = (async () => {
        while (ack < generation) {
          const sent = generation;
          const snapshot = structuredClone(records);
          const state = await window.fixflow!.storageWrite({
            revision,
            records: snapshot,
          });
          revision = state.revision;
          ack = sent;
          for (const key of Object.values(storageKeys))
            if (records[key] === snapshot[key])
              records[key] = state.records[key];
        }
      })()
        .catch((e) => {
          failure = e instanceof Error ? e : Error("Native save failed");
          throw failure;
        })
        .finally(() => {
          pending = undefined;
        });
    await pending;
  }
}
