// PLACEHOLDER — see blocktypes.js's note for "tikz" and
// docs/RENDERERS.md for the full rationale.
//
// The only realistic way to render arbitrary TikZ faithfully is a TeX
// engine (e.g. a WASM LaTeX build such as TikZJax). Those are multi-MB
// runtimes — reasonable for a dedicated TikZ-heavy tool, not as a default
// dependency for every Pebble session. `svg` is the practical stand-in
// for hand-authored diagrams in the meantime. This module intentionally
// throws if reached; renderers/shell.js short-circuits placeholder-status
// types before ever calling it.
async function render() {
  throw new Error("TikZ rendering is not implemented yet.");
}
export default { type: "tikz", render };
