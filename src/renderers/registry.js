// The renderer registry. This is the only place that knows how to go from
// a block type string ("mermaid", "chem", "molecule", ...) to an actual
// loaded renderer implementation.
//
// Every renderer module's default export matches:
//
//   interface ContentRenderer {
//     type: string;
//     render(source: string, options?: object): Promise<RenderedContent>;
//     dispose?(instanceState): void;
//   }
//
//   type RenderedContent =
//     | { kind: "node", node: Node }   // a DOM node ready to insert
//     | { kind: "html", html: string } // trusted HTML the caller can set
//
// `render()` should throw on failure — the caller (renderers/shell.js)
// turns that into the shared error UI. Renderers should not catch their
// own errors internally except to translate them into a clearer message.
//
// LAZY LOADING: registerLazy() takes a *function returning a dynamic
// import()*, not the module itself. Nothing is fetched, parsed, or run
// until getRenderer(type) is actually called for the first time — which
// only happens when a block of that type is actually encountered in a
// response. The import is memoized after that, so a second block of the
// same type in the same session reuses the already-loaded module.

import { resolveBlockType } from "./blocktypes.js";
import { hashString } from "./loader-utils.js";

const entries = new Map(); // canonical type -> { load, instance, loading }

export function registerLazy(type, load) {
  entries.set(type, { load, instance: null, loading: null });
}

export function isLoaded(type) {
  const key = resolveBlockType(type) || type;
  return !!entries.get(key)?.instance;
}

/** Loads (once) and returns the ContentRenderer for a block type, or null if unregistered. */
export async function getRenderer(rawType) {
  const type = resolveBlockType(rawType) || rawType;
  const entry = entries.get(type);
  if (!entry) return null;
  if (entry.instance) return entry.instance;
  if (!entry.loading) {
    entry.loading = entry
      .load()
      .then((mod) => {
        entry.instance = mod.default;
        return entry.instance;
      })
      .catch((err) => {
        entry.loading = null; // allow retry on a later call
        throw err;
      });
  }
  return entry.loading;
}

// ---------------- render cache ----------------
// Keyed on the block type + exact source + any options that affect output.
// A byte-identical block (very common — the same diagram appearing twice,
// or a re-render triggered by something unrelated) reuses the prior result
// instead of re-invoking a potentially expensive renderer.

const cache = new Map();
const MAX_CACHE_ENTRIES = 80;

export function cacheKeyFor(type, source, options) {
  return `${type}:${hashString(source)}:${options ? hashString(JSON.stringify(options)) : ""}`;
}

export function getCached(key) {
  return cache.get(key) || null;
}

export function setCached(key, value) {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, value);
}
