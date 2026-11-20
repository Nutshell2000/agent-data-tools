// Read-only probe (20 Nov 2026): does a REAL production tempo/charge challenge accept a credential, or is it refused
// before any balance check (e.g. "challenge was not issued by this server")? Signs with a fresh, EMPTY throwaway key,
// so nothing can ever be paid: the expected healthy answer is a refusal for funds/simulation, not for the challenge.
//   node scripts/tempo-path-probe.mjs [url]
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createClient, http } from "viem";
import { tempo as tempoMainnet } from "viem/tempo/chains";
const url = process.argv[2] ?? "https://agent-data-tools.revmesh2074.workers.dev/time?zone=UTC";
const { Challenge } = await import("mppx");
const { Mppx, tempo } = await import("mppx/client");
const plain = await fetch(url, { headers: { accept: "application/json" } });
console.log(`unpaid: HTTP ${plain.status}  front=${plain.headers.get("x-quote-front") ?? "-"}`);
const ch = Challenge.fromResponseList(plain).find((c) => c.method === "tempo");
await plain.arrayBuffer();
if (!ch) { console.log("no tempo challenge"); process.exit(1); }
console.log(`asks ${ch.request.amount} of ${ch.request.currency} on ${ch.request.methodDetails.chainId}, modes ${(ch.request.methodDetails.supportedModes ?? []).join("/")}`);
const account = privateKeyToAccount(generatePrivateKey());
console.log(`throwaway payer ${account.address} (holds nothing)`);
const client = Mppx.create({ polyfill: false, methods: [tempo.charge({ account, mode: "pull", getClient: () => createClient({ chain: tempoMainnet, transport: http() }) })] });
try {
  const res = await client.fetch(url, { headers: { accept: "application/json" } });
  const body = await res.text();
  console.log(`paid attempt: HTTP ${res.status}  front=${res.headers.get("x-quote-front") ?? "-"}`);
  console.log(`www-authenticate error: ${(res.headers.get("www-authenticate") ?? "").match(/error[^,]*/)?.[0] ?? "-"}`);
  console.log(`body: ${body.slice(0, 600)}`);
} catch (e) {
  console.log(`client threw: ${String(e?.message ?? e).slice(0, 600)}`);
}
