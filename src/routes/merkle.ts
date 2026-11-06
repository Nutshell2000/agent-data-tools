/**
 * Merkle trees for allowlists and airdrops (6 Nov 2026). Demand: a merkle build/verify listing was paid by 6 of the 47 open
 * shoppers in a two-day sample of Base transfers; we had none. The trees follow OpenZeppelin's @openzeppelin/merkle-tree
 * (StandardMerkleTree: leaf = keccak256(keccak256(abi.encode(types, value))), leaves sorted, sorted-pair keccak nodes; and
 * SimpleMerkleTree for ready bytes32 leaves), so the root and proofs verify with OpenZeppelin's MerkleProof.verify on chain
 * and the `dump` loads with StandardMerkleTree.load(). Pure computation: no source, no network.
 */
import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import { entry, need, opt, type Entry, type Input } from "../family";
import { HttpError } from "../lib/env";

const MAX_LEAVES = 2_000;
const MAX_PROOFS = 256;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TYPE = /^(address|bool|string|bytes|bytes([1-9]|[12]\d|3[0-2])|u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?)$/;

const hashPair = (a: Hex, b: Hex): Hex => keccak256(`0x${[a.toLowerCase(), b.toLowerCase()].sort().map((h) => h.slice(2)).join("")}` as Hex);

/** OpenZeppelin's makeMerkleTree: leaves in the last positions in reverse order, parents from the end. */
export function makeTree(leaves: Hex[]): Hex[] {
  if (!leaves.length) throw new HttpError(400, "give at least one value");
  const tree = new Array<Hex>(2 * leaves.length - 1);
  leaves.forEach((leaf, i) => { tree[tree.length - 1 - i] = leaf.toLowerCase() as Hex; });
  for (let i = tree.length - 1 - leaves.length; i >= 0; i--) tree[i] = hashPair(tree[2 * i + 1], tree[2 * i + 2]);
  return tree;
}

export function proofFor(tree: Hex[], treeIndex: number): Hex[] {
  const proof: Hex[] = [];
  for (let i = treeIndex; i > 0; i = Math.floor((i - 1) / 2)) proof.push(tree[i % 2 === 0 ? i - 1 : i + 1]);
  return proof;
}

/** MerkleProof.processProof: fold the proof with sorted-pair hashing. */
export const processProof = (leaf: Hex, proof: Hex[]): Hex => proof.reduce<Hex>((h, p) => hashPair(h, p), leaf.toLowerCase() as Hex);

export function typesOf(raw: string | undefined): string[] {
  const types = (raw ?? "").replace(/[()[\]"']/g, "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).map((t) => (t === "uint" ? "uint256" : t === "int" ? "int256" : t));
  for (const t of types) if (!TYPE.test(t)) throw new HttpError(400, `unsupported type "${t.slice(0, 20)}": use address, uint256, int256, bool, bytes32, bytes or string`);
  return types;
}

/** Rows as agents send them: a JSON array (of arrays, objects or scalars), or one row per line with comma-separated fields. */
export function rowsOf(raw: string): unknown[][] {
  const s = raw.trim();
  let rows: unknown[];
  if (s.startsWith("[")) {
    try { rows = JSON.parse(s); } catch { throw new HttpError(400, "values looks like JSON but is not a valid JSON array"); }
    if (!Array.isArray(rows)) throw new HttpError(400, "values must be a JSON array");
  } else rows = s.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(",").map((x) => x.trim()));
  return rows.map((r) => (Array.isArray(r) ? r : r && typeof r === "object" ? Object.values(r as Record<string, unknown>) : [r]));
}

/** The leaf encoding to use: given types, or read from the rows (bytes32 leaves; address; address + amount). */
export function inferTypes(rows: unknown[][]): string[] | null {
  if (rows.every((r) => r.length === 1 && typeof r[0] === "string" && BYTES32.test(r[0]))) return null;
  if (rows.every((r) => r.length === 1 && typeof r[0] === "string" && ADDRESS.test(r[0]))) return ["address"];
  if (rows.every((r) => r.length === 2 && typeof r[0] === "string" && ADDRESS.test(r[0]) && /^\d+$/.test(String(r[1])))) return ["address", "uint256"];
  throw new HttpError(400, "give types (for example address,uint256) to say how each value is ABI-encoded");
}

function coerce(type: string, v: unknown, row: number): unknown {
  const bad = () => new HttpError(400, `value ${row + 1}: not a valid ${type}`);
  if (type === "address") { if (typeof v !== "string" || !ADDRESS.test(v)) throw bad(); return v; }
  if (type === "bool") { if (v === true || v === "true" || v === 1 || v === "1") return true; if (v === false || v === "false" || v === 0 || v === "0") return false; throw bad(); }
  if (/^u?int/.test(type)) { const s = String(v).trim(); if (!/^-?\d+$/.test(s) || (type.startsWith("u") && s.startsWith("-"))) throw bad(); return BigInt(s); }
  if (/^bytes\d+$/.test(type)) { const n = Number(type.slice(5)); if (typeof v !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${n * 2}}$`).test(v)) throw bad(); return v; }
  if (type === "bytes") { if (typeof v !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(v)) throw bad(); return v; }
  return String(v);
}

export function leafHash(types: string[], row: unknown[], index: number): Hex {
  if (row.length !== types.length) throw new HttpError(400, `value ${index + 1} has ${row.length} fields; types has ${types.length}`);
  const encoded = encodeAbiParameters(parseAbiParameters(types.join(",")), types.map((t, i) => coerce(t, row[i], index)) as readonly unknown[]);
  return keccak256(keccak256(encoded));
}

/** A JSON-friendly copy of a row (bigints as strings). */
const plain = (row: unknown[], types: string[] | null) => row.map((v, i) => (types && /^u?int/.test(types[i]) ? String(v).trim() : v));

export function buildTree(rows: unknown[][], types: string[] | null) {
  if (rows.length > MAX_LEAVES) throw new HttpError(400, `at most ${MAX_LEAVES} values per call`);
  const hashed = rows.map((row, valueIndex) => ({ valueIndex, row, hash: (types ? leafHash(types, row, valueIndex) : String(row[0]).toLowerCase()) as Hex }));
  const sorted = [...hashed].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const tree = makeTree(sorted.map((h) => h.hash));
  const treeIndex = new Map<number, number>();
  sorted.forEach((h, i) => treeIndex.set(h.valueIndex, tree.length - 1 - i));
  return { tree, hashed, treeIndex };
}

function proofInput(q: Input): Hex[] {
  const raw = need(q, "proof", 20_000).trim();
  let items: unknown[];
  if (raw.startsWith("[")) { try { items = JSON.parse(raw); } catch { throw new HttpError(400, "proof looks like JSON but is not a valid JSON array"); } }
  else items = raw.split(/[\s,]+/).filter(Boolean);
  if (!Array.isArray(items) || items.some((p) => typeof p !== "string" || !BYTES32.test(p))) throw new HttpError(400, "proof must be a list of 32-byte hex hashes");
  return items as Hex[];
}

export const MERKLE: Entry[] = [
  entry("/merkle/tree", "Merkle tree, merkle root and proofs",
    "Build a Merkle tree for an allowlist or airdrop and get the root and a proof per entry, OpenZeppelin-compatible: values ABI-encoded by types (address,uint256 for airdrops), double-keccak leaves, sorted pairs, so proofs verify with MerkleProof.verify and the dump loads in StandardMerkleTree.load. Up to 2,000 values; proofs for the first 256 or the one you ask for. Ready bytes32 leaves work too. Use to set up a claim contract or check a list.",
    ["merkle-tree", "merkle-root", "merkle-proof", "airdrop", "allowlist", "openzeppelin"], {
      values: { type: "string", description: "The entries: a JSON array of rows ([[\"0xabc…\",\"100\"],…]) or one row per line, fields comma-separated", required: true, example: "[[\"0x1111111111111111111111111111111111111111\",\"5000000000000000000\"],[\"0x2222222222222222222222222222222222222222\",\"2500000000000000000\"]]" },
      types: { type: "string", description: "Solidity types of each row's fields, comma-separated (default: read from the rows: address,uint256 or address or bytes32 leaves)", example: "address,uint256" },
      proofFor: { type: "string", description: "Only the proof for this entry: its 0-based index or its first field (an address)", example: "0x2222222222222222222222222222222222222222" },
    },
    {
      format: "standard-v1", leafEncoding: ["address", "uint256"], root: "0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77", count: 2,
      entries: [{ index: 0, value: ["0x1111111111111111111111111111111111111111", "5000000000000000000"], leaf: "0xeb02c421cfa48976e66dfb29120745909ea3a0f843456c263cf8f1253483e283", proof: ["0xb92c48e9d7abe27fd8dfd6b5dfdbfb1c9a463f80c712b66f3a5180a090cccafc"] }],
      proofsIncluded: 2, dump: { format: "standard-v1", leafEncoding: ["address", "uint256"], tree: ["0x…"], values: [{ value: ["0x1111111111111111111111111111111111111111", "5000000000000000000"], treeIndex: 1 }] },
      verifyOnChain: "MerkleProof.verify(proof, root, keccak256(bytes.concat(keccak256(abi.encode(account, amount)))))",
    },
    (_env, q) => {
      const rows = rowsOf(need(q, "values", 400_000));
      if (!rows.length) throw new HttpError(400, "give at least one value");
      const given = opt(q, "types", 400);
      const types = given ? typesOf(given) : inferTypes(rows);
      if (!types) for (const [i, r] of rows.entries()) if (r.length !== 1 || typeof r[0] !== "string" || !BYTES32.test(r[0])) throw new HttpError(400, `value ${i + 1} is not a 32-byte hex leaf`);
      const { tree, hashed, treeIndex } = buildTree(rows, types);
      const want = opt(q, "proofFor", 100);
      let pick: number[];
      if (want !== undefined) {
        const byIndex = /^\d+$/.test(want) ? Number(want) : -1;
        const i = byIndex >= 0 && byIndex < rows.length ? byIndex : rows.findIndex((r) => String(r[0]).toLowerCase() === want.toLowerCase());
        if (i < 0) throw new HttpError(404, `no entry matches proofFor ${want.slice(0, 60)}`);
        pick = [i];
      } else pick = hashed.slice(0, MAX_PROOFS).map((h) => h.valueIndex);
      const entries = pick.map((i) => ({ index: i, value: plain(rows[i], types), leaf: hashed[i].hash, proof: proofFor(tree, treeIndex.get(i)!) }));
      const format = types ? "standard-v1" : "simple-v1";
      const dump = rows.length <= MAX_PROOFS
        ? { format, ...(types ? { leafEncoding: types } : {}), tree, values: rows.map((r, i) => ({ value: types ? plain(r, types) : r[0], treeIndex: treeIndex.get(i)! })) }
        : null;
      return {
        format, ...(types ? { leafEncoding: types } : {}), root: tree[0], count: rows.length, entries, proofsIncluded: entries.length,
        ...(rows.length > MAX_PROOFS && want === undefined ? { note: `proofs for the first ${MAX_PROOFS} entries; ask proofFor=<index or address> for any other` } : {}),
        dump,
        verifyOnChain: types
          ? `MerkleProof.verify(proof, root, keccak256(bytes.concat(keccak256(abi.encode(${types.map((t, i) => `${t} v${i}`).join(", ")})))))`
          : "MerkleProof.verify(proof, root, leaf)",
      };
    }),

  entry("/merkle/verify", "Merkle proof verify",
    "Check a Merkle proof against a root, the way OpenZeppelin's MerkleProof.verify does on chain (sorted-pair keccak256): give the leaf hash, or the entry's values and their Solidity types (double-keccak OpenZeppelin leaf). Returns valid true or false and the root the proof leads to. Use before submitting an airdrop claim or to debug an allowlist mint.",
    ["merkle-proof", "merkle-verify", "airdrop", "allowlist", "openzeppelin"], {
      root: { type: "string", description: "The Merkle root (32-byte hex)", required: true, example: "0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77" },
      proof: { type: "string", description: "The proof: JSON array or comma-separated 32-byte hashes", required: true, example: "[\"0xb92c48e9d7abe27fd8dfd6b5dfdbfb1c9a463f80c712b66f3a5180a090cccafc\"]" },
      // Required, because the published example carries only required inputs (6 Nov 2026 smoke run: "give leaf").
      leaf: { type: "string", description: "The leaf hash, or the entry's fields (comma-separated or a JSON array) to hash with types", required: true, example: "0xeb02c421cfa48976e66dfb29120745909ea3a0f843456c263cf8f1253483e283" },
      value: { type: "string", description: "The entry's fields, instead of leaf (comma-separated or a JSON array)", example: "0x1111111111111111111111111111111111111111,5000000000000000000" },
      types: { type: "string", description: "Solidity types of value's fields (default address,uint256)", example: "address,uint256" },
    },
    { valid: true, root: "0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77", computedRoot: "0xd4dee0beab2d53f2cc83e567171bd2820e49898130a22622b10ead383e90bd77", leaf: "0xeb02c421cfa48976e66dfb29120745909ea3a0f843456c263cf8f1253483e283", proofLength: 1 },
    (_env, q) => {
      const root = need(q, "root", 80).toLowerCase();
      if (!BYTES32.test(root)) throw new HttpError(400, "root must be a 32-byte hex hash");
      const proof = proofInput(q);
      const leafIn = opt(q, "leaf", 20_000);
      const typesIn = opt(q, "types", 400);
      let leaf: Hex;
      // A 32-byte hash without types is the leaf itself; anything else is the entry's fields, hashed with types.
      if (leafIn && BYTES32.test(leafIn) && !typesIn) {
        leaf = leafIn.toLowerCase() as Hex;
      } else {
        const value = opt(q, "value", 20_000) ?? leafIn;
        if (!value) throw new HttpError(400, "give leaf (the hash, or the entry's fields with types)");
        const row = rowsOf(value.trim().startsWith("[") ? `[${value}]` : value)[0] ?? [];
        leaf = leafHash(typesOf(typesIn ?? "address,uint256"), row, 0);
      }
      const computedRoot = processProof(leaf, proof);
      return { valid: computedRoot === root, root, computedRoot, leaf, proofLength: proof.length };
    }),
];
