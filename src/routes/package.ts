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

interface PackageInfoOptions {
  includeWeeklyDownloads?: boolean;
  maxAdvisoryDetails?: number;
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

export async function packageInfo(
  ecosystemParam: string,
  nameParam: string,
  versionParam?: string,
  options?: PackageInfoOptions,
) {
  // No ecosystem means npm, the one agents ask about most; "latest" or an empty version means the latest release.
  const ecosystem = ecosystemParam.trim().toLowerCase() || "npm";
  const system = Object.hasOwn(SYSTEMS, ecosystem) ? SYSTEMS[ecosystem] : undefined;
  if (!system) throw new HttpError(400, `ecosystem must be one of: ${Object.keys(SYSTEMS).join(", ")}`);
  const name = nameParam.trim();
  if (!name || name.length > 214 || /\s/.test(name)) throw new HttpError(400, "name must be a package name without spaces");
  if (versionParam !== undefined && /^\s*(latest)?\s*$/i.test(versionParam)) versionParam = undefined;
  const requestedVersion = versionParam?.trim();
  if (
    versionParam !== undefined &&
    (!requestedVersion ||
      requestedVersion.length > 128 ||
      /[\s*^~<>|=,\[\]()]/.test(requestedVersion) ||
      ["next"].includes(requestedVersion.toLowerCase()))
  ) {
    throw new HttpError(400, "version must be an exact version, not a range or tag");
  }

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
      ...(requestedVersion ? { version: requestedVersion, versionExists: false, retrievedAt: new Date().toISOString() } : {}),
    };
  }

  const dated = pkg.versions.filter((v) => v.publishedAt).sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!));
  const latest = pkg.versions.find((v) => v.isDefault) ?? dated[dated.length - 1] ?? pkg.versions[pkg.versions.length - 1];
  const versionInPackageList = requestedVersion
    ? pkg.versions.find((v) => v.versionKey.version === requestedVersion)
    : latest;
  const selectedVersion = requestedVersion ?? latest.versionKey.version;
  const includeWeeklyDownloads = options?.includeWeeklyDownloads !== false;
  const [version, downloads] = await Promise.all([
    deps<Version>(`systems/${system}/packages/${enc(name)}/versions/${enc(selectedVersion)}`),
    system === "npm" && includeWeeklyDownloads ? npmWeeklyDownloads(name) : Promise.resolve(null),
  ]);
  if (requestedVersion && !version) {
    return {
      ecosystem: system,
      name,
      exists: true,
      version: requestedVersion,
      versionExists: false,
      latestVersion: latest.versionKey.version,
      verdict: "not-found",
      flags: ["version-not-found"],
      note: `Exact version ${requestedVersion} is not listed by deps.dev.`,
      source: "deps.dev",
      retrievedAt: new Date().toISOString(),
      ...(system === "npm" && !includeWeeklyDownloads
        ? { weeklyDownloads: null, weeklyDownloadsStatus: "not-fetched-subrequest-budget" }
        : {}),
    };
  }

  const advisoryIds = (version?.advisoryKeys ?? []).map((a) => a.id);
  const advisoryDetailLimit = Math.max(0, Math.min(5, options?.maxAdvisoryDetails ?? 5));
  const advisoryIdsToFetch = advisoryIds.slice(0, advisoryDetailLimit);
  const fetchedAdvisories = await Promise.all(
    advisoryIdsToFetch.map(async (id) => ({ id, detail: await deps<Advisory>(`advisories/${enc(id)}`).catch(() => null) })),
  );
  const advisoryDetailsUnavailable = fetchedAdvisories.filter(({ detail }) => detail === null).length;
  const advisories = fetchedAdvisories.map(({ id, detail }) => ({
    id,
    title: detail?.title ?? null,
    cvss: detail?.cvss3Score ?? null,
    aliases: detail?.aliases ?? [],
    url: detail?.url ?? `https://osv.dev/vulnerability/${id}`,
  }));

  const ageDays = daysSince(dated[0]?.publishedAt);
  const lastReleaseDays = daysSince(latest.publishedAt ?? dated[dated.length - 1]?.publishedAt);
  const deprecated = Boolean(version?.isDeprecated ?? versionInPackageList?.isDeprecated);
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
    ...(options
      ? {
          advisoryIds,
          advisoryDetailsStatus:
            advisoryDetailsUnavailable > 0
              ? "partial"
              : advisoryIds.length <= advisoryIdsToFetch.length
                ? "complete"
                : advisoryDetailLimit === 0
                  ? "not-fetched-subrequest-budget"
                  : "partial",
          advisoryDetailsOmitted: advisoryIds.length - advisoryIdsToFetch.length,
          advisoryDetailsUnavailable,
          ...(system === "npm" && !includeWeeklyDownloads
            ? { weeklyDownloadsStatus: "not-fetched-subrequest-budget" }
            : {}),
        }
      : {}),
    ...(requestedVersion
      ? {
          version: requestedVersion,
          versionExists: true,
          versionPublishedAt: versionInPackageList?.publishedAt ?? null,
          advisoryIds,
          knownVulnerabilityCountSources: ["deps.dev"],
          retrievedAt: new Date().toISOString(),
        }
      : {}),
    repository: link("SOURCE_REPO"),
    homepage: link("HOMEPAGE"),
    source: "deps.dev",
  };
}
