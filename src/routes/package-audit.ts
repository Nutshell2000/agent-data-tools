import { HttpError } from "../lib/env";
import { packageInfo } from "./package";

const MAX_PACKAGES = 10;
const MAX_OSV_ADVISORIES_PER_PACKAGE = 10;
const MAX_OSV_DETAILS = 15;
const MAX_EPSS_CVES = 50;
const MAX_CONCURRENT_FETCHES = 6;
const OSV = "https://api.osv.dev/v1";
const EPSS = "https://api.first.org/data/v1/epss";
const OSV_ECOSYSTEMS: Record<string, string> = {
  npm: "npm",
  pypi: "PyPI",
  cargo: "crates.io",
  go: "Go",
  maven: "Maven",
  nuget: "NuGet",
};

interface PackageSpec {
  ecosystem: string;
  name: string;
  version?: string;
}

interface OsvStub {
  id: string;
  modified?: string;
}

interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

interface OsvAffected {
  package?: { ecosystem?: string; name?: string; purl?: string };
  ranges?: { type?: string; events?: OsvEvent[] }[];
}

interface FixedVersionRange {
  type: string | null;
  events: OsvEvent[];
  fixedVersions: string[];
}

interface OsvAdvisory {
  id: string;
  source: "OSV";
  sourceUrl: string;
  retrievedAt: string | null;
  detailStatus: "available" | "unavailable" | "not-fetched-limit";
  modified: string | null;
  published: string | null;
  aliases: string[];
  summary: string | null;
  rangeStatus: "reported" | "not-reported" | "package-not-matched" | "unavailable";
  fixedVersionRanges: FixedVersionRange[] | null;
  epss?: AdvisoryEpss;
}

interface VersionAdvisoryLookup {
  source: "OSV";
  status: "complete" | "partial" | "unavailable" | "not-queried";
  retrievedAt: string | null;
  advisoryCount: number | null;
  vulnerabilities: OsvAdvisory[] | null;
  omittedAdvisories?: number;
  detailsNotFetched?: number;
  note: string;
}

interface EpssScore {
  cve: string;
  status: "available" | "partial" | "not-returned" | "unavailable" | "omitted-limit";
  score: number | null;
  percentile: number | null;
  date: string | null;
}

interface AdvisoryEpss {
  source: "FIRST EPSS";
  status: "complete" | "partial" | "unavailable" | "not-applicable" | "not-queried";
  sourceStatus: "available" | "unavailable" | "not-queried";
  retrievedAt: string | null;
  scores: EpssScore[];
  note: string;
}

interface EpssLookupSummary {
  source: "FIRST EPSS";
  status: "complete" | "partial" | "unavailable" | "not-queried" | "not-applicable";
  sourceStatus: "available" | "unavailable" | "not-queried";
  retrievedAt: string | null;
  requestedCves: number;
  queriedCves: number;
  returnedScores: number | null;
  omittedCves: number;
  uninspectedAdvisoryDetails: number;
  malformedRows: number;
  note: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSpec(item: string): PackageSpec {
  const colon = item.indexOf(":");
  if (colon < 1 || colon === item.length - 1) {
    throw new HttpError(400, `"${item}" must look like ecosystem:name or ecosystem:name@version`);
  }

  const ecosystem = item.slice(0, colon).trim().toLowerCase();
  if (!OSV_ECOSYSTEMS[ecosystem]) {
    throw new HttpError(400, `ecosystem must be one of: ${Object.keys(OSV_ECOSYSTEMS).join(", ")}`);
  }
  const packageAndVersion = item.slice(colon + 1).trim();
  const versionSeparator = packageAndVersion.lastIndexOf("@");
  const hasVersion = versionSeparator > 0;
  const name = (hasVersion ? packageAndVersion.slice(0, versionSeparator) : packageAndVersion).trim();
  const version = hasVersion ? packageAndVersion.slice(versionSeparator + 1).trim() : undefined;
  if (!name) throw new HttpError(400, `"${item}" must include a package name`);
  if (
    version !== undefined &&
    (!version ||
      version.length > 128 ||
      /[\s*^~<>|=,\[\]()]/.test(version) ||
      ["latest", "next"].includes(version.toLowerCase()))
  ) {
    throw new HttpError(400, `"${item}" must use an exact version, not a range or tag`);
  }
  return { ecosystem, name, ...(version ? { version } : {}) };
}

function parseBatchResults(value: unknown, expectedCount: number): OsvStub[][] | null {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length !== expectedCount) return null;
  const parsed: OsvStub[][] = [];
  for (const result of value.results) {
    if (!isRecord(result)) return null;
    const vulnerabilities = result.vulns ?? [];
    if (!Array.isArray(vulnerabilities)) return null;
    const stubs: OsvStub[] = [];
    for (const vulnerability of vulnerabilities) {
      if (!isRecord(vulnerability) || typeof vulnerability.id !== "string" || !vulnerability.id) return null;
      stubs.push({
        id: vulnerability.id,
        ...(typeof vulnerability.modified === "string" ? { modified: vulnerability.modified } : {}),
      });
    }
    parsed.push(stubs);
  }
  return parsed;
}

async function queryOsv(specs: PackageSpec[]): Promise<{ retrievedAt: string; results: OsvStub[][] } | null> {
  try {
    const response = await fetch(`${OSV}/querybatch`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        queries: specs.map((spec) => ({
          package: { ecosystem: OSV_ECOSYSTEMS[spec.ecosystem], name: spec.name },
          version: spec.version,
        })),
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const results = parseBatchResults(await response.json(), specs.length);
    return results ? { retrievedAt: new Date().toISOString(), results } : null;
  } catch {
    return null;
  }
}

function unavailableAdvisory(id: string, modified?: string, detailStatus: "unavailable" | "not-fetched-limit" = "unavailable"): OsvAdvisory {
  return {
    id,
    source: "OSV",
    sourceUrl: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
    retrievedAt: detailStatus === "not-fetched-limit" ? null : new Date().toISOString(),
    detailStatus,
    modified: modified ?? null,
    published: null,
    aliases: [],
    summary: null,
    rangeStatus: "unavailable",
    fixedVersionRanges: null,
  };
}

function affectedMatches(affected: OsvAffected, spec: PackageSpec): boolean {
  const expectedEcosystem = OSV_ECOSYSTEMS[spec.ecosystem];
  return (
    typeof affected.package?.ecosystem === "string" &&
    affected.package.ecosystem.toLowerCase() === expectedEcosystem.toLowerCase() &&
    typeof affected.package.name === "string" &&
    affected.package.name.toLowerCase() === spec.name.toLowerCase()
  );
}

async function fetchOsvAdvisory(id: string, modified: string | undefined, spec: PackageSpec): Promise<OsvAdvisory> {
  try {
    const response = await fetch(`${OSV}/vulns/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return unavailableAdvisory(id, modified);
    const value: unknown = await response.json();
    if (!isRecord(value) || value.id !== id) return unavailableAdvisory(id, modified);

    const affected = Array.isArray(value.affected) ? value.affected.filter(isRecord) as OsvAffected[] : [];
    const matching = affected.filter((entry) => affectedMatches(entry, spec));
    const relevantRanges = matching.flatMap((entry) =>
      Array.isArray(entry.ranges) ? entry.ranges.filter(isRecord) as { type?: string; events?: OsvEvent[] }[] : [],
    );
    const hasRanges = relevantRanges.length > 0;
    const fixedVersionRanges = hasRanges
      ? relevantRanges.map((range) => {
          const events = Array.isArray(range.events) ? range.events.filter(isRecord) as OsvEvent[] : [];
          return {
            type: typeof range.type === "string" ? range.type : null,
            events,
            fixedVersions: [...new Set(events.flatMap((event) => (typeof event.fixed === "string" ? [event.fixed] : [])))],
          };
        })
      : null;
    const aliases = Array.isArray(value.aliases) ? value.aliases.filter((alias): alias is string => typeof alias === "string") : [];

    return {
      id,
      source: "OSV",
      sourceUrl: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
      retrievedAt: new Date().toISOString(),
      detailStatus: "available",
      modified: typeof value.modified === "string" ? value.modified : modified ?? null,
      published: typeof value.published === "string" ? value.published : null,
      aliases,
      summary: typeof value.summary === "string" ? value.summary : null,
      rangeStatus: matching.length === 0 ? "package-not-matched" : hasRanges ? "reported" : "not-reported",
      fixedVersionRanges,
    };
  } catch {
    return unavailableAdvisory(id, modified);
  }
}

async function withConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await run(items[index]);
      }
    }),
  );
}

async function versionAdvisories(
  specs: PackageSpec[],
): Promise<{ lookup: VersionAdvisoryLookup; advisoryIds: string[] | null }[]> {
  const batch = await queryOsv(specs);
  if (!batch) {
    const retrievedAt = new Date().toISOString();
    return specs.map(() => ({
      advisoryIds: null,
      lookup: {
        source: "OSV",
        status: "unavailable",
        retrievedAt,
        advisoryCount: null,
        vulnerabilities: null,
        note: "OSV did not return an exact-version advisory result; advisory status is unknown.",
      },
    }));
  }

  const perSpec = batch.results.map((stubs) => [...new Map(stubs.map((stub) => [stub.id, stub])).values()]);
  const selectedBySpec = perSpec.map((stubs) => stubs.slice(0, MAX_OSV_ADVISORIES_PER_PACKAGE));
  const detailCandidates = selectedBySpec
    .flatMap((stubs, specIndex) => stubs.map((stub, advisoryIndex) => ({ ...stub, specIndex, advisoryIndex })))
    .sort((a, b) => a.advisoryIndex - b.advisoryIndex || a.specIndex - b.specIndex);
  const detailTasks = detailCandidates
    .slice(0, MAX_OSV_DETAILS);
  const fetchedDetails = new Map<string, OsvAdvisory>();
  await withConcurrency(detailTasks, MAX_CONCURRENT_FETCHES, async (task) => {
    fetchedDetails.set(
      `${task.specIndex}:${task.id}`,
      await fetchOsvAdvisory(task.id, task.modified, specs[task.specIndex]),
    );
  });

  return selectedBySpec.map((stubs, index) => {
    const vulnerabilities = stubs.map(
      (stub) =>
        fetchedDetails.get(`${index}:${stub.id}`) ?? unavailableAdvisory(stub.id, stub.modified, "not-fetched-limit"),
    );
    const omittedAdvisories = perSpec[index].length - stubs.length;
    const detailsNotFetched = vulnerabilities.filter((advisory) => advisory.detailStatus === "not-fetched-limit").length;
    const incomplete =
      omittedAdvisories > 0 ||
      detailsNotFetched > 0 ||
      vulnerabilities.some(
        (advisory) => advisory.detailStatus !== "available" || advisory.rangeStatus === "package-not-matched",
      );
    return {
      advisoryIds: perSpec[index].map((stub) => stub.id),
      lookup: {
        source: "OSV",
        status: incomplete ? "partial" : "complete",
        retrievedAt: batch.retrievedAt,
        advisoryCount: perSpec[index].length,
        vulnerabilities,
        ...(omittedAdvisories ? { omittedAdvisories } : {}),
        ...(detailsNotFetched ? { detailsNotFetched } : {}),
        note: incomplete
          ? "Some exact-version advisory details could not be returned or were omitted by the per-request limit; batch IDs and counts remain available. Review detailStatus and detailsNotFetched."
          : vulnerabilities.length === 0
            ? "No matching OSV advisories were returned for this exact version; this is not a safety determination."
            : "OSV advisories are matched to this exact package version.",
      },
    };
  });
}

function probability(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

function cveAliases(advisory: OsvAdvisory): string[] {
  return [...new Set([advisory.id, ...advisory.aliases]
    .filter((alias) => /^CVE-\d{4}-\d+$/i.test(alias))
    .map((alias) => alias.toUpperCase()))];
}

function parseEpssResponse(
  value: unknown,
  requested: Set<string>,
): { scores: Map<string, EpssScore>; malformedRows: number } | null {
  if (!isRecord(value) || value.status !== "OK" || !Array.isArray(value.data)) return null;
  const scores = new Map<string, EpssScore>();
  let malformedRows = 0;
  for (const row of value.data) {
    if (!isRecord(row) || typeof row.cve !== "string") {
      malformedRows++;
      continue;
    }
    const cve = row.cve.toUpperCase();
    if (!requested.has(cve)) {
      malformedRows++;
      continue;
    }
    const score = probability(row.epss);
    if (score === null) {
      malformedRows++;
      continue;
    }
    if (scores.has(cve)) continue;
    const percentile = probability(row.percentile);
    const date =
      typeof row.date === "string" && Number.isFinite(Date.parse(row.date)) ? row.date : null;
    const partial = percentile === null || date === null;
    if (partial) malformedRows++;
    scores.set(cve, {
      cve,
      status: partial ? "partial" : "available",
      score,
      percentile,
      date,
    });
  }
  return { scores, malformedRows };
}

async function fetchEpss(
  cves: string[],
): Promise<{ retrievedAt: string; response: { scores: Map<string, EpssScore>; malformedRows: number } | null }> {
  const retrievedAt = () => new Date().toISOString();
  try {
    const url = new URL(EPSS);
    url.searchParams.set("cve", cves.join(","));
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    const receivedAt = retrievedAt();
    if (!response.ok) return { retrievedAt: receivedAt, response: null };
    const parsed = parseEpssResponse(await response.json(), new Set(cves));
    return { retrievedAt: receivedAt, response: parsed };
  } catch {
    return { retrievedAt: retrievedAt(), response: null };
  }
}

function uninspectedOsvDetails(results: Record<string, unknown>[]): number {
  return results.reduce((total, result) => {
    const lookup = result.versionAdvisories as VersionAdvisoryLookup | undefined;
    const unavailableDetails = lookup?.vulnerabilities?.filter((advisory) => advisory.detailStatus !== "available").length ?? 0;
    return total + unavailableDetails + (lookup?.omittedAdvisories ?? 0);
  }, 0);
}

async function enrichWithEpss(results: Record<string, unknown>[]): Promise<EpssLookupSummary> {
  const references: { advisory: OsvAdvisory; cves: string[] }[] = [];
  for (const result of results) {
    const lookup = result.versionAdvisories as VersionAdvisoryLookup | undefined;
    for (const advisory of lookup?.vulnerabilities ?? []) {
      references.push({ advisory, cves: cveAliases(advisory) });
    }
  }

  const allCves = [...new Set(references.flatMap(({ cves }) => cves))];
  const uninspectedAdvisoryDetails = uninspectedOsvDetails(results);
  if (allCves.length === 0) {
    const sourceIncomplete = results.some((result) => {
      const lookup = result.versionAdvisories as VersionAdvisoryLookup | undefined;
      return lookup !== undefined && lookup.status !== "complete";
    });
    const status = sourceIncomplete ? "not-queried" : "not-applicable";
    const note = sourceIncomplete
      ? `No CVE aliases were available because exact-version advisory data was incomplete; EPSS was not queried. ${uninspectedAdvisoryDetails} OSV advisory detail(s) could not be inspected.`
      : "No CVE aliases were present in the exact-version OSV advisories; EPSS was not applicable.";
    for (const { advisory } of references) {
      const detailIncomplete = advisory.detailStatus !== "available";
      advisory.epss = {
        source: "FIRST EPSS",
        status: detailIncomplete ? "not-queried" : "not-applicable",
        sourceStatus: "not-queried",
        retrievedAt: null,
        scores: [],
        note: detailIncomplete
          ? "OSV advisory detail was not inspected; CVE aliases and EPSS scores are unknown."
          : note,
      };
    }
    return {
      source: "FIRST EPSS",
      status,
      sourceStatus: "not-queried",
      retrievedAt: null,
      requestedCves: 0,
      queriedCves: 0,
      returnedScores: 0,
      omittedCves: 0,
      uninspectedAdvisoryDetails,
      malformedRows: 0,
      note,
    };
  }

  const queriedCves = allCves.slice(0, MAX_EPSS_CVES);
  const queried = new Set(queriedCves);
  const omittedCves = allCves.length - queriedCves.length;
  const fetched = await fetchEpss(queriedCves);
  const response = fetched.response;
  const returnedScores = response
    ? [...response.scores.values()].filter((score) => score.score !== null).length
    : null;
  const missingScores = response
    ? queriedCves.filter((cve) => !response.scores.has(cve)).length
    : 0;
  const incomplete =
    omittedCves > 0 ||
    uninspectedAdvisoryDetails > 0 ||
    (response !== null &&
      (response.malformedRows > 0 ||
        missingScores > 0 ||
        [...response.scores.values()].some((score) => score.status !== "available")));
  const sourceStatus = response === null ? "unavailable" : "available";
  const status =
    response === null
      ? incomplete
        ? "partial"
        : "unavailable"
      : incomplete
        ? "partial"
        : "complete";
  const note =
    status === "unavailable"
      ? `FIRST EPSS was unavailable or returned malformed data; scores are unknown, not zero. ${uninspectedAdvisoryDetails} OSV advisory detail(s) could not be inspected. EPSS estimates 30-day exploitation probability, not package safety.`
      : status === "partial"
        ? `${response === null ? "FIRST EPSS was unavailable" : "FIRST EPSS returned incomplete data"}; ${uninspectedAdvisoryDetails} OSV advisory detail(s) could not be inspected, ${omittedCves} CVE alias(es) were omitted by the ${MAX_EPSS_CVES}-CVE limit, and ${missingScores} queried alias(es) had no score. Missing scores are unknown, not zero. EPSS estimates 30-day exploitation probability, not package safety.`
        : "FIRST EPSS estimates 30-day exploitation probability, not package safety.";

  for (const { advisory, cves } of references) {
    const scores = cves.map((cve): EpssScore => {
      if (!queried.has(cve)) {
        return { cve, status: "omitted-limit", score: null, percentile: null, date: null };
      }
      if (!response) {
        return { cve, status: "unavailable", score: null, percentile: null, date: null };
      }
      return (
        response.scores.get(cve) ?? {
          cve,
          status: "not-returned",
          score: null,
          percentile: null,
          date: null,
        }
      );
    });
    const detailIncomplete = advisory.detailStatus !== "available";
    const advisorySourceStatus = scores.length === 0
      ? "not-queried"
      : response === null
        ? "unavailable"
        : "available";
    const scoreCoverageIncomplete = scores.some((score) =>
      ["partial", "not-returned", "omitted-limit"].includes(score.status),
    );
    const hasUnavailableScore = scores.some((score) => score.status === "unavailable");
    const advisoryStatus = scores.length === 0
      ? detailIncomplete
        ? "not-queried"
        : "not-applicable"
      : detailIncomplete || scoreCoverageIncomplete
        ? "partial"
        : hasUnavailableScore
        ? "unavailable"
        : "complete";
    advisory.epss = {
      source: "FIRST EPSS",
      status: advisoryStatus,
      sourceStatus: advisorySourceStatus,
      retrievedAt: fetched.retrievedAt,
      scores,
      note: scores.length
        ? `EPSS estimates 30-day exploitation probability for CVE aliases; it is not a package-safety guarantee. Null scores are unknown, not zero.${detailIncomplete ? " OSV detail was incomplete, so additional CVE aliases may be unknown." : ""}`
        : detailIncomplete
          ? "OSV advisory detail was not inspected; CVE aliases and EPSS scores are unknown."
          : "No CVE alias was present for this advisory.",
    };
  }

  return {
    source: "FIRST EPSS",
    status,
    sourceStatus,
    retrievedAt: fetched.retrievedAt,
    requestedCves: allCves.length,
    queriedCves: queriedCves.length,
    returnedScores,
    omittedCves,
    uninspectedAdvisoryDetails,
    malformedRows: response?.malformedRows ?? 0,
    note,
  };
}

/** Audits a whole dependency list in one call. Items may include an exact version. */
export async function packageAudit(listParam: string | undefined) {
  const items = (listParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new HttpError(400, "missing required query parameter: packages (comma-separated ecosystem:name[@version])");
  if (items.length > MAX_PACKAGES) throw new HttpError(400, `at most ${MAX_PACKAGES} packages per call`);

  const parsed = items.map(parseSpec);
  const settled: PromiseSettledResult<Awaited<ReturnType<typeof packageInfo>>>[] = new Array(parsed.length);
  await withConcurrency(
    parsed.map((spec, index) => ({ spec, index })),
    MAX_CONCURRENT_FETCHES,
    async ({ spec, index }) => {
      try {
        settled[index] = {
          status: "fulfilled",
          value: await packageInfo(spec.ecosystem, spec.name, spec.version, {
            includeWeeklyDownloads: false,
            maxAdvisoryDetails: spec.version ? 0 : 1,
          }),
        };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    },
  );
  const firstClientError = settled.find((result) => result.status === "rejected" && result.reason instanceof HttpError && result.reason.status === 400);
  if (firstClientError && firstClientError.status === "rejected") throw firstClientError.reason;

  const results: Record<string, unknown>[] = settled.map((result, index) =>
    result.status === "fulfilled"
      ? { ...result.value }
      : {
          ecosystem: parsed[index].ecosystem,
          name: parsed[index].name,
          ...(parsed[index].version ? { version: parsed[index].version } : {}),
          verdict: "error",
          flags: ["lookup-failed"],
          note: "The data source did not answer for this package.",
          ...(parsed[index].version
            ? { source: "deps.dev", sourceStatus: "unavailable", retrievedAt: new Date().toISOString() }
            : {}),
        },
  );

  const versioned = parsed
    .map((spec, index) => ({ spec, index }))
    .filter((entry): entry is { spec: PackageSpec & { version: string }; index: number } => Boolean(entry.spec.version));
  const confirmedVersioned = versioned.filter(
    ({ index }) => results[index].exists === true && results[index].versionExists === true,
  );
  const lookups = confirmedVersioned.length ? await versionAdvisories(confirmedVersioned.map(({ spec }) => spec)) : [];
  for (const [versionIndex, versionAdvisoryResult] of lookups.entries()) {
    const result = results[confirmedVersioned[versionIndex].index];
    const { lookup, advisoryIds } = versionAdvisoryResult;
    result.versionAdvisories = lookup;
    const vulnerabilities = lookup.vulnerabilities;
    if (advisoryIds !== null) {
      const depsIds = Array.isArray(result.advisoryIds)
        ? result.advisoryIds.filter((id): id is string => typeof id === "string")
        : [];
      const combinedIds = [...new Set([...depsIds, ...advisoryIds])];
      result.advisoryIds = combinedIds;
      result.knownVulnerabilities = combinedIds.length;
      result.knownVulnerabilityCountSources = ["deps.dev", "OSV"];
    }
    if (vulnerabilities?.length) {
      const flags = Array.isArray(result.flags) ? result.flags.filter((flag): flag is string => typeof flag === "string") : [];
      if (!flags.includes("known-vulnerabilities")) flags.push("known-vulnerabilities");
      result.flags = flags;
      if (result.exists === true && (result.verdict === "ok" || result.verdict === "unknown")) result.verdict = "caution";
    } else if (lookup.status === "unavailable" && result.exists === true && result.verdict === "ok") {
      result.verdict = "unknown";
    }
  }
  for (const { spec, index } of versioned) {
    if (results[index].exists === true && results[index].versionExists === true) continue;
    const result = results[index];
    const missing = result.exists === false
      ? "OSV was not queried because deps.dev did not list this package."
      : result.versionExists === false
        ? "OSV was not queried because deps.dev did not list this exact version."
        : "OSV was not queried because deps.dev could not confirm that this exact package version exists.";
    result.versionAdvisories = {
      source: "OSV",
      status: "not-queried",
      retrievedAt: null,
      advisoryCount: null,
      vulnerabilities: null,
      note: missing,
    } satisfies VersionAdvisoryLookup;
    if (result.verdict === "ok") result.verdict = "unknown";
  }

  const epssLookup = versioned.length ? await enrichWithEpss(results) : undefined;
  const verdictOf = (result: Record<string, unknown>) => (typeof result.verdict === "string" ? result.verdict : "unknown");
  const notFound = results.filter((result) => result.exists === false && verdictOf(result) === "not-found").length;
  const versionNotFound = results.filter((result) => result.exists === true && result.versionExists === false).length;
  const failed = results.filter((result) => verdictOf(result) === "error").length;
  const incompleteVersionLookups = results.filter((result) => {
    const lookup = result.versionAdvisories as VersionAdvisoryLookup | undefined;
    return lookup !== undefined && lookup.status !== "complete";
  }).length;
  let summary =
    notFound > 0
      ? `${notFound} of ${results.length} package(s) do not exist. Do not install them: they may be invented names that an attacker could register.`
      : failed > 0
        ? `${failed} lookup(s) failed; the rest exist. Retry the failed ones before installing.`
        : `All ${results.length} package(s) exist. Review each verdict and flags before installing.`;
  if (versionNotFound > 0) summary += ` ${versionNotFound} requested exact version(s) were not listed by deps.dev; package existence is reported separately.`;
  if (incompleteVersionLookups > 0) summary += ` ${incompleteVersionLookups} exact-version OSV lookup(s) are not queried, unavailable or incomplete; advisory status is unknown or partial.`;

  return {
    checked: results.length,
    notFound,
    lookupFailed: failed,
    ...(versioned.length ? { versionNotFound, versionAdvisoryLookupIncomplete: incompleteVersionLookups } : {}),
    ...(epssLookup ? { epssLookup } : {}),
    summary,
    results,
    source: "deps.dev",
  };
}
