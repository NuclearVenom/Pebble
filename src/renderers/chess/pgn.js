// PGN renderer. chess.js is a small, dependency-free rules engine (no
// board UI of its own) — used here purely to parse PGN into a move list
// and a final FEN, which feeds the same board renderer FEN blocks use.
//
// NOTE: this shows the final position and the move list, not move-by-move
// interactive replay — see docs/RENDERERS.md for why that's deferred.

import { boardFromFen } from "./board.js";
import { escapeHtml } from "../loader-utils.js";

const CHESSJS_URL = "https://cdn.jsdelivr.net/npm/chess.js@1/+esm";

let chessJsReady = null;
function ensureChessJs() {
  if (!chessJsReady) chessJsReady = import(CHESSJS_URL);
  return chessJsReady;
}

function formatMoveList(history) {
  let out = "";
  for (let i = 0; i < history.length; i += 2) {
    const moveNum = i / 2 + 1;
    const white = history[i] || "";
    const black = history[i + 1] || "";
    out += `${moveNum}. ${white}${black ? "  " + black : ""}\n`;
  }
  return out.trim();
}

async function render(source) {
  const { Chess } = await ensureChessJs();
  const chess = new Chess();

  try {
    chess.loadPgn(source.trim());
  } catch (e) {
    throw new Error("Couldn't parse this as valid PGN.");
  }

  const headers = chess.header();
  const history = chess.history();
  if (history.length === 0) throw new Error("No moves found in this PGN.");

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-pgn-wrap";

  const titleParts = [headers.White, headers.Black].filter(Boolean);
  if (titleParts.length) {
    const title = document.createElement("div");
    title.className = "pebble-chess-caption";
    title.textContent = `${titleParts.join(" vs. ")}${headers.Result ? " · " + headers.Result : ""}`;
    wrapper.appendChild(title);
  }

  const layout = document.createElement("div");
  layout.className = "pebble-pgn-layout";
  layout.appendChild(boardFromFen(chess.fen()));

  const moves = document.createElement("pre");
  moves.className = "pebble-pgn-moves";
  moves.innerHTML = escapeHtml(formatMoveList(history));
  layout.appendChild(moves);

  wrapper.appendChild(layout);

  const caption = document.createElement("div");
  caption.className = "pebble-chess-caption";
  caption.textContent = "Final position";
  wrapper.appendChild(caption);

  return { kind: "node", node: wrapper };
}

export default { type: "pgn", render };
