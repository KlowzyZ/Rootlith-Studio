// Public source repository; install/profile identifiers are unchanged.
export const repositoryNames = ["KlowzyZ/Rootlith-Studio"] as const;
export const currentRepository = repositoryNames[0];
export const websiteUrl = "https://klowzy.com/";
export const repositoryUrl = `https://github.com/${currentRepository}`;
export type OfficialLink = "website" | "repository" | "releases" | "release";
export function isOfficialReleaseUrl(value: string): boolean {
  if (value.length > 256) return false;
  try {
    const url = new URL(value);
    return (
      url.origin === "https://github.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      repositoryNames.some((name) =>
        url.pathname.startsWith(`/${name}/releases/tag/`),
      ) &&
      /^\/KlowzyZ\/Rootlith-Studio\/releases\/tag\/v?(?:[0-9A-Za-z.+-]|%2[Bb])+$/.test(
        url.pathname,
      ) &&
      value === url.href
    );
  } catch {
    return false;
  }
}
export function officialLink(kind: unknown, verifiedRelease?: string): string {
  if (kind === "website") return websiteUrl;
  if (kind === "repository") return repositoryUrl;
  if (kind === "releases") return `${repositoryUrl}/releases`;
  if (
    kind === "release" &&
    verifiedRelease &&
    isOfficialReleaseUrl(verifiedRelease)
  )
    return verifiedRelease;
  throw Error("Unsupported or unverified official link.");
}
