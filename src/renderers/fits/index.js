// PLACEHOLDER — see blocktypes.js's note for "fits" and
// docs/RENDERERS.md for the full rationale.
//
// Explicitly low priority per spec. Not loaded even architecturally
// beyond this stub, which exists only so the type is on record in the
// registry for future implementation (e.g. via a lightweight WASM/JS
// FITS parser rendering to a <canvas>).
async function render() {
  throw new Error("FITS rendering is not implemented yet.");
}
export default { type: "fits", render };
