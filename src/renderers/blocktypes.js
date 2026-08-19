// Central catalog of every semantic fenced-code-block language Pebble gives
// special rendering to, beyond ordinary syntax-highlighted code. Everything
// that needs to know "what block types exist" reads from here — the block
// parser in main.js, the renderer registry's lazy-load table, the developer
// docs generator/reference, and the system prompt sent to the model. Add a
// new renderer by adding one entry here plus its module; nothing else needs
// to enumerate types by hand.
//
// `status`:
//   "full"        — real rendering, lazy-loaded on demand.
//   "partial"     — real rendering with known, documented limitations.
//   "placeholder" — architecture/interface exists; shows the source with an
//                   explanation instead of a bundled heavy runtime.
//
// `heavy` marks renderers whose *own* library is large enough that, beyond
// ordinary lazy-loading, they should only initialize once their block is
// near the viewport (see renderers/registry.js's viewport gating).

export const BLOCK_TYPES = [
  { type: "math", aliases: ["latex", "tex"], label: "Math", status: "full", heavy: false,
    note: "Core LaTeX math via KaTeX, plus braket/quantum notation and a siunitx-style unit subset as KaTeX macros." },
  { type: "chem", aliases: ["mhchem"], label: "Chemistry", status: "full", heavy: false,
    note: "mhchem syntax (\\ce{...}), rendered through the same KaTeX instance as math." },
  { type: "chemfig", aliases: [], label: "Structural formula", status: "placeholder", heavy: false,
    note: "Full chemfig needs a LaTeX engine. Use `molecule` (SMILES) for 2D structures in the meantime." },
  { type: "molecule", aliases: ["smiles"], label: "Molecule", status: "full", heavy: true,
    note: "SMILES 2D structures via SmilesDrawer." },
  { type: "svg", aliases: [], label: "Illustration", status: "full", heavy: false,
    note: "Sanitized inline SVG via DOMPurify." },
  { type: "tikz", aliases: [], label: "TikZ diagram", status: "placeholder", heavy: false,
    note: "Full TikZ needs a TeX engine (e.g. a WASM LaTeX build), which is too heavy to bundle by default. Prefer `svg` for hand-drawn diagrams until this is revisited." },
  { type: "circuit", aliases: ["circuitikz"], label: "Circuit", status: "placeholder", heavy: false,
    note: "CircuiTikZ needs a TeX engine. Prefer `svg` for circuit diagrams until this is revisited." },
  { type: "plot", aliases: ["chart"], label: "Plot", status: "full", heavy: true,
    note: "Function/line/scatter/bar plots via Chart.js from a small JSON schema." },
  { type: "dot", aliases: ["graphviz"], label: "Graph", status: "full", heavy: true,
    note: "Graphviz DOT layout via a WASM Graphviz build (@viz-js/viz), output as SVG." },
  { type: "mermaid", aliases: [], label: "Diagram", status: "full", heavy: true,
    note: "Mermaid diagrams (flowcharts, sequence, class, state, ER, etc.)." },
  { type: "fasta", aliases: [], label: "Sequence", status: "full", heavy: false,
    note: "DNA/RNA/protein sequence viewer, no external library." },
  { type: "newick", aliases: [], label: "Phylogenetic tree", status: "full", heavy: false,
    note: "Newick tree parsed and laid out as SVG, no external library." },
  { type: "pdb", aliases: ["mmcif"], label: "3D structure", status: "full", heavy: true,
    note: "Interactive 3D structure via 3Dmol.js. Only initializes once the block is near the viewport." },
  { type: "geojson", aliases: [], label: "Map", status: "full", heavy: true,
    note: "GeoJSON geometry via Leaflet. No tile provider is configured by default, so it renders without network access; a tile layer can be configured separately." },
  { type: "cif", aliases: [], label: "Crystal structure", status: "placeholder", heavy: true,
    note: "Deferred — a real CIF/crystallography viewer is a heavy, specialized runtime not justified for default loading." },
  { type: "lilypond", aliases: [], label: "Sheet music", status: "placeholder", heavy: true,
    note: "LilyPond has no practical lightweight browser/WASM engine yet. Deferred rather than bundling a large native dependency." },
  { type: "fen", aliases: [], label: "Chess position", status: "full", heavy: false,
    note: "Chess board from a FEN string, no external library." },
  { type: "pgn", aliases: [], label: "Chess game", status: "partial", heavy: true,
    note: "Move list and final position via chess.js. Move-by-move interactive replay is not yet implemented." },
  { type: "fits", aliases: [], label: "Astronomical image", status: "placeholder", heavy: true,
    note: "Deferred — low priority per spec; not loaded even architecturally beyond a stub." },
];

const byType = new Map();
const aliasToType = new Map();
for (const entry of BLOCK_TYPES) {
  byType.set(entry.type, entry);
  for (const alias of entry.aliases) aliasToType.set(alias, entry.type);
}

/** Resolves an alias (e.g. "smiles") to its canonical type (e.g. "molecule"). */
export function resolveBlockType(lang) {
  if (!lang) return null;
  const key = lang.toLowerCase();
  if (byType.has(key)) return key;
  if (aliasToType.has(key)) return aliasToType.get(key);
  return null;
}

export function getBlockTypeInfo(type) {
  return byType.get(type) || null;
}

export function isSemanticBlockType(lang) {
  return resolveBlockType(lang) !== null;
}
