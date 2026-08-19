import { boardFromFen } from "./board.js";

async function render(source) {
  const fen = source.trim();
  const board = boardFromFen(fen);

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-chess-wrap";
  wrapper.appendChild(board);

  const fields = fen.split(/\s+/);
  if (fields[1] === "w" || fields[1] === "b") {
    const caption = document.createElement("div");
    caption.className = "pebble-chess-caption";
    caption.textContent = fields[1] === "w" ? "White to move" : "Black to move";
    wrapper.appendChild(caption);
  }

  return { kind: "node", node: wrapper };
}

export default { type: "fen", render };
