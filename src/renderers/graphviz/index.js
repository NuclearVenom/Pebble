// Graphviz/DOT renderer. @viz-js/viz is a WASM build of real Graphviz with
// a minimal ESM wrapper — it's the actively-maintained successor to the
// classic viz.js, loaded here via jsDelivr's `+esm` endpoint (which
// generates an ESM entry point for arbitrary npm packages) so it can be
// dynamically import()ed with no build step.

const VIZ_ESM_URL = "https://cdn.jsdelivr.net/npm/@viz-js/viz@3/+esm";

let vizInstanceReady = null;
function ensureViz() {
  if (!vizInstanceReady) {
    vizInstanceReady = import(VIZ_ESM_URL).then((mod) => mod.instance());
  }
  return vizInstanceReady;
}

async function render(source) {
  const viz = await ensureViz();
  const svgEl = viz.renderSVGElement(source);
  svgEl.removeAttribute("width");
  svgEl.removeAttribute("height");
  svgEl.style.maxWidth = "100%";
  svgEl.style.height = "auto";

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-graphviz-wrap";
  wrapper.appendChild(svgEl);
  return { kind: "node", node: wrapper };
}

export default { type: "dot", render };
