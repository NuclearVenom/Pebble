// FASTA renderer. Sequence viewers don't need a bioinformatics library —
// this is just text formatting (wrapping + position numbers) plus a
// simple heuristic to label DNA vs RNA vs protein.

import { escapeHtml } from "../loader-utils.js";

const WRAP_WIDTH = 60;

function detectKind(seq) {
  const upper = seq.toUpperCase();
  const counts = { A: 0, C: 0, G: 0, T: 0, U: 0, N: 0, other: 0 };
  for (const ch of upper) {
    if (ch in counts) counts[ch]++;
    else if (ch !== "\n" && ch !== " ") counts.other++;
  }
  const nucleotideLike = counts.A + counts.C + counts.G + counts.T + counts.U + counts.N;
  const total = nucleotideLike + counts.other;
  if (total === 0) return "Sequence";
  if (nucleotideLike / total > 0.9) return counts.U > counts.T ? "RNA" : "DNA";
  return "Protein";
}

function parseFasta(text) {
  const records = [];
  let current = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith(">")) {
      current = { header: line.slice(1).trim(), seq: "" };
      records.push(current);
    } else if (current) {
      current.seq += line.replace(/\s/g, "");
    } else {
      // Sequence with no header line — treat the whole thing as one record.
      current = { header: "", seq: line.replace(/\s/g, "") };
      records.push(current);
    }
  }
  return records;
}

function renderRecord(record) {
  const kind = detectKind(record.seq);
  const el = document.createElement("div");
  el.className = "pebble-fasta-record";

  if (record.header) {
    const header = document.createElement("div");
    header.className = "pebble-fasta-header";
    header.innerHTML = `<span class="pebble-fasta-kind">${kind}</span> ${escapeHtml(record.header)}`;
    el.appendChild(header);
  }

  const pre = document.createElement("pre");
  pre.className = "pebble-fasta-seq";
  let out = "";
  for (let i = 0; i < record.seq.length; i += WRAP_WIDTH) {
    const chunk = record.seq.slice(i, i + WRAP_WIDTH);
    out += `${String(i + 1).padStart(6, " ")}  ${chunk}\n`;
  }
  pre.textContent = out.trimEnd();
  el.appendChild(pre);

  return el;
}

async function render(source) {
  const records = parseFasta(source);
  if (records.length === 0) throw new Error("No sequence found.");

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-fasta-wrap";
  for (const record of records) wrapper.appendChild(renderRecord(record));

  return { kind: "node", node: wrapper };
}

export default { type: "fasta", render };
