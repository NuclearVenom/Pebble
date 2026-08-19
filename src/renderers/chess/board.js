// Shared FEN-board-to-DOM renderer. No library needed for a static board —
// it's an 8x8 grid and a font that already has chess glyphs (♔♛ etc).

const PIECE_GLYPHS = {
  K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
  k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

/** Parses just the board-placement field of a FEN string into an 8x8 array (rank 8 first). */
export function parseFenBoard(fen) {
  const placement = fen.trim().split(/\s+/)[0];
  const ranks = placement.split("/");
  if (ranks.length !== 8) throw new Error("FEN board must have 8 ranks separated by \"/\".");

  return ranks.map((rank) => {
    const row = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) row.push(null);
      } else if (PIECE_GLYPHS[ch]) {
        row.push(ch);
      } else {
        throw new Error(`Unrecognized FEN character "${ch}".`);
      }
    }
    if (row.length !== 8) throw new Error("Each FEN rank must describe exactly 8 squares.");
    return row;
  });
}

/** Builds a static chess board element from an 8x8 array as returned by parseFenBoard. */
export function buildBoardElement(board) {
  const grid = document.createElement("div");
  grid.className = "pebble-chess-board";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("div");
      const isLight = (r + c) % 2 === 0;
      sq.className = `pebble-chess-square ${isLight ? "light" : "dark"}`;
      const piece = board[r][c];
      if (piece) {
        sq.textContent = PIECE_GLYPHS[piece];
        sq.classList.add(piece === piece.toUpperCase() ? "white-piece" : "black-piece");
      }
      grid.appendChild(sq);
    }
  }
  return grid;
}

export function boardFromFen(fen) {
  return buildBoardElement(parseFenBoard(fen));
}
