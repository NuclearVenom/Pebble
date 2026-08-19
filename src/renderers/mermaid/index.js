// Mermaid renderer. Mermaid ships an official ESM build specifically meant
// for exactly this — `import()`-ing it directly from a CDN with no build
// step (see https://mermaid.js.org/config/usage). Initialized once with
// startOnLoad: false, since Pebble calls mermaid.render() itself per block
// rather than letting Mermaid scan the whole document.

const MERMAID_ESM_URL = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

let mermaidPromise = null;
let renderCount = 0;

async function ensureMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import(MERMAID_ESM_URL).then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict", // no raw HTML labels, no script execution
        fontFamily: "Inter, -apple-system, Segoe UI, system-ui, sans-serif",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

async function render(source) {
  const mermaid = await ensureMermaid();
  const id = `pebble-mermaid-${Date.now()}-${renderCount++}`;

  // mermaid.parse throws a descriptive error for invalid syntax without
  // attempting a render — used here so failures produce a clean message
  // rather than a half-drawn diagram.
  await mermaid.parse(source);
  const { svg } = await mermaid.render(id, source);

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-mermaid-wrap";
  wrapper.innerHTML = svg;

  const svgEl = wrapper.querySelector("svg");
  if (svgEl) {
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    svgEl.style.maxWidth = "100%";
    svgEl.style.height = "auto";
  }

  return { kind: "node", node: wrapper };
}

export default { type: "mermaid", render };
