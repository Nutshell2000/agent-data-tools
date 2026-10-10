import { HttpError } from "../lib/env";

// deps.dev (Google Open Source Insights): free, keyless, data under CC-BY 4.0.
const DEPS = "https://api.deps.dev/v3";
const SYSTEMS: Record<string, string> = { npm: "npm", pypi: "pypi", cargo: "cargo", go: "go", maven: "maven", nuget: "nuget" };
const DAY = 86_400_000;

async function deps<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${DEPS}/${path}`, { signal: AbortSignal.timeout(8_000), headers: { "user-agent": "AgentDataTools/1.0" } });
  } catch {
    throw new HttpError(502, "the package data source did not respond");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `the package data source returned HTTP ${res.status}`);
  return res.json();
}

interface Pkg {
  versions: { versionKey: { version: string }; publishedAt?: string; isDefault?: boolean; isDeprecated?: boolean }[];
}
interface Version {
  licenses?: string[];
  advisoryKeys?: { id: string }[];
  links?: { label: string; url: string }[];
  isDeprecated?: boolean;
}
interface Advisory {
  title?: string;
  cvss3Score?: number;
  aliases?: string[];
  url?: string;
}

const enc = encodeURIComponent;
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);

async function npmWeeklyDownloads(name: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? ((await res.json()) as { downloads?: number }).downloads ?? null : null;
  } catch {
    return null;
  }
}

export async function packageInfo(ecosystemParam: string, nameParam: string) {
  const system = SYSTEMS[ecosystemParam.trim().toLowerCase()];
  if (!system) throw new HttpError(400, `ecosystem must be one of: ${Object.keys(SYSTEMS).join(", ")}`);
  const name = nameParam.trim();
  if (!name || name.length > 214 || /\s/.test(name)) throw new HttpError(400, "name must be a package name without spaces");

  const pkg = await deps<Pkg>(`systems/${system}/packages/${enc(name)}`);
  if (!pkg?.versions?.length) {
    // "It doesn't exist" is the answer the caller paid for, so this is a normal result.
    return {
      ecosystem: system,
      name,
      exists: false,
      verdict: "not-found",
      flags: ["not-found"],
      note: "No package with this name is published. If an AI model suggested it, the name may be invented; do not install a look-alike.",
      source: "deps.dev",
    };
  }

  const dated = pkg.versions.filter((v) => v.publishedAt).sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
  const latest = pkg.versions.find((v) => v.isDefault) ?? dated[dated.length - 1] ?? pkg.versions[pkg.versions.length - 1];
  const [version, downloads] = await Promise.all([
    deps<Version>(`systems/${system}/packages/${enc(name)}/versions/${enc(latest.versionKey.version)}`),
    system === "npm" ? npmWeeklyDownloads(name) : Promise.resolve(null),
  ]);

  const advisoryIds = (version?.advisoryKeys ?? []).map((a) => a.id);
  const advisories = (
    await Promise.all(advisoryIds.slice(0, 5).map(async (id) => ({ id, detail: await deps<Advisory>(`advisories/${enc(id)}`).catch(() => null) })))
  ).map(({ id, detail }) => ({
    id,
    title: detail?.title ?? null,
    cvss: detail?.cvss3Score ?? null,
    aliases: detail?.aliases ?? [],
    url: detail?.url ?? `https://osv.dev/vulnerability/${id}`,
  }));

  const ageDays = daysSince(dated[0]?.publishedAt);
  const lastReleaseDays = daysSince(latest.publishedAt ?? dated[dated.length - 1]?.publishedAt);
  const deprecated = Boolean(version?.isDeprecated ?? latest.isDeprecated);
  const flags = [
    ageDays !== null && ageDays < 30 && "very-new",
    pkg.versions.length < 3 && "few-versions",
    downloads !== null && downloads < 500 && "low-downloads",
    advisoryIds.length > 0 && "known-vulnerabilities",
    deprecated && "deprecated",
    lastReleaseDays !== null && lastReleaseDays > 730 && "stale",
  ].filter((f): f is string => Boolean(f));

  const link = (label: string) => version?.links?.find((l) => l.label === label)?.url ?? null;
  return {
    ecosystem: system,
    name,
    exists: true,
    // "caution" means look before installing, not that the package is malicious.
    verdict: flags.length ? "caution" : "ok",
    flags,
    latestVersion: latest.versionKey.version,
    latestPublishedAt: latest.publishedAt ?? null,
    daysSinceLatestRelease: lastReleaseDays,
    firstPublishedAt: dated[0]?.publishedAt ?? null,
    ageDays,
    versionCount: pkg.versions.length,
    weeklyDownloads: downloads,
    licenses: version?.licenses ?? [],
    deprecated,
    knownVulnerabilities: advisoryIds.length,
    advisories,
    repository: link("SOURCE_REPO"),
    homepage: link("HOMEPAGE"),
    source: "deps.dev",
  };
}
