// Wires every block type from blocktypes.js to its renderer module. This
// file is imported once, eagerly, at startup — but all it does is register
// `() => import("./foo/index.js")` closures. None of those closures run
// until a block of that type is actually encountered, so importing this
// file costs nothing beyond a handful of tiny arrow-function allocations.
// Nothing here pulls in KaTeX, Mermaid, Chart.js, Leaflet, 3Dmol, etc.

import { registerLazy } from "./registry.js";

registerLazy("chem", () => import("./math/chem.js"));
registerLazy("chemfig", () => import("./chemfig/index.js"));
registerLazy("molecule", () => import("./molecule/index.js"));
registerLazy("svg", () => import("./svg/index.js"));
registerLazy("tikz", () => import("./tikz/index.js"));
registerLazy("circuit", () => import("./circuit/index.js"));
registerLazy("plot", () => import("./plot/index.js"));
registerLazy("dot", () => import("./graphviz/index.js"));
registerLazy("mermaid", () => import("./mermaid/index.js"));
registerLazy("fasta", () => import("./fasta/index.js"));
registerLazy("newick", () => import("./newick/index.js"));
registerLazy("pdb", () => import("./molecular3d/index.js"));
registerLazy("geojson", () => import("./geo/index.js"));
registerLazy("cif", () => import("./crystal/index.js"));
registerLazy("lilypond", () => import("./music/index.js"));
registerLazy("fen", () => import("./chess/fen.js"));
registerLazy("pgn", () => import("./chess/pgn.js"));
registerLazy("fits", () => import("./fits/index.js"));

// "math" is deliberately NOT registered here — it's handled as a fast
// synchronous path directly in main.js, reusing the exact same KaTeX call
// as inline/$$ math, rather than going through the async renderer/shell
// machinery meant for genuinely expensive renderers. See main.js.
