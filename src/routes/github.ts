/**
 * GitHub repository data (10 Nov 2026, owner's decision: "repo data only").
 *
 * Demand: GitHub lookups are among the tasks most open shoppers buy (8 of 50 multi-seller wallets in a two-day sample;
 * one seller got about 95 calls a day from two buyers that already buy from us). The busiest of those listings sell user
 * profiles; GitHub's terms restrict selling users' personal information, so these tools return repository facts only:
 * no profile, e-mail, avatar, contributor or stargazer data. The owner's login appears only as part of the repository's
 * own name.
 *
 * Source: GitHub's REST API with the read-only token in the secret GITHUB_TOKEN (a fine-grained token with no
 * permissions reads public repositories at 5,000 requests an hour). Without a token GitHub allows 60 requests an hour
 * per address, and Cloudflare's shared egress uses that up: 1 of 3 test calls from staging answered 403 on 10 Nov. A
 * rate-limited call is an uncharged 503, never a wrong answer.
 */
import { entry, flag, need, num, opt, pick, type Entry, type Input } from "../family";
import { HttpError, type Env } from "../lib/env";

const API = "https://api.github.com";
const SOURCE = "GitHub REST API (public repository data)";
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * A repository as agents write it: owner/name, a github.com URL (with or without a path below the repository), an SSH
 * remote, with or without ".git"; or a bare name with the owner sent separately.
 */
export function repoName(raw: string, ownerInput?: string): string {
  let text = raw.trim().replace(/^git@github\.com:/i, "").replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  const parts = text.split("/").filter(Boolean);
  const owner = parts.length >= 2 ? parts[0] : ownerInput?.trim().replace(/^@/, "") ?? "";
  const name = (parts.length >= 2 ? parts[1] : parts[0] ?? "").replace(/\.git$/i, "");
  text = `${owner}/${name}`;
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    throw new HttpError(400, "repo must be owner/name (for example vercel/next.js) or a github.com repository URL");
  }
  return text;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One GitHub API read. 404 is null (the caller decides whether that is an error); a used-up rate limit is a 503. */
export async function github<T>(env: Pick<Env, "GITHUB_TOKEN">, path: string, fetcher: Fetcher = fetch): Promise<T | null> {
  const read = (token: string | undefined) => fetcher(`${API}${path}`, {
    headers: {
      accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28",
      "user-agent": "AgentDataTools/1.0 (+https://agent-data-tools.revmesh2074.workers.dev)",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8_000),
    // Public data: one answer serves every caller for five minutes, whatever token fetched it.
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit);
  let res: Response;
  try {
    res = await read(env.GITHUB_TOKEN);
    // An expired or revoked token (401) must not take the tools down: read without it, at GitHub's keyless limit.
    if (res.status === 401 && env.GITHUB_TOKEN) { console.warn("github: the token was refused (401); reading without it"); res = await read(undefined); }
  } catch {
    throw new HttpError(502, "GitHub did not respond; try again");
  }  if (res.status === 404 || res.status === 451) return null;
  if (res.status === 403 || res.status === 429) {
    const limited = res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429 || /rate limit/i.test(await res.clone().text().catch(() => ""));
    if (limited) throw new HttpError(503, "GitHub's request limit is used up for the moment; not charged, try again in a minute", "GITHUB_BUSY");
    throw new HttpError(404, "GitHub does not serve that repository to the public");
  }
  if (res.status === 422) throw new HttpError(400, "GitHub could not read that search; simplify the query");
  if (!res.ok) throw new HttpError(502, `GitHub answered HTTP ${res.status}; try again`);
  return (await res.json()) as T;
}

interface Repo {
  full_name: string; html_url: string; description: string | null; homepage: string | null; stargazers_count: number; forks_count: number;
  subscribers_count?: number; open_issues_count: number; language: string | null; topics?: string[]; license?: { spdx_id?: string | null; name?: string | null } | null;
  default_branch?: string; created_at: string; pushed_at: string | null; updated_at: string; archived: boolean; fork: boolean; is_template?: boolean; size: number;
  owner?: { login?: string; type?: string }; parent?: { full_name?: string };
}
interface Release { tag_name: string; name: string | null; published_at: string | null; prerelease: boolean; draft: boolean; html_url: string; body?: string | null }

const licence = (r: Repo) => (r.license?.spdx_id && r.license.spdx_id !== "NOASSERTION" ? r.license.spdx_id : r.license?.name ?? null);
const release = (r: Release, notesChars = 0) => ({
  tag: r.tag_name, name: r.name || null, publishedAt: r.published_at, prerelease: r.prerelease, url: r.html_url,
  ...(notesChars ? { notes: r.body ? r.body.slice(0, notesChars) : null, notesTruncated: (r.body?.length ?? 0) > notesChars } : {}),
});

/** Language shares in percent of bytes, largest first, at most eight. */
export function languageShares(bytes: Record<string, number> | null): Record<string, number> {
  const entries = Object.entries(bytes ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return Object.fromEntries(entries.slice(0, 8).map(([k, n]) => [k, Math.round((n / total) * 1000) / 10]));
}

export async function repoFacts(env: Pick<Env, "GITHUB_TOKEN">, name: string, fetcher: Fetcher = fetch) {
  const repo = await github<Repo>(env, `/repos/${name}`, fetcher);
  if (!repo) throw new HttpError(404, `no public GitHub repository ${name}`);
  // The two extra reads are best effort: a repository without releases answers 404, and a failed read leaves the field null.
  const [languages, latest] = await Promise.all([
    github<Record<string, number>>(env, `/repos/${repo.full_name}/languages`, fetcher).catch(() => null),
    github<Release>(env, `/repos/${repo.full_name}/releases/latest`, fetcher).catch(() => null),
  ]);
  const [owner] = repo.full_name.split("/");
  return {
    repo: repo.full_name, url: repo.html_url, owner, ownerType: repo.owner?.type ?? null,
    description: repo.description, homepage: repo.homepage || null,
    stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count ?? null,
    // GitHub counts open pull requests in this number.
    openIssuesAndPulls: repo.open_issues_count,
    language: repo.language, languages: languageShares(languages), topics: repo.topics ?? [], license: licence(repo),
    defaultBranch: repo.default_branch ?? null, createdAt: repo.created_at, pushedAt: repo.pushed_at, updatedAt: repo.updated_at,
    archived: repo.archived, fork: repo.fork, forkOf: repo.parent?.full_name ?? null, template: repo.is_template ?? false, sizeKb: repo.size,
    latestRelease: latest ? release(latest) : null,
    source: SOURCE, checkedAt: new Date().toISOString(),
  };
}

const SORTS = ["best-match", "stars", "forks", "updated"] as [string, ...string[]];

export async function repoSearch(env: Pick<Env, "GITHUB_TOKEN">, query: string, sort: string, language: string | undefined, count: number, fetcher: Fetcher = fetch) {
  const q = `${query}${language ? ` language:${language.replace(/[^A-Za-z0-9+#.-]/g, "")}` : ""}`;
  const params = new URLSearchParams({ q, per_page: String(count), ...(sort !== "best-match" ? { sort, order: "desc" } : {}) });
  const found = await github<{ total_count: number; items: Repo[] }>(env, `/search/repositories?${params}`, fetcher);
  return {
    query, language: language ?? null, sort, total: found?.total_count ?? 0,
    repos: (found?.items ?? []).slice(0, count).map((r) => ({
      repo: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count, forks: r.forks_count, language: r.language,
      topics: (r.topics ?? []).slice(0, 8), license: licence(r), pushedAt: r.pushed_at, archived: r.archived,
    })),
    source: SOURCE, checkedAt: new Date().toISOString(),
  };
}

export async function repoReleases(env: Pick<Env, "GITHUB_TOKEN">, name: string, count: number, fetcher: Fetcher = fetch) {
  const list = await github<Release[]>(env, `/repos/${name}/releases?per_page=${count}`, fetcher);
  if (!list) throw new HttpError(404, `no public GitHub repository ${name}`);
  const published = list.filter((r) => !r.draft).slice(0, count);
  return { repo: name, count: published.length, releases: published.map((r) => release(r, 1_500)), source: SOURCE, checkedAt: new Date().toISOString() };
}

/** An account as agents write it: a login, @login, or a github.com link to the account or to one of its repositories. */
export function accountLogin(raw: string): string {
  const login = raw.trim().replace(/^@/, "").replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "").replace(/[?#].*$/, "").split("/").filter(Boolean)[0] ?? "";
  if (!OWNER.test(login)) throw new HttpError(400, "user must be a GitHub login such as vercel, or a github.com link to the account");
  return login;
}

/**
 * The public repositories of one account (11 Nov 2026, owner: "Yes, repo data only"). The busiest GitHub listing on the
 * Bazaar is a user lookup (about 3,100 calls a month from Mercator's router and as many on the Bazaar); it sells the
 * profile. This answers the same question, what has this account built, from repository data alone: the account's login
 * as repositories carry it, whether it is a user or an organization, how many public repositories it has, and the
 * repositories themselves. From the account record GitHub sends, only `type` and `public_repos` are read: no name, bio,
 * e-mail, company, location, avatar, blog, social links, follower counts or account dates ever reach an answer
 * (tests/github.test.cjs feeds the real record and checks).
 */
export async function accountRepos(env: Pick<Env, "GITHUB_TOKEN">, login: string, count: number, includeForks: boolean, fetcher: Fetcher = fetch) {
  const [list, record] = await Promise.all([
    github<Repo[]>(env, `/users/${login}/repos?type=owner&sort=pushed&direction=desc&per_page=100`, fetcher),
    github<{ type?: string; public_repos?: number }>(env, `/users/${login}`, fetcher).catch(() => null),
  ]);
  if (!list) throw new HttpError(404, `no public GitHub account ${login}`);
  const own = list.filter((r) => includeForks || !r.fork);
  const languages: Record<string, number> = {};
  for (const r of own) if (r.language) languages[r.language] = (languages[r.language] ?? 0) + 1;
  const pushes = own.map((r) => r.pushed_at).filter((p): p is string => typeof p === "string").sort();
  return {
    user: list[0]?.full_name.split("/")[0] ?? login, type: record?.type ?? list[0]?.owner?.type ?? null, url: `https://github.com/${login}`,
    publicRepos: typeof record?.public_repos === "number" ? record.public_repos : null, reposRead: list.length, forksIncluded: includeForks,
    stars: own.reduce((n, r) => n + r.stargazers_count, 0), forks: own.reduce((n, r) => n + r.forks_count, 0),
    languages: Object.fromEntries(Object.entries(languages).sort((x, y) => y[1] - x[1]).slice(0, 8)), lastPushAt: pushes.at(-1) ?? null,
    repos: [...own].sort((x, y) => y.stargazers_count - x.stargazers_count).slice(0, count).map((r) => ({
      repo: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count, forks: r.forks_count, language: r.language,
      topics: (r.topics ?? []).slice(0, 8), license: licence(r), pushedAt: r.pushed_at, archived: r.archived, fork: r.fork,
    })),
    note: "Repository data only: counts and languages cover the account's 100 most recently pushed public repositories.",
    source: SOURCE, checkedAt: new Date().toISOString(),
  };
}
const repoInput = (q: Input) => repoName(need(q, "repo", 300), opt(q, "owner", 60));
const REPO_PARAMS = {
  repo: { type: "string" as const, description: "Repository as owner/name, e.g. vercel/next.js, or its github.com URL", required: true, example: "vercel/next.js" },
  owner: { type: "string" as const, description: "Owner, only when repo is given as a bare name", example: "vercel" },
};

export const GITHUB: Entry[] = [
  entry("/github/repo", "GitHub repo data: stars, forks, release",
    "GitHub repository data in one call: stars, forks, watchers, open issues and pull requests, main language and language shares, topics, license, default branch, created and last-push dates, archived and fork flags, and the latest release with its tag and date. Give owner/name or a github.com URL; public repositories only, no user profile data. Use to vet a dependency, check whether a project is alive, compare libraries or enrich a list of repos.",
    ["github-repo", "github", "github-stars", "repository", "open-source", "developer-tools"], REPO_PARAMS,
    {
      repo: "vercel/next.js", url: "https://github.com/vercel/next.js", owner: "vercel", ownerType: "Organization", description: "The React Framework", homepage: "https://nextjs.org",
      stars: 131000, forks: 28100, watchers: 1480, openIssuesAndPulls: 3400, language: "JavaScript", languages: { JavaScript: 52.1, TypeScript: 30.4, Rust: 16.2 }, topics: ["react", "nextjs", "vercel"], license: "MIT",
      defaultBranch: "canary", createdAt: "2016-10-05T23:32:51Z", pushedAt: "2026-11-10T08:41:07Z", updatedAt: "2026-11-10T08:50:12Z", archived: false, fork: false, forkOf: null, template: false, sizeKb: 2300000,
      latestRelease: { tag: "v16.0.1", name: "v16.0.1", publishedAt: "2026-10-28T17:02:11Z", prerelease: false, url: "https://github.com/vercel/next.js/releases/tag/v16.0.1" },
      source: SOURCE, checkedAt: "2026-11-10T09:12:00.000Z",
    },
    (env, q) => repoFacts(env, repoInput(q))),

  entry("/github/search", "GitHub search: find repositories",
    "GitHub repository search: find public repositories by keyword, optionally in one language, ordered by best match, stars, forks or last update, with each result's stars, forks, language, topics, license and last-push date; 1-20 results. Repositories only, no user profile data. Use to find a library for a task, discover the popular projects on a topic or check what already exists before building.",
    ["github-search", "github", "repository-search", "open-source", "code-search", "developer-tools"], {
      q: { type: "string", description: "Search words, e.g. x402 payments (GitHub search qualifiers such as topic:mcp or stars:>100 work too)", required: true, example: "x402 payments" },
      sort: { type: "string", description: "best-match (default), stars, forks or updated", enum: SORTS, example: "stars" },
      language: { type: "string", description: "Only repositories mainly in this language, e.g. TypeScript", example: "TypeScript" },
      count: { type: "integer", description: "Number of results, 1-20 (default 10)", example: 5 },
    },
    {
      query: "x402 payments", language: null, sort: "stars", total: 412,
      repos: [{ repo: "coinbase/x402", url: "https://github.com/coinbase/x402", description: "A payments protocol for the internet. Built on HTTP.", stars: 5200, forks: 890, language: "TypeScript", topics: ["payments", "http", "stablecoins"], license: "Apache-2.0", pushedAt: "2026-11-09T22:10:44Z", archived: false }],
      source: SOURCE, checkedAt: "2026-11-10T09:12:00.000Z",
    },
    (env, q) => repoSearch(env, need(q, "q", 200), pick(q, "sort", SORTS, "best-match"), opt(q, "language", 40), num(q, "count", { min: 1, max: 20, fallback: 10, integer: true }))),

  entry("/github/releases", "GitHub releases: latest versions",
    "GitHub releases of a repository, newest first: tag, name, publish date, pre-release flag, link and the first 1,500 characters of the release notes, for the last 1-10 releases. Give owner/name or a github.com URL; public repositories only. Use to check the latest version of a tool, read what changed before upgrading a dependency or watch a project for new releases.",
    ["github-releases", "github", "release-notes", "changelog", "latest-version", "developer-tools"], {
      ...REPO_PARAMS, repo: { ...REPO_PARAMS.repo, example: "cloudflare/workers-sdk" }, owner: { ...REPO_PARAMS.owner, example: "cloudflare" },
      count: { type: "integer", description: "Number of releases, 1-10 (default 5)", example: 3 },
    },
    {
      repo: "cloudflare/workers-sdk", count: 1,
      releases: [{ tag: "wrangler@4.148.0", name: "wrangler@4.148.0", publishedAt: "2026-11-04T14:20:31Z", prerelease: false, url: "https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.148.0", notes: "### Minor Changes\n\n- Add support for…", notesTruncated: true }],
      source: SOURCE, checkedAt: "2026-11-10T09:12:00.000Z",
    },
    (env, q) => repoReleases(env, repoInput(q), num(q, "count", { min: 1, max: 10, fallback: 5, integer: true }))),

  entry("/github/user", "GitHub user repos: what an account has built",
    "GitHub user or organization by login: its public repositories ranked by stars, each with description, stars, forks, language, topics, license and last push, plus the repository count, total stars, language mix and latest activity. Repository data only: no profile, e-mail, avatar or follower data. Use to see what a developer or company has built, vet a maintainer by their projects, or find an organization's main repositories.",
    ["github-user", "github", "github-repos", "developer", "open-source", "repositories"], {
      user: { type: "string", description: "GitHub login of a user or organization, e.g. vercel, or its github.com link", required: true, example: "vercel" },
      count: { type: "integer", description: "Repositories to list, most starred first, 1-30 (default 10)", example: 5 },
      forks: { type: "string", description: "true to include repositories forked from others (default false)", example: "false" },
    },
    {
      user: "vercel", type: "Organization", url: "https://github.com/vercel", publicRepos: 212, reposRead: 100, forksIncluded: false, stars: 312000, forks: 54000,
      languages: { TypeScript: 61, JavaScript: 17, Rust: 4 }, lastPushAt: "2026-11-10T21:40:02Z",
      repos: [{ repo: "vercel/next.js", url: "https://github.com/vercel/next.js", description: "The React Framework", stars: 131000, forks: 28100, language: "JavaScript", topics: ["react", "nextjs"], license: "MIT", pushedAt: "2026-11-10T21:40:02Z", archived: false, fork: false }],
      note: "Repository data only: counts and languages cover the account's 100 most recently pushed public repositories.",
      source: SOURCE, checkedAt: "2026-11-11T09:12:00.000Z",
    },
    (env, q) => accountRepos(env, accountLogin(need(q, "user", 200)), num(q, "count", { min: 1, max: 30, fallback: 10, integer: true }), flag(q, "forks"))),
];
