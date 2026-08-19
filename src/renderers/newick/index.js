// Newick tree renderer. A Newick parser is short and the tree layout is
// simple geometry, so this is implemented directly rather than pulling in
// a phylogenetics library for what's ultimately "parse nested parens, lay
// out a tree."

import { escapeHtml } from "../loader-utils.js";

function parseNewick(text) {
  const s = text.trim().replace(/;$/, "");
  let i = 0;

  function parseSubtree() {
    let node;
    if (s[i] === "(") {
      i++;
      const children = [parseSubtree()];
      while (s[i] === ",") {
        i++;
        children.push(parseSubtree());
      }
      if (s[i] !== ")") throw new Error('Malformed Newick: expected ")".');
      i++;
      node = { children };
    } else {
      node = { children: [] };
    }
    let name = "";
    while (i < s.length && !",():".includes(s[i])) { name += s[i]; i++; }
    node.name = name.trim();
    if (s[i] === ":") {
      i++;
      let numStr = "";
      while (i < s.length && !",()".includes(s[i])) { numStr += s[i]; i++; }
      node.length = parseFloat(numStr);
    }
    return node;
  }

  const root = parseSubtree();
  if (!root) throw new Error("Empty Newick tree.");
  return root;
}

function layout(root) {
  let leafIndex = 0;
  function assignY(node) {
    if (node.children.length === 0) {
      node.y = leafIndex++;
    } else {
      for (const c of node.children) assignY(c);
      node.y = node.children.reduce((sum, c) => sum + c.y, 0) / node.children.length;
    }
  }
  assignY(root);

  let maxX = 0;
  function assignX(node, parentX) {
    const len = Number.isFinite(node.length) ? node.length : 1;
    node.x = parentX + len;
    maxX = Math.max(maxX, node.x);
    for (const c of node.children) assignX(c, node.x);
  }
  root.x = 0;
  for (const c of root.children) assignX(c, root.x);

  return { leafCount: Math.max(leafIndex, 1), maxX: maxX || 1 };
}

function buildSvg(root, { leafCount, maxX }) {
  const rowHeight = 26;
  const leftPad = 16;
  const rightPad = 160; // room for leaf labels
  const topPad = 16;
  const plotWidth = 420;
  const width = plotWidth + leftPad + rightPad;
  const height = leafCount * rowHeight + topPad * 2;

  const sx = (x) => leftPad + (x / maxX) * plotWidth;
  const sy = (y) => topPad + y * rowHeight;

  let lines = "";
  let labels = "";

  function walk(node, parentX) {
    const x0 = sx(parentX);
    const x1 = sx(node.x);
    const y = sy(node.y);
    lines += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" class="newick-branch"/>`;

    if (node.children.length) {
      const ys = node.children.map((c) => sy(c.y));
      lines += `<line x1="${x1}" y1="${Math.min(...ys)}" x2="${x1}" y2="${Math.max(...ys)}" class="newick-branch"/>`;
      for (const c of node.children) walk(c, node.x);
      if (node.name) {
        labels += `<text x="${x1 + 4}" y="${y - 4}" class="newick-internal-label">${escapeHtml(node.name)}</text>`;
      }
    } else {
      labels += `<text x="${x1 + 6}" y="${y + 4}" class="newick-leaf-label">${escapeHtml(node.name || "?")}</text>`;
      lines += `<circle cx="${x1}" cy="${y}" r="2.5" class="newick-leaf-dot"/>`;
    }
  }
  walk(root, root.x);

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="pebble-newick-svg">${lines}${labels}</svg>`;
}

async function render(source) {
  const tree = parseNewick(source);
  const metrics = layout(tree);
  const svg = buildSvg(tree, metrics);

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-newick-wrap";
  wrapper.innerHTML = svg;
  return { kind: "node", node: wrapper };
}

export default { type: "newick", render };
