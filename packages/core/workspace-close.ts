// Main's active IPC tracks only individual probes, not native approval or guided
// questions. The renderer must fence the entire run before acknowledging close.
export async function prepareWorkspaceClose(options: {
  activeRun: () => boolean;
  blocked: () => boolean;
  unsavedForm: () => boolean;
  version: () => number;
  stage: () => void;
  drain: () => Promise<void>;
  flush: () => Promise<void>;
}): Promise<boolean> {
  if (options.activeRun() || options.blocked()) return false;
  const version = options.version();
  const unsaved = options.unsavedForm();
  try {
    options.stage();
    await options.drain();
    await options.flush();
    return (
      !options.activeRun() &&
      !options.blocked() &&
      !unsaved &&
      !options.unsavedForm() &&
      options.version() === version
    );
  } catch {
    return false;
  }
}
