const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fixflow", {
  updatePreferences: (settings) =>
    ipcRenderer.invoke("update-preferences", settings),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  updates: (action) => ipcRenderer.invoke("updates", action),
  openOfficialLink: (kind) => ipcRenderer.invoke("open-official-link", kind),
  approve: (workflow) => ipcRenderer.invoke("approve", workflow),
  diagnose: (node) => ipcRenderer.invoke("diagnose", node),
  cancel: () => ipcRenderer.invoke("cancel"),
  storageInitialize: (records) =>
    ipcRenderer.invoke("storage-initialize", records),
  storageWrite: (input) => ipcRenderer.invoke("storage-write", input),
  exportRecovery: () => ipcRenderer.invoke("export-recovery"),
  exportFile: (input) => ipcRenderer.invoke("export-file", input),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("prepare-close", listener);
    return () => ipcRenderer.removeListener("prepare-close", listener);
  },
  finishClose: (ok) => ipcRenderer.invoke("finish-close", ok),
});
