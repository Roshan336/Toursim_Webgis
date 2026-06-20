import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(root, "src", "main.js"), "utf8");
const css = readFileSync(join(root, "src", "style.css"), "utf8");

assert.match(main, /view\.openPopup\(/, "POI list clicks should use ArcGIS 5 view.openPopup().");
assert.doesNotMatch(main, /view\.popup\.open\(/, "Do not call removed view.popup.open().");
assert.doesNotMatch(main, /view\.popup\.close\(/, "Do not call removed view.popup.close().");
assert.match(main, /new WebTileLayer\(/, "Default OSM basemap should use an explicit public WebTileLayer.");
assert.match(main, /createBasemap\("osm"\)/, "Map startup should use the explicit OSM basemap factory.");
assert.match(main, /routeResult\.route_geometry/, "Routes should draw the Google route-level geometry when available.");
assert.match(main, /drawRouteDirectionMarkers/, "Route drawing should show Google step nodes and direction arrows.");
assert.match(main, /seg\.instruction/, "Directions list should show Google step instructions.");
assert.match(main, /seg\.duration_seconds/, "Directions list should include Google step duration.");

for (const missingIcon of ['"hotel"', '"spoon-fork"', '"trees"']) {
  assert.doesNotMatch(main, new RegExp(`icon\\s*=\\s*${missingIcon}`), `${missingIcon} is not a Calcite 5.1.1 icon here.`);
}

assert.match(css, /calcite-shell\s*{[\s\S]*background:\s*transparent/, "Calcite shell host must stay transparent so the basemap remains visible.");
