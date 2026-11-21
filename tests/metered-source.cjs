// Which tools can spend metered money, read from the source (used by tests/free-metered.test.cjs).
//
// "Metered" = the tool's handler can reach one of the bindings or secrets that are billed per use:
//   env.AI                 Workers AI: chat, embeddings, rerank, moderation, translation, speech, transcription, images
//   env.BROWSER            hosted browser rendering
//   env.SEARCH_API_KEY     the paid web and news search API
//   env.RESALE_WALLET_KEY  data bought from another seller for each call
//   env.LAW_VECTORS, env.SE_VECTORS   Vectorize queries
//
// How: the entry module (src/tools.ts for the catalog) is bundled into one file, where esbuild gives every
// module-level name one meaning, and parsed. For each module-level name the reader notes what its code mentions: a
// read of one of the names above, other module-level names, and catalog paths handed to a call or compared with
// (`run(SEARCH, env, "/search", …)`, `LIST.find((e) => e.endpoint.path === "/pack/x")`: a tool run by its path).
// A tool is metered when its `run` function reaches a metered name through those names, or runs by path a tool that
// is. A catalog entry is found where it is made: a property of the `handlers` table in src/tools.ts, an object
// literal with `endpoint` and `run`, or a call to a function that makes one from a `run` argument (entry(), door()
// and the like, found by their shape, not by their name). Entries are data: walking through a list of entries does
// not follow the `run` of another tool. Reaching the dispatch table `handlers` itself does count: it can run anything.
//
// The answer errs on the side of "metered": a tool is listed when ANY branch of its handler can reach a metered name.
// What it cannot see: a tool run through a path that is built at run time and never written as a string, and metered
// use that does not go through `env`. Entry paths made by door() are also checked by their canonical tool
// (ENTRY_OF, in the test).
const Module = require("node:module");
const esbuild = require("esbuild");
const esprima = require("esprima");

const SINKS = new Set(["AI", "BROWSER", "SEARCH_API_KEY", "RESALE_WALLET_KEY", "LAW_VECTORS", "SE_VECTORS"]);

const isNode = (v) => v && typeof v === "object" && typeof v.type === "string";
const children = (node) => {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "range" || key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const x of v) if (isNode(x)) out.push([x, key]); }
    else if (isNode(v)) out.push([v, key]);
  }
  return out;
};
const isFunction = (n) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";
const keyName = (p) => (p.key.type === "Identifier" && !p.computed ? p.key.name : p.key.type === "Literal" ? String(p.key.value) : undefined);
const propOf = (obj, name) => obj.properties.find((p) => p.type === "Property" && keyName(p) === name);
const isEntryLiteral = (n) => n.type === "ObjectExpression" && propOf(n, "endpoint") && propOf(n, "run");

/** Names a pattern binds (parameters, declarations). */
function bound(pattern, into) {
  if (!pattern) return;
  if (pattern.type === "Identifier") into.add(pattern.name);
  else if (pattern.type === "ObjectPattern") for (const p of pattern.properties) bound(p.type === "RestElement" ? p.argument : p.value, into);
  else if (pattern.type === "ArrayPattern") for (const e of pattern.elements) bound(e, into);
  else if (pattern.type === "AssignmentPattern") bound(pattern.left, into);
  else if (pattern.type === "RestElement") bound(pattern.argument, into);
}
/** Every name declared inside a function (its parameters and the declarations of its own body, not of inner functions). */
function localsOf(fn) {
  const names = new Set();
  for (const p of fn.params) bound(p, names);
  if (fn.id && fn.type === "FunctionExpression") names.add(fn.id.name);
  (function scan(node) {
    for (const [child] of children(node)) {
      if (child.type === "VariableDeclarator") bound(child.id, names);
      if (child.type === "FunctionDeclaration" && child.id) names.add(child.id.name);
      if (child.type === "ClassDeclaration" && child.id) names.add(child.id.name);
      if (child.type === "CatchClause") bound(child.param, names);
      if (!isFunction(child)) scan(child);
    }
  })(fn.body);
  return names;
}

async function analyze(entryPoint = "src/tools.ts") {
  const built = await esbuild.build({ entryPoints: [entryPoint], bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], target: "es2017", supported: { bigint: true }, packages: "external", external: ["cloudflare:workers"], write: false, logLevel: "silent" });
  // The parser is older than three things the bundle may still hold: BigInt literals, import() and import.meta.
  const text = built.outputFiles[0].text.replace(/\b(0[xXoObB][\da-fA-F_]+|\d[\d_]*)n\b/g, "$1").replace(/\bimport\(/g, "__import(").replace(/\bimport\.meta\b/g, "__importMeta");
  const ast = esprima.parseModule(text, { range: true });

  // Module-level names and what they are defined as. A module esbuild wrapped (`__esm({ "file"() { name = value; } })`)
  // declares its names with a bare `var` and assigns them inside the wrapper.
  const moduleNames = new Set();
  const exported = new Map();
  const defs = new Map();
  const define = (name, node) => { (defs.get(name) ?? defs.set(name, []).get(name)).push(node); };
  for (const st of ast.body) {
    const decl = st.type === "ExportNamedDeclaration" && st.declaration ? st.declaration : st;
    if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") { moduleNames.add(decl.id.name); define(decl.id.name, decl); }
    if (decl.type === "VariableDeclaration") for (const d of decl.declarations) { const names = new Set(); bound(d.id, names); for (const n of names) moduleNames.add(n); if (d.init && d.id.type === "Identifier") define(d.id.name, d.init); }
    if (decl.type === "ImportDeclaration") for (const s of decl.specifiers) moduleNames.add(s.local.name);
    if (st.type === "ExportNamedDeclaration") for (const s of st.specifiers ?? []) exported.set(s.exported.name, s.local.name);
  }
  // A statement `router.get(path, handler)` at module level adds to what `router` is: its handlers run when it does.
  const registration = (node) => {
    if (node.type === "ExpressionStatement" && node.expression.type === "CallExpression" && node.expression.callee.type === "MemberExpression" && node.expression.callee.object.type === "Identifier" && moduleNames.has(node.expression.callee.object.name)) define(node.expression.callee.object.name, node.expression);
  };
  for (const st of ast.body) registration(st);
  const wrappers = [];
  (function findWrappers(node) {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "__esm" && node.arguments[0]?.type === "ObjectExpression") {
      for (const p of node.arguments[0].properties) if (p.type === "Property" && isFunction(p.value)) wrappers.push(p.value.body);
      return;
    }
    for (const [child] of children(node)) if (!isFunction(child)) findWrappers(child);
  })(ast);
  for (const body of wrappers) {
    for (const st of body.body ?? []) registration(st);
    (function assignments(node) {
      if (node.type === "AssignmentExpression" && node.operator === "=" && node.left.type === "Identifier" && moduleNames.has(node.left.name)) define(node.left.name, node.right);
      // Only the wrapper's own statements: an assignment inside a function is that function's business.
      for (const [child] of children(node)) if (!isFunction(child)) assignments(child);
    })(body);
  }

  // The functions that make a catalog entry from a `run` parameter, with that parameter's position: one that builds
  // the object literal itself, or one that hands its `run` on to another maker.
  const ENTRY_MAKERS = {};
  const paramName = (p) => (p.type === "AssignmentPattern" ? p.left.name : p.name);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, nodes] of defs) {
      if (Object.hasOwn(ENTRY_MAKERS, name)) continue;
      for (const fn of nodes.filter(isFunction)) {
        const index = fn.params.findIndex((p) => /^run\d*$/.test(paramName(p) ?? ""));
        if (index < 0) continue;
        const run = paramName(fn.params[index]);
        const makes = (function seek(node) {
          if (isEntryLiteral(node) && propOf(node, "run").value.type === "Identifier" && propOf(node, "run").value.name === run) return true;
          if (node.type === "CallExpression" && node.callee.type === "Identifier" && Object.hasOwn(ENTRY_MAKERS, node.callee.name)) {
            const arg = node.arguments[ENTRY_MAKERS[node.callee.name]];
            if (arg && arg.type === "Identifier" && arg.name === run) return true;
          }
          return children(node).some(([child]) => !isFunction(child) && seek(child));
        })(fn.body);
        if (makes) { ENTRY_MAKERS[name] = index; grew = true; }
      }
    }
  }
  const wholeCatalog = /(^|[\\/])src[\\/]tools\.ts$/.test(entryPoint);
  for (const expected of wholeCatalog ? ["entry", "door"] : []) {
    if (!Object.keys(ENTRY_MAKERS).some((n) => new RegExp(`^${expected}\\d*$`).test(n))) throw new Error(`metered-source: ${expected}() was not recognised as a function that makes catalog entries; read tests/metered-source.cjs`);
  }
  const makerOf = (call) => (call.callee.type === "Identifier" && Object.hasOwn(ENTRY_MAKERS, call.callee.name) ? call.callee.name : undefined);
  // A module wrapper (`init_x = __esm(...)`) only initialises a module: calling it is not a call of what the module holds.
  const isWrapper = (name) => (defs.get(name) ?? []).some((n) => n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "__esm");

  /**
   * What one piece of code mentions itself: the first metered binding it reads, the module-level names it uses, and
   * the catalog paths it hands to a call (`run(SEARCH, env, "/search", …)`: a tool run through a helper, by its path).
   */
  function scan(top, outerScopes, inName) {
    const out = { sink: null, names: new Set(), paths: new Set() };
    (function walk(node, scopes) {
      if (node.type === "MemberExpression") {
        const sink = !node.computed && node.property.type === "Identifier" ? node.property.name : node.computed && node.property.type === "Literal" ? String(node.property.value) : undefined;
        if (sink && SINKS.has(sink)) out.sink ??= `env.${sink} in ${inName}`;
        walk(node.object, scopes);
        if (node.computed) walk(node.property, scopes);
        return;
      }
      if (node.type === "ObjectPattern") {
        for (const p of node.properties) if (p.type === "Property" && SINKS.has(keyName(p) ?? "")) out.sink ??= `env.${keyName(p)} in ${inName}`;
      }
      // A path handed to a call or compared with: the code may look the tool up by it and run it
      // (`run(SEARCH, env, "/search", …)`, `LIST.find((e) => e.endpoint.path === "/pack/x")`). A path that is only
      // data (a table of suggestions, a link in an answer) is not a call. Whether the string is a catalog path is
      // settled when the reasons are read.
      const operands = node.type === "CallExpression" && !makerOf(node) ? node.arguments : node.type === "BinaryExpression" && /^[!=]==?$/.test(node.operator) ? [node.left, node.right] : [];
      for (const x of operands) {
        const literal = x.type === "Literal" && typeof x.value === "string" ? x.value : x.type === "TemplateLiteral" && x.quasis.length === 1 ? x.quasis[0].value.cooked : undefined;
        if (literal && /^\/[a-z0-9][a-z0-9/-]*$/.test(literal)) out.paths.add(literal);
      }
      // Another tool's entry is data here: listing it does not call its run function, and its texts name no call.
      if (node !== top && node.type === "CallExpression" && makerOf(node)) return;
      if (node !== top && isEntryLiteral(node)) return;
      if (node.type === "Property") {
        if (node.computed) walk(node.key, scopes);
        walk(node.value, scopes);
        return;
      }
      if (node.type === "Identifier") {
        if (!scopes.some((s) => s.has(node.name)) && defs.has(node.name) && !isWrapper(node.name)) out.names.add(node.name);
        return;
      }
      const inner = isFunction(node) ? [...scopes, localsOf(node)] : scopes;
      for (const [child, key] of children(node)) {
        if ((node.type === "LabeledStatement" || node.type === "BreakStatement" || node.type === "ContinueStatement") && key === "label") continue;
        if (node.type === "MethodDefinition" && key === "key" && !node.computed) continue;
        if (isFunction(node) && key === "id") continue;
        walk(child, inner);
      }
    })(top, outerScopes);
    return out;
  }
  const infoOf = new Map();
  function info(name) {
    if (!infoOf.has(name)) {
      const merged = { sink: null, names: new Set(), paths: new Set() };
      infoOf.set(name, merged);
      for (const node of defs.get(name) ?? []) {
        const one = scan(node, [], name);
        merged.sink ??= one.sink;
        for (const n of one.names) merged.names.add(n);
        for (const p of one.paths) merged.paths.add(p);
      }
    }
    return infoOf.get(name);
  }
  /** Everything a piece of code can reach through module-level names: the first metered binding, and every path handed to a call. */
  function closure(start) {
    let sink = start.sink;
    const paths = new Set(start.paths);
    const seen = new Set();
    const queue = [...start.names];
    while (queue.length) {
      const name = queue.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      const i = info(name);
      sink ??= i.sink;
      for (const p of i.paths) paths.add(p);
      for (const n of i.names) if (!seen.has(n)) queue.push(n);
    }
    return { sink, paths };
  }

  // Every call by the name it calls (to read the paths a local helper is called with), and every place an entry is made.
  const callsOf = new Map();
  const sites = [];
  (function visit(node, fnStack) {
    if (node.type === "CallExpression" && node.callee.type === "Identifier") {
      (callsOf.get(node.callee.name) ?? callsOf.set(node.callee.name, []).get(node.callee.name)).push(node);
      const maker = makerOf(node);
      if (maker && node.arguments[0]) sites.push({ pathExpr: node.arguments[0], run: node.arguments[ENTRY_MAKERS[maker]], fnStack, at: node.range[0] });
    }
    if (isEntryLiteral(node)) {
      const endpoint = propOf(node, "endpoint").value;
      const p = endpoint.type === "ObjectExpression" ? propOf(endpoint, "path") : undefined;
      sites.push({ pathExpr: p?.value, run: propOf(node, "run").value, fnStack, at: node.range[0] });
    }
    for (const [child, key] of children(node)) {
      let stack = fnStack;
      if (isFunction(child)) {
        const name = child.id?.name ?? (node.type === "VariableDeclarator" && node.id.type === "Identifier" ? node.id.name : node.type === "AssignmentExpression" && node.left.type === "Identifier" && key === "right" ? node.left.name : undefined);
        stack = [...fnStack, { fn: child, name }];
      }
      visit(child, stack);
    }
  })(ast, []);

  /** The paths a path expression can be: exact strings, or a pattern for a template. null when it cannot be read. */
  function pathsOf(expr, fnStack, depth = 0) {
    if (!expr) return null;
    if (expr.type === "Literal" && typeof expr.value === "string") return [{ exact: expr.value }];
    if (expr.type === "TemplateLiteral") {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return [{ pattern: new RegExp("^" + expr.quasis.map((q) => esc(q.value.cooked)).join("[^/]+") + "$") }];
    }
    if (expr.type !== "Identifier" || depth >= 3) return null;
    // A parameter of a named local helper: the paths are what the helper is called with.
    for (let i = fnStack.length - 1; i >= 0; i--) {
      const { fn, name } = fnStack[i];
      const index = fn.params.findIndex((p) => paramName(p) === expr.name);
      if (index >= 0) {
        if (!name) return null;
        const out = [];
        for (const call of callsOf.get(name) ?? []) { const got = pathsOf(call.arguments[index], [], depth + 1); if (!got) return null; out.push(...got); }
        return out.length ? out : null;
      }
      if (localsOf(fn).has(expr.name)) return null;
    }
    // A module-level constant that holds the path.
    if (!defs.has(expr.name)) return null;
    const out = [];
    for (const d of defs.get(expr.name)) { const got = pathsOf(d, [], depth + 1); if (!got) return null; out.push(...got); }
    return out;
  }

  // Per catalog entry: the metered binding its handler reaches itself, and the other tools it runs by path.
  const exact = new Map(); // path -> { sink, calls }
  const patterns = []; // { pattern, sink, calls }
  const unplaced = []; // entries that reach something and whose own path could not be read
  const judge = (run, fnStack) => closure(scan(run, fnStack.map((f) => localsOf(f.fn)), "its handler"));
  for (const site of sites) {
    if (!site.run) continue; // door() without a run of its own runs its canonical tool
    const reached = judge(site.run, site.fnStack);
    if (!reached.sink && !reached.paths.size) continue;
    const paths = pathsOf(site.pathExpr, site.fnStack);
    if (!paths) { if (reached.sink) unplaced.push({ near: text.slice(site.at, site.at + 120).replace(/\s+/g, " "), why: reached.sink }); continue; }
    for (const p of paths) { if (p.exact !== undefined) exact.set(p.exact, reached); else patterns.push({ pattern: p.pattern, ...reached }); }
  }
  const table = (defs.get("handlers") ?? []).find((n) => n.type === "ObjectExpression");
  if (!table && wholeCatalog) throw new Error("metered-source: the handlers table of src/tools.ts was not found");
  for (const p of table?.properties ?? []) {
    if (p.type !== "Property" || !keyName(p)) continue;
    const reached = judge(p.value, []);
    if (reached.sink || reached.paths.size) exact.set(keyName(p), reached);
  }
  const reachedBy = (path) => exact.get(path) ?? patterns.find((x) => x.pattern.test(path));
  /** Why a set of reached things is metered: its own binding, or a tool it runs by path that is (followed to any depth). */
  function reason(reached, seen) {
    if (reached.sink) return reached.sink;
    for (const p of reached.paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      const inner = reachedBy(p);
      const why = inner && reason(inner, seen);
      if (why) return `runs ${p} (${why})`;
    }
    return undefined;
  }
  return {
    /** Why a catalog path is metered, or undefined. */
    meteredReason: (path) => { const r = reachedBy(path); return r ? reason(r, new Set([path])) : undefined; },
    /** The literal paths whose handler reaches anything (paused tools are among them). */
    exactPaths: [...exact.keys()],
    unplaced,
    entries: sites.length + (table?.properties.length ?? 0),
    /** The module's exported names. */
    names: [...exported.keys()],
    /** Why an exported function or value of the entry module reaches a metered binding, or null. Throws on an unknown name. */
    reaches(name) {
      const local = exported.get(name);
      if (!local || !defs.has(local)) throw new Error(`metered-source: ${entryPoint} exports nothing named ${name}`);
      return reason(closure({ sink: null, names: new Set([local]), paths: new Set() }), new Set()) ?? null;
    },
  };
}

/** Loads a TypeScript module of this repository the way the other tests do. */
async function load(entry) {
  const b = await esbuild.build({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent", external: ["cloudflare:workers"] });
  const m = new Module(entry, null); m.filename = entry; m.paths = Module._nodeModulePaths(process.cwd()); m._compile(b.outputFiles[0].text, entry); return m.exports;
}

module.exports = { analyze, load, SINKS };
