// PDB/mmCIF 3D structure renderer via 3Dmol.js — a well-established,
// browser-native molecular viewer (WebGL, no server round-trip needed
// once loaded). This is one of the two renderers (with `geojson`) flagged
// `heavy` in blocktypes.js, so renderers/shell.js only calls render() once
// the block is within ~200px of the viewport, not as soon as it's parsed.

import { loadScript } from "../loader-utils.js";

const MOL3D_URL = "https://cdn.jsdelivr.net/npm/3dmol@2/build/3Dmol-min.js";

let mol3dReady = null;
function ensureMol3d() {
  if (!mol3dReady) mol3dReady = loadScript(MOL3D_URL);
  return mol3dReady;
}

function detectFormat(source, hint) {
  if (hint === "mmcif" || hint === "cif") return "mmcif";
  if (hint === "pdb") return "pdb";
  return /^data_/m.test(source) ? "mmcif" : "pdb";
}

async function render(source, options = {}) {
  await ensureMol3d();

  const format = detectFormat(source, options.rawLang);

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-mol3d-wrap";
  const viewerEl = document.createElement("div");
  viewerEl.className = "pebble-mol3d-viewer";
  wrapper.appendChild(viewerEl);

  const viewer = $3Dmol.createViewer(viewerEl, { backgroundColor: "#141416" });
  viewer.addModel(source, format);
  viewer.setStyle({}, { cartoon: { color: "spectrum" }, stick: { radius: 0.12 } });
  viewer.zoomTo();
  viewer.render();

  // 3Dmol needs a real, laid-out container to size its WebGL canvas
  // correctly; resize once more after the shell has inserted this node.
  requestAnimationFrame(() => viewer.resize());

  return { kind: "node", node: wrapper };
}

export default { type: "pdb", render };
