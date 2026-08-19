// SMILES molecule renderer. SmilesDrawer is a small, dependency-free,
// pure-JS 2D structure renderer — much lighter than pulling in a full
// cheminformatics toolkit (e.g. RDKit's WASM build, which is tens of MB)
// for what's fundamentally "draw this molecule."

import { loadScript } from "../loader-utils.js";

const SMILES_DRAWER_URL = "https://cdn.jsdelivr.net/npm/smiles-drawer@2/dist/smiles-drawer.min.js";

let smilesDrawerReady = null;

function ensureSmilesDrawer() {
  if (!smilesDrawerReady) smilesDrawerReady = loadScript(SMILES_DRAWER_URL);
  return smilesDrawerReady;
}

function parseTree(smiles) {
  return new Promise((resolve, reject) => {
    SmilesDrawer.parse(smiles, resolve, reject);
  });
}

let renderCount = 0;

async function render(source) {
  await ensureSmilesDrawer();

  const smiles = source.trim();
  const tree = await parseTree(smiles);

  const canvas = document.createElement("canvas");
  const id = `pebble-mol-${Date.now()}-${renderCount++}`;
  canvas.id = id;
  canvas.className = "pebble-molecule-canvas";

  const drawer = new SmilesDrawer.Drawer({
    width: 360,
    height: 260,
    bondThickness: 1.1,
  });

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-molecule-wrap";
  wrapper.appendChild(canvas);
  // The canvas must be attached to the document for SmilesDrawer to size
  // and draw onto it correctly.
  document.body.appendChild(wrapper);
  try {
    drawer.draw(tree, id, "dark", false);
  } finally {
    document.body.removeChild(wrapper);
  }

  return { kind: "node", node: wrapper };
}

export default { type: "molecule", render };
