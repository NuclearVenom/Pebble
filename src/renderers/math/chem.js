// Chemistry renderer (mhchem) for explicit ```chem fenced blocks.
//
// mhchem is loaded eagerly in index.html now, right alongside KaTeX itself
// — it's a small file, and having chemistry be exactly as reliable as
// math (no async gap, no loading state) was worth the small fixed cost.
// This module no longer does its own loading for that reason (doing so
// would risk double-injecting the same <script> — see loader-utils.js's
// loadScript, which only dedupes URLs it injected itself).
//
// This fenced-block path is a secondary safety net now — main.js also
// scans raw response text directly for \ce{...}/\pu{...} (see
// extractChem() there), which is what actually makes chemistry work
// regardless of whether the model uses this fence, inline code, or plain
// text. Both paths render through the same KaTeX call either way.

import { KATEX_MACROS } from "./macros.js";

async function render(source) {
  const trimmed = source.trim();
  // Be forgiving: if the model forgot the \ce{...} wrapper, add it rather
  // than failing outright.
  const tex = /^\\(ce|pu)\{/.test(trimmed) ? trimmed : `\\ce{${trimmed}}`;

  const html = katex.renderToString(tex, {
    throwOnError: true,
    displayMode: true,
    strict: false,
    macros: { ...KATEX_MACROS },
  });
  return { kind: "html", html };
}

export default { type: "chem", render };
