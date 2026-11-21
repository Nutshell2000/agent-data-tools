// Readable errors from a script that runs a bundle through a `data:` URL import (scripts/build-reader-assets.mjs).
//
// 21 Nov 2026: one failing build step printed 39 MB. The script bundles the reader with esbuild and imports the bundle
// as `data:text/javascript;base64,…`; that whole address (about 13 MB) is the "file name" of every stack frame inside
// the bundle, and Node also prints it above the stack as the place of the error. With these handlers the script
// prints the error's message and the frames outside the bundle, says how many bundle frames it left out, and still
// exits 1. Nothing about what the build does or when it fails is changed.

const DATA_URL = /data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]{40,}/g;
const clip = (text) => String(text).replace(DATA_URL, (m) => `data:<bundle, ${Math.round(m.length / 1024)} KB>`);

/** The error as text: message first, then the stack frames that are not inside a data: URL bundle. */
export function shortStack(error) {
  if (!(error instanceof Error)) return clip(typeof error === "string" ? error : JSON.stringify(error) ?? String(error)).slice(0, 4000);
  const head = clip(`${error.name}: ${error.message}`).slice(0, 4000);
  const frames = String(error.stack ?? "").split("\n").filter((line) => /^\s+at /.test(line));
  const outside = frames.filter((line) => !/data:[a-z/+.-]+;base64,/.test(line));
  const hidden = frames.length - outside.length;
  const cause = error.cause ? `\n  caused by: ${shortStack(error.cause).split("\n").join("\n  ")}` : "";
  return [head, ...outside, ...(hidden ? [`    (${hidden} frame${hidden === 1 ? "" : "s"} inside the bundled code left out)`] : [])].join("\n") + cause;
}

/** Call once at the top of a script: an error that ends the script is printed short, and the exit code is 1. */
export function installShortStacks(label = "build") {
  const end = (error) => { process.stderr.write(`${label} failed: ${shortStack(error)}\n`); process.exit(1); };
  process.on("uncaughtException", end);
  process.on("unhandledRejection", end);
}
