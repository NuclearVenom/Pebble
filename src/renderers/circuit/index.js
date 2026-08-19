// PLACEHOLDER — see blocktypes.js's note for "circuit" and
// docs/RENDERERS.md for the full rationale.
//
// CircuiTikZ has the same TeX-engine dependency problem as `tikz` (it's
// built on TikZ). A from-scratch lightweight circuit-symbol renderer
// (small JSON/DSL -> SVG, similar in spirit to the `plot` or `newick`
// renderers) is a reasonable future path that wouldn't need a TeX engine
// at all, but hasn't been built yet. `svg` is the practical stand-in for
// circuit diagrams until then.
async function render() {
  throw new Error("Circuit rendering is not implemented yet.");
}
export default { type: "circuit", render };
