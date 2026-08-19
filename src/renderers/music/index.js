// PLACEHOLDER — see blocktypes.js's note for "lilypond" and
// docs/RENDERERS.md for the full rationale.
//
// LilyPond itself is a native engraving engine; there is no mature,
// lightweight browser/WASM build of it suitable for bundling today.
// (VexFlow can render music notation in-browser, but from its own
// JSON/JS API, not by interpreting LilyPond source — supporting
// LilyPond's actual syntax on top of VexFlow would be a real parser
// project of its own, not a thin adapter.) Deferred rather than
// introducing a bad architectural dependency.
async function render() {
  throw new Error("LilyPond rendering is not implemented yet.");
}
export default { type: "lilypond", render };
