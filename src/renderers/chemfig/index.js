// PLACEHOLDER — see blocktypes.js's note for "chemfig" and
// docs/RENDERERS.md for the full rationale.
//
// chemfig is a LaTeX package; a faithful implementation needs a TeX
// engine, which is a large runtime this project isn't bundling by
// default (see the `tikz` renderer for the same tradeoff, which chemfig
// shares since it's built on TikZ). renderers/shell.js shows the
// original source with an explanatory note instead of calling this
// module — the export below exists so the interface is on record for a
// future implementation (e.g. a from-scratch structural-formula-only
// parser, which would avoid needing full TikZ).
async function render() {
  throw new Error("chemfig rendering is not implemented yet.");
}
export default { type: "chemfig", render };
