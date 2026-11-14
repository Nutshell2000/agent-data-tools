// A small ZIP reader for office files (14 Nov 2026). Word, Excel and PowerPoint files are ZIP archives of XML parts;
// reading them needs the central directory and raw-deflate, which the runtime has (DecompressionStream), so no
// library. Only what those files use: stored and deflated entries, no encryption, no ZIP64, no multi-disk archives.
// Every size comes from the file and is treated as untrusted: an entry is read only up to the limit the caller gives,
// so a small archive that expands to gigabytes is cut off instead of filling memory.
import { HttpError } from "./env";

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; offset: number; encrypted: boolean }

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

export const isZip = (b: Uint8Array) => b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** The archive's entries by name, from its central directory. Refuses what this reader cannot read. */
export function zipEntries(bytes: Uint8Array, maxEntries = 5000): Map<string, ZipEntry> {
  // The end record is the last 22 bytes plus an optional comment of up to 65,535 bytes.
  let end = -1;
  for (let i = bytes.length - 22, stop = Math.max(0, bytes.length - 22 - 65_535); i >= stop; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) { end = i; break; }
  }
  if (end < 0) throw new HttpError(422, "the file is not a readable ZIP archive (no end record)");
  const count = u16(bytes, end + 10);
  const dirSize = u32(bytes, end + 12);
  let at = u32(bytes, end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new HttpError(422, "the file uses ZIP64, which is not supported");
  if (count > maxEntries || at + dirSize > bytes.length) throw new HttpError(422, "the file's ZIP directory is damaged or too large");
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) throw new HttpError(422, "the file's ZIP directory is damaged");
    const flags = u16(bytes, at + 8);
    const nameLength = u16(bytes, at + 28);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { name, method: u16(bytes, at + 10), compressedSize: u32(bytes, at + 20), size: u32(bytes, at + 24), offset: u32(bytes, at + 42), encrypted: (flags & 1) === 1 });
    at += 46 + nameLength + u16(bytes, at + 30) + u16(bytes, at + 32);
  }
  return entries;
}

/** One entry's bytes, at most `limit` of them: an entry that is larger is refused rather than cut silently. */
export async function zipRead(bytes: Uint8Array, entry: ZipEntry, limit: number): Promise<Uint8Array> {
  if (entry.encrypted) throw new HttpError(422, "the file is password-protected");
  if (entry.offset + 30 > bytes.length || u32(bytes, entry.offset) !== 0x04034b50) throw new HttpError(422, "the file's ZIP data is damaged");
  const start = entry.offset + 30 + u16(bytes, entry.offset + 26) + u16(bytes, entry.offset + 28);
  if (start + entry.compressedSize > bytes.length) throw new HttpError(422, "the file's ZIP data is cut short");
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) {
    if (raw.length > limit) throw new HttpError(422, "a part of the file is larger than this tool reads");
    return raw;
  }
  if (entry.method !== 8) throw new HttpError(422, "the file uses a compression method that is not supported");
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel().catch(() => {}); throw new HttpError(422, "a part of the file is larger than this tool reads"); }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, "the file's compressed data could not be read");
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** An entry as text, or null when the archive has no such entry. */
export async function zipText(bytes: Uint8Array, entries: Map<string, ZipEntry>, name: string, limit: number): Promise<string | null> {
  const entry = entries.get(name);
  return entry ? new TextDecoder().decode(await zipRead(bytes, entry, limit)) : null;
}
