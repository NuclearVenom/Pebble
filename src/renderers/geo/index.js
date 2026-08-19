// GeoJSON renderer via Leaflet. Deliberately does NOT add a default tile
// layer — a tile provider means a live network dependency and a specific
// third party's usage terms, which shouldn't be an implicit default for
// "render this GeoJSON". The geometry renders as vector shapes on a plain
// (CSS-styled) background instead, which is enough for the textbook cases
// in the spec (routes, borders, regions, points). A tile layer can be
// added later behind its own opt-in config (see docs/RENDERERS.md).

import { loadScript, loadStylesheet } from "../loader-utils.js";

const LEAFLET_JS = "https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.js";
const LEAFLET_CSS = "https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.css";

let leafletReady = null;
function ensureLeaflet() {
  if (!leafletReady) {
    loadStylesheet(LEAFLET_CSS);
    leafletReady = loadScript(LEAFLET_JS);
  }
  return leafletReady;
}

async function render(source) {
  await ensureLeaflet();

  let data;
  try {
    data = JSON.parse(source);
  } catch (e) {
    throw new Error("GeoJSON source isn't valid JSON.");
  }

  const wrapper = document.createElement("div");
  wrapper.className = "pebble-geo-wrap";
  const mapEl = document.createElement("div");
  mapEl.className = "pebble-geo-map";
  wrapper.appendChild(mapEl);

  // Leaflet needs the container attached and sized before it initializes.
  document.body.appendChild(wrapper);
  wrapper.style.position = "fixed";
  wrapper.style.visibility = "hidden";

  const map = L.map(mapEl, {
    attributionControl: false,
    zoomControl: true,
    scrollWheelZoom: false,
  });

  const layer = L.geoJSON(data, {
    style: { color: "#a47ffc", weight: 2, fillColor: "#a47ffc", fillOpacity: 0.15 },
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
      radius: 5, color: "#a47ffc", fillColor: "#a47ffc", fillOpacity: 0.8,
    }),
  }).addTo(map);

  const bounds = layer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
  } else {
    map.setView([0, 0], 1);
  }

  document.body.removeChild(wrapper);
  wrapper.style.position = "";
  wrapper.style.visibility = "";

  // Re-attach happens via the shell inserting `wrapper` into #output;
  // Leaflet needs one more size recalculation once it's actually laid out
  // in its final location. Both a rAF and a short timeout are used since
  // the exact moment "final location" layout settles can vary.
  requestAnimationFrame(() => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 150);

  return { kind: "node", node: wrapper };
}

export default { type: "geojson", render };
