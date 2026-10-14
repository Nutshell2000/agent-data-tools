import { HttpError } from "../lib/env";
import { packageInfo } from "./package";

const MAX_PACKAGES = 10;
type Info = Awaited<ReturnType<typeof packageInfo>>;

/** Audits a whole dependency list in one call. Each item is "ecosystem:name", e.g. "npm:left-pad". */
export async function packageAudit(listParam: string | undefined) {
  const items = (listParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new HttpError(400, "missing required query parameter: packages (comma-separated ecosystem:name)");
  if (items.length > MAX_PACKAGES) throw new HttpError(400, `at most ${MAX_PACKAGES} packages per call`);

  const parsed = items.map((item) => {
    const i = item.indexOf(":");
    if (i < 1 || i === item.length - 1) throw new HttpError(400, `"${item}" must look like ecosystem:name, e.g. npm:left-pad`);
    return { ecosystem: item.slice(0, i), name: item.slice(i + 1) };
  });
  // A bad ecosystem or name is the caller's mistake: fail the whole call so it is not charged.
  const settled = await Promise.allSettled(parsed.map((p) => packageInfo(p.ecosystem, p.name)));
  const firstClientError = settled.find((r) => r.status === "rejected" && r.reason instanceof HttpError && r.reason.status === 400);
  if (firstClientError && firstClientError.status === "rejected") throw firstClientError.reason;

  const results = settled.map((r, i) =>
    r.status === "fulfilled"
      ? (r.value as Info)
      : { ecosystem: parsed[i].ecosystem, name: parsed[i].name, verdict: "error", flags: ["lookup-failed"], note: "The data source did not answer for this package." },
  );
  const verdictOf = (r: unknown) => (r as { verdict?: string }).verdict ?? "unknown";
  const count = (v: string) => results.filter((r) => verdictOf(r) === v).length;
  const notFound = count("not-found");
  const failed = count("error");
  return {
    checked: results.length,
    notFound,
    lookupFailed: failed,
    summary:
      notFound > 0
        ? `${notFound} of ${results.length} package(s) do not exist. Do not install them: they may be invented names that an attacker could register.`
        : failed > 0
          ? `${failed} lookup(s) failed; the rest exist. Retry the failed ones before installing.`
          : `All ${results.length} package(s) exist. Review each verdict and flags before installing.`,
    results,
    source: "deps.dev",
  };
}
