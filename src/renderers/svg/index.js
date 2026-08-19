// SVG renderer. This is the one renderer where a mistake is a real
// security bug, not just a bad diagram — so sanitization is intentionally
// conservative (deny-list *and* an explicit strip of the highest-risk
// tags/attributes, rather than trusting DOMPurify's SVG defaults alone).

import { loadScript } from "../loader-utils.js";

const DOMPURIFY_URL = "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js";

let domPurifyReady = null;

function ensureDomPurify() {
  if (!domPurifyReady) domPurifyReady = loadScript(DOMPURIFY_URL);
  return domPurifyReady;
}

const SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  // Explicitly forbidden regardless of profile defaults.
  FORBID_TAGS: ["script", "foreignObject", "iframe", "embed", "object", "use"],
  FORBID_ATTR: [
    "onload", "onerror", "onclick", "onmouseover", "onmouseenter", "onmouseleave",
    "onfocus", "onblur", "onanimationstart", "onanimationend", "onbegin", "onend",
    "onrepeat", "href", "xlink:href",
  ],
  ALLOW_DATA_ATTR: false,
};

function extractSvgSource(raw) {
  const match = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) throw new Error("No <svg>...</svg> element found in this block.");
  return match[0];
}

async function render(source) {
  await ensureDomPurify();

  const svgSource = extractSvgSource(source);
  const clean = DOMPurify.sanitize(svgSource, SANITIZE_CONFIG);
  if (!clean || !/^<svg/i.test(clean.trim())) {
    throw new Error("The SVG was empty after sanitization — it likely only contained disallowed content.");
  }

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-svg-wrap";
  wrapper.innerHTML = clean;

  const svgEl = wrapper.querySelector("svg");
  if (svgEl) {
    // Scale responsively to the panel width instead of trusting whatever
    // fixed width/height the model emitted.
    if (!svgEl.getAttribute("viewBox")) {
      const w = svgEl.getAttribute("width") || "300";
      const h = svgEl.getAttribute("height") || "150";
      svgEl.setAttribute("viewBox", `0 0 ${parseFloat(w) || 300} ${parseFloat(h) || 150}`);
    }
    svgEl.removeAttribute("width");
    svgEl.removeAttribute("height");
    svgEl.style.width = "100%";
    svgEl.style.height = "auto";
    svgEl.style.display = "block";
  }

  return { kind: "node", node: wrapper };
}

export default { type: "svg", render };
