// 21 Nov 2026: the warm-up line printed "warmed 860 of 830 URLs" because it added requests to a count of URLs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { countAnswer, countUrl, newTally, summaryLine } from "./warm-quotes-tally.mjs";

test("a URL asked twice is one warmed URL and two requests", () => {
  const tally = newTally();
  // 3 bare URLs asked once, 2 example URLs asked twice: 5 URLs, 7 requests.
  for (let i = 0; i < 3; i++) countUrl(tally, countAnswer(tally, 402, null) === "quoted");
  for (let i = 0; i < 2; i++) { countAnswer(tally, 402, null); countUrl(tally, countAnswer(tally, 402, "hit") === "quoted"); }
  assert.deepEqual(tally, { requests: 7, quoted: 7, fromFront: 2, other: 0, failed: 0, urls: 5, urlsWarmed: 5 });
  const line = summaryLine(tally, 5);
  assert.match(line, /^warm-quotes: warmed 5 of 5 URLs \(7 requests answered/);
});

test("warmed URLs never exceed the URLs asked; other answers and failures are not warmed", () => {
  const tally = newTally();
  countUrl(tally, countAnswer(tally, 200, null) === "quoted");
  countUrl(tally, countAnswer(tally, null, null) === "quoted");
  countAnswer(tally, 402, null); countUrl(tally, countAnswer(tally, 503, null) === "quoted"); // last request decides
  countUrl(tally, countAnswer(tally, 402, null) === "quoted");
  assert.equal(tally.urls, 4);
  assert.equal(tally.urlsWarmed, 1);
  assert.equal(tally.requests, 4, "a failed request was never answered");
  assert.equal(tally.failed, 1);
  assert.equal(tally.other, 2);
  assert.ok(tally.urlsWarmed <= tally.urls);
  assert.match(summaryLine(tally, 4), /warmed 1 of 4 URLs \(4 requests answered: 2 quotes, 0 of them already from the front, 2 not a 402; 1 requests failed\)/);
});

test("the release train still finds its marker, and the script uses this counting", async () => {
  const { readFile } = await import("node:fs/promises");
  const release = await readFile(new URL("./release.ps1", import.meta.url), "utf8");
  assert.match(release, /'warm-quotes: warmed'/);
  const script = await readFile(new URL("./warm-quotes.mjs", import.meta.url), "utf8");
  assert.match(script, /summaryLine\(tally, work\.length\)/);
  assert.ok(!/warmed \$\{tally\.quoted\}/.test(script), "the request count is no longer printed as URLs");
});
