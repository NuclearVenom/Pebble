// Small utilities shared by renderer modules for loading third-party
// libraries from a CDN on demand. Two loading strategies are used
// depending on what each library ships:
//
//  - loadScript(url)  — for classic UMD/IIFE builds that attach a global
//    (e.g. DOMPurify, SmilesDrawer). Injects a <script> tag once and
//    resolves when it fires `load`. Safe to call repeatedly — a script for
//    a given URL is only ever injected once.
//
//  - Dynamic `import(url)` directly — for libraries with a real ESM build
//    (Mermaid's `mermaid.esm.min.mjs`, `@viz-js/viz`). Used inline in each
//    renderer module rather than wrapped here, since it's already a single
//    native expression.
//
// Both approaches mean the library's code is not fetched, parsed, or
// executed until a renderer that needs it is actually invoked.

const loadedScripts = new Map(); // url -> Promise<void>

export function loadScript(url) {
  if (loadedScripts.has(url)) return loadedScripts.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
  loadedScripts.set(url, promise);
  return promise;
}

const loadedStyles = new Set();

export function loadStylesheet(url) {
  if (loadedStyles.has(url)) return;
  loadedStyles.add(url);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}

/** djb2 — fast, dependency-free, collision-rare-enough for cache keys. Not cryptographic. */
export function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function escapeHtml(str) {
  return str.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
