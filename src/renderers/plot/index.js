// Plotting renderer. Chart.js was chosen over Vega-Lite for this: it's a
// fraction of the size, has no separate "spec compiler" step, and covers
// everything the spec asks for (function/line/scatter/bar, multiple
// series, axes, labels, legends) without needing a declarative-grammar
// runtime that Pebble's actual use case (single small charts, not
// dashboards) doesn't need.

import { loadScript } from "../loader-utils.js";
import { compileExpression } from "./expr.js";

const CHARTJS_URL = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";

let chartJsReady = null;
function ensureChartJs() {
  if (!chartJsReady) chartJsReady = loadScript(CHARTJS_URL);
  return chartJsReady;
}

const PALETTE = ["#a47ffc", "#6fe0a3", "#ff9a9a", "#7fc4fc", "#f7c873", "#fc7fd0"];

function sampleFunction(expression, xMin, xMax, samples) {
  const fn = compileExpression(expression);
  const points = [];
  const n = Math.max(2, Math.min(samples || 200, 2000));
  for (let i = 0; i <= n; i++) {
    const x = xMin + ((xMax - xMin) * i) / n;
    let y;
    try { y = fn({ x }); } catch (_) { y = NaN; }
    if (Number.isFinite(y)) points.push({ x, y });
  }
  return points;
}

function seriesToPoints(s) {
  if (Array.isArray(s.points)) return s.points;
  if (Array.isArray(s.x) && Array.isArray(s.y)) {
    return s.x.map((x, i) => ({ x, y: s.y[i] }));
  }
  throw new Error(`Series "${s.label || "?"}" needs an "expression" (for a function curve) or "points"/"x"+"y" arrays (for data).`);
}

function buildDatasets(spec) {
  const kind = spec.type || "line";
  const rawSeries = Array.isArray(spec.series) && spec.series.length
    ? spec.series
    : [{
        label: spec.label || spec.expression || "series 1",
        expression: spec.expression,
        x: spec.x,
        y: spec.y,
        points: spec.points,
      }];

  return rawSeries.map((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    // Decided per-series rather than from the top-level "type" alone: a
    // series with its own "expression" is sampled as a function even if
    // the outer spec says "line" (an easy, harmless mix-up when a
    // response has some series that are formulas and others that are
    // data — see docs/RENDERERS.md).
    const isFunctionSeries = typeof s.expression === "string" && s.expression.trim() !== "";
    const data = isFunctionSeries
      ? sampleFunction(s.expression, s.xMin ?? spec.xMin ?? -10, s.xMax ?? spec.xMax ?? 10, s.samples ?? spec.samples ?? 200)
      : seriesToPoints(s);

    return {
      label: s.label || s.expression || `series ${i + 1}`,
      data,
      borderColor: color,
      backgroundColor: kind === "bar" ? color + "cc" : color + "33",
      pointRadius: kind === "scatter" ? 3 : (isFunctionSeries ? 0 : 2),
      borderWidth: 2,
      tension: isFunctionSeries ? 0.25 : 0.15,
      fill: false,
      showLine: kind !== "scatter",
    };
  });
}

async function render(source) {
  await ensureChartJs();

  let spec;
  try {
    spec = JSON.parse(source);
  } catch (e) {
    throw new Error("Plot source isn't valid JSON.");
  }

  const kind = spec.type || "line";
  const chartType = kind === "function" ? "line" : kind === "bar" ? "bar" : kind === "scatter" ? "scatter" : "line";
  const datasets = buildDatasets(spec);

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-plot-wrap";
  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);

  const textColor = "rgba(241,239,245,0.75)";
  const gridColor = "rgba(255,255,255,0.08)";

  new Chart(canvas.getContext("2d"), {
    type: chartType,
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: datasets.length > 1, labels: { color: textColor } },
        title: { display: !!spec.title, text: spec.title || "", color: textColor },
      },
      scales: {
        x: {
          type: "linear",
          title: { display: !!spec.xLabel, text: spec.xLabel || "", color: textColor },
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
        y: {
          title: { display: !!spec.yLabel, text: spec.yLabel || "", color: textColor },
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
      },
    },
  });

  return { kind: "node", node: wrapper };
}

export default { type: "plot", render };
