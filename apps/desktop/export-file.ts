import path from "node:path";
import { exportSchema } from "../../packages/core/native-contract";
// Caller must verify the IPC sender before entering this Save-dialog boundary.
export async function saveExport(
  input: unknown,
  choose: (options: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePath?: string }>,
  write: (path: string, content: string) => Promise<void>,
) {
  const value = exportSchema.parse(input);
  const extension = value.type === "text/html" ? ".html" : ".json";
  if (!value.name.endsWith(extension))
    throw Error("Export extension does not match format");
  const choice = await choose({
    defaultPath: value.name,
    filters: [
      {
        name: extension === ".html" ? "HTML report" : "JSON document",
        extensions: [extension.slice(1)],
      },
    ],
  });
  if (choice.canceled || !choice.filePath) return false;
  if (path.extname(choice.filePath).toLowerCase() !== extension)
    throw Error("Choose a filename with the matching export extension");
  await write(choice.filePath, value.content);
  return true;
}
