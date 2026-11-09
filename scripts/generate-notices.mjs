import fs from "node:fs";
import path from "node:path";
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
let output =
  "# Third-party notices\n\nGenerated from the lockfile. Runtime dependency license texts follow. Electron also distributes LICENSE.electron.txt and LICENSES.chromium.html with the executable. Build-tool licenses remain in their npm packages.\n\n";
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev) continue;
  const metadata = JSON.parse(
    fs.readFileSync(path.join(location, "package.json"), "utf8"),
  );
  output += `## ${metadata.name} ${metadata.version}\n\nLicense: ${metadata.license || "REVIEW REQUIRED"}\n\n`;
  const files = fs
    .readdirSync(location)
    .filter((f) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(f));
  for (const file of files) {
    if (!fs.statSync(path.join(location, file)).isFile()) continue;
    output +=
      "```text\n" +
      fs.readFileSync(path.join(location, file), "utf8") +
      "\n```\n\n";
  }
}
fs.writeFileSync("THIRD_PARTY_NOTICES.md", output.trimEnd()+"\n");
