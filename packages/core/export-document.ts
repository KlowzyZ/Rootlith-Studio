export type ExportOutcome = "saved" | "cancelled" | "downloaded";
// Resolve only after the native Save boundary acknowledges; cancellation is distinct.
export async function exportDocument(
  name: string,
  content: string,
  type = "application/json",
): Promise<ExportOutcome> {
  if (window.fixflow) {
    const extension = type === "text/html" ? ".html" : ".json";
    const base = name.endsWith(extension)
      ? name.slice(0, -extension.length)
      : name;
    return (await window.fixflow.exportFile({
      name:
        base
          .replace(/[^a-zA-Z0-9 _.-]/g, "_")
          .slice(0, 120 - extension.length) + extension,
      content,
      type: type === "text/html" ? "text/html" : "application/json",
    }))
      ? "saved"
      : "cancelled";
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
