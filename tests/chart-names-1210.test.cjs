const assert = require('node:assert/strict');
const { test } = require('node:test');
const { build } = require('esbuild');

// 1.210.0 (16 Nov 2026): listing names that start with the phrase buyers type in the Coinbase Bazaar search
// (business/agentic/base-bots/new-phrases-1116.mjs). On 16 Nov the #1 listing for each phrase had no more 30-day
// payers than ours, so inside the payer tier the name decides; these tools were absent or #4-#14 with names that did
// not hold the phrase. A later rename must keep the phrase in the name, or move it to a tool that does the job.
const PHRASES = {
  '/transcribe/long': ['whisper', 'audio transcription'],
  '/transcribe/summary': ['meeting transcript'],
  '/transcribe/speakers': ['speaker diarization'],
  '/dub': ['dubbing'],
  '/pdf/extract': ['pdf extract'],
  '/einvoice/validate': ['e-invoice validation'],
};

test('voice, PDF and e-invoice listings name the phrase buyers search for', async () => {
  const b = await build({ stdin: { contents: 'export { ENDPOINTS } from "./src/discovery"; export { listingName } from "./src/lib/bazaar-extension";', resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format: 'cjs', platform: 'node', write: false, external: ['cloudflare:workers'], logLevel: 'silent' });
  const m = { exports: {} }; new Function('module', 'exports', 'require', b.outputFiles[0].text)(m, m.exports, require);
  const { ENDPOINTS, listingName } = m.exports;
  for (const [path, phrases] of Object.entries(PHRASES)) {
    const e = ENDPOINTS.find((x) => x.path === path);
    assert.ok(e, `${path} is in the catalog`);
    const name = listingName(e.summary).toLowerCase();
    for (const p of phrases) assert.ok(name.includes(p), `${path} listing name "${name}" holds "${p}"`);
  }
});
