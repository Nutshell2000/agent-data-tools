#!/usr/bin/env node
// Prints ready-to-run queries for the measurement dataset (src/lib/beacon.ts, Workers Analytics Engine).
// It reads no token, no environment variable and makes no request: it only PRINTS the SQL and the curl command.
// The Worker cannot read its own dataset (the SQL API needs an account API token, which the Worker does not hold), so
// the owner runs these from a shell where CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set
// (token permission: Account > Account Analytics > Read).
//
//   node scripts/analytics-queries.mjs                 every query, production dataset, last 30 days
//   node scripts/analytics-queries.mjs --staging       the staging dataset
//   node scripts/analytics-queries.mjs --days 7        another window (1-90; Analytics Engine keeps three months)
//   node scripts/analytics-queries.mjs crawlers        only the queries whose name holds the word
//   node scripts/analytics-queries.mjs --sql           the SQL alone, without curl
// The SQL follows Cloudflare's documented syntax; it was not run when written (16 Nov 2026: no token in the build session).
//
// Data point layout (index1 and blob1 are always the event; double1 is 1; count rows with SUM(_sample_interval)):
//   beacon (any event a page sends)  blob2 path · blob3 referrer family · blob4 software family · blob5 country · blob6 src · blob7 site
//   mcp_initialize                   blob2 route · blob3 client software name · blob4 mode (open|key|account) · blob6 src · blob7 host
//   ai_crawler                       blob2 path · blob3 crawler name · blob4 status class (2xx…) · blob7 host
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const daysAt = args.indexOf("--days");
const days = daysAt >= 0 ? Number(args[daysAt + 1]) : 30;
if (!Number.isInteger(days) || days < 1 || days > 90) { console.error("--days takes a whole number from 1 to 90"); process.exit(1); }
const only = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--days");
const dataset = flag("--staging") ? "glyphcall_events_staging" : "glyphcall_events";
const day = "toStartOfInterval(timestamp, INTERVAL '1' DAY)";
const since = `timestamp > NOW() - INTERVAL '${days}' DAY`;
const server = "index1 NOT IN ('mcp_initialize', 'ai_crawler')";

const table = dataset;
const queries = [
  ["crawlers-by-day-and-path", "AI crawlers: reads per UTC day, crawler and path",
    `SELECT ${day} AS day, blob3 AS crawler, blob2 AS path, blob4 AS status, SUM(_sample_interval) AS reads FROM ${table} WHERE index1 = 'ai_crawler' AND ${since} GROUP BY day, crawler, path, status ORDER BY day DESC, reads DESC LIMIT 1000`],
  ["crawlers-by-day", "AI crawlers: reads per UTC day and crawler",
    `SELECT ${day} AS day, blob3 AS crawler, SUM(_sample_interval) AS reads FROM ${table} WHERE index1 = 'ai_crawler' AND ${since} GROUP BY day, crawler ORDER BY day DESC, reads DESC`],
  ["crawlers-top-paths", "AI crawlers: the pages and files they read most, by host",
    `SELECT blob7 AS host, blob2 AS path, SUM(_sample_interval) AS reads FROM ${table} WHERE index1 = 'ai_crawler' AND ${since} GROUP BY host, path ORDER BY reads DESC LIMIT 200`],
  ["beacon-events-by-day", "Beacon: events per UTC day",
    `SELECT ${day} AS day, index1 AS event, SUM(_sample_interval) AS events FROM ${table} WHERE ${server} AND ${since} GROUP BY day, event ORDER BY day DESC, events DESC`],
  ["beacon-by-path", "Beacon: events per site and path",
    `SELECT index1 AS event, blob7 AS site, blob2 AS path, SUM(_sample_interval) AS events FROM ${table} WHERE ${server} AND ${since} GROUP BY event, site, path ORDER BY events DESC LIMIT 500`],
  ["beacon-by-referrer", "Beacon: where browsers came from (referrer family and campaign tag; software family 'browser' only)",
    `SELECT index1 AS event, blob3 AS referrer, blob6 AS src, SUM(_sample_interval) AS events FROM ${table} WHERE ${server} AND blob4 = 'browser' AND ${since} GROUP BY event, referrer, src ORDER BY events DESC LIMIT 500`],
  ["beacon-by-country", "Beacon: events per country",
    `SELECT index1 AS event, blob5 AS country, SUM(_sample_interval) AS events FROM ${table} WHERE ${server} AND ${since} GROUP BY event, country ORDER BY events DESC LIMIT 300`],
  ["beacon-by-software", "Beacon: which software sends events (a share that is not 'browser' is automation, not people)",
    `SELECT blob4 AS software, SUM(_sample_interval) AS events FROM ${table} WHERE ${server} AND ${since} GROUP BY software ORDER BY events DESC LIMIT 100`],
  ["mcp-clients-by-day", "MCP: connecting apps per UTC day (client software name, mode, src tag)",
    `SELECT ${day} AS day, blob3 AS client, blob4 AS mode, blob6 AS src, SUM(_sample_interval) AS connections FROM ${table} WHERE index1 = 'mcp_initialize' AND ${since} GROUP BY day, client, mode, src ORDER BY day DESC, connections DESC LIMIT 1000`],
  ["mcp-by-route-and-src", "MCP: connections per server route and src tag (which directory listing sends connections)",
    `SELECT blob2 AS route, blob6 AS src, blob3 AS client, SUM(_sample_interval) AS connections FROM ${table} WHERE index1 = 'mcp_initialize' AND ${since} GROUP BY route, src, client ORDER BY connections DESC LIMIT 500`],
  ["tables", "Check that the dataset exists (it appears after the first data point)", "SHOW TABLES"],
];

const picked = queries.filter(([name]) => !only || name.includes(only));
if (!picked.length) { console.error(`no query named like "${only}"; names: ${queries.map(([n]) => n).join(", ")}`); process.exit(1); }
for (const [name, what, sql] of picked) {
  console.log(`# ${name}: ${what}`);
  if (flag("--sql")) console.log(`${sql}\n`);
  else console.log(`curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/analytics_engine/sql" \\\n  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\\n  --data "${sql}"\n`);
}
