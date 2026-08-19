// PLACEHOLDER — see blocktypes.js's note for "cif" and
// docs/RENDERERS.md for the full rationale.
//
// A real CIF/crystallography viewer (unit cell + symmetry expansion +
// 3D lattice rendering) is a specialized, fairly heavy capability with
// limited everyday use in an AI chat overlay. Deferred rather than
// bundled by default, consistent with keeping normal Pebble sessions
// lightweight.
async function render() {
  throw new Error("CIF rendering is not implemented yet.");
}
export default { type: "cif", render };
