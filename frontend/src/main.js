import "./style.css";
import Basemap from "@arcgis/core/Basemap";
import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import TileLayer from "@arcgis/core/layers/TileLayer";
import WebTileLayer from "@arcgis/core/layers/WebTileLayer";
import esriConfig from "@arcgis/core/config";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Zoom from "@arcgis/core/widgets/Zoom";

// Calcite Custom Elements Loader
import { defineCustomElements } from '@esri/calcite-components/dist/loader';
import { setAssetPath } from "@esri/calcite-components/dist/components";

// Point Calcite asset path to CDN
setAssetPath("https://js.arcgis.com/calcite-components/5.1.1/assets");

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8001";
// Configure ArcGIS API Key (for hosted basemaps if needed)
// esriConfig.apiKey = "YOUR_KEY_HERE";

// ── OpenRouteService Routing API ───────────────────────────────────────────
const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjhiMTM3MjEyMWY2NjQ3MTFiZGY4M2JmODk0Zjc5MzNkIiwiaCI6Im11cm11cjY0In0=";
const ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

const BASEMAPS = {
  osm: {
    title: "OpenStreetMap",
    baseLayers: [
      () => new WebTileLayer({
        urlTemplate: "https://tile.openstreetmap.org/{level}/{col}/{row}.png",
        copyright: "OpenStreetMap contributors"
      })
    ]
  },
  "streets-vector": {
    title: "World Street Map",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer" })
    ]
  },
  "topo-vector": {
    title: "World Topographic Map",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer" })
    ]
  },
  "gray-vector": {
    title: "Light Gray Canvas",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer" })
    ],
    referenceLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer" })
    ]
  },
  "dark-gray-vector": {
    title: "Dark Gray Canvas",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer" })
    ],
    referenceLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer" })
    ]
  },
  satellite: {
    title: "World Imagery",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" })
    ]
  },
  hybrid: {
    title: "Imagery Hybrid",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" })
    ],
    referenceLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer" })
    ]
  },
  oceans: {
    title: "World Ocean Base",
    baseLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer" })
    ],
    referenceLayers: [
      () => new TileLayer({ url: "https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Reference/MapServer" })
    ]
  }
};

let map, view;
let poiGraphicsLayer, routeGraphicsLayer, tempGraphicsLayer;
let allPois = [];
let routingStartPoint = null;
let routingEndPoint = null;
let bufferCenterPoint = null;
let lastClickedCoords = null;

function createBasemap(id) {
  const config = BASEMAPS[id] || BASEMAPS.osm;
  return new Basemap({
    title: config.title,
    baseLayers: config.baseLayers.map(createLayer => createLayer()),
    referenceLayers: (config.referenceLayers || []).map(createLayer => createLayer())
  });
}

// Initial Setup: await Calcite custom element registration BEFORE map init.
// This prevents the ArcGIS SDK UI system from racing with Calcite polyfills
// which would cause "appendChild: parameter 1 is not of type 'Node'" in UI.js
document.addEventListener("DOMContentLoaded", async () => {
  await defineCustomElements(); // fully register all calcite-* elements first
  initMap();
  setupUIEventListeners();
  fetchPOIs();
});

// 1. Initialize Map and Views
function initMap() {
  poiGraphicsLayer = new GraphicsLayer({ id: "pois-layer" });
  routeGraphicsLayer = new GraphicsLayer({ id: "route-layer" });
  tempGraphicsLayer = new GraphicsLayer({ id: "temp-layer" });

  map = new Map({
    basemap: createBasemap("osm"),
    layers: [routeGraphicsLayer, tempGraphicsLayer, poiGraphicsLayer]
  });

  view = new MapView({
    container: "viewDiv",
    map: map,
    center: [-122.405, 37.795], // San Francisco Downtown
    zoom: 14,
    attributionVisible: true,
    ui: {
      components: []
    }
  });

  view.when(() => {
    view.ui.add(new Zoom({ view }), "top-left");
    console.log("Map and UI components loaded successfully.");
  }).catch(err => {
    console.error("MapView failed to load:", err);
    showToast("Map Error", "Failed to load map. Check console for details.", "danger");
  });

  // Map Listeners
  // Single click: handle buffer center selection or routing point selection
  view.on("click", (event) => {
    // If double click was not intended, get coordinates
    const lat = event.mapPoint.latitude;
    const lon = event.mapPoint.longitude;
    
    // Check which panel is active to contextually handle map click
    const activePanel = getActivePanelId();
    if (activePanel === "panel-buffer") {
      setBufferCenter(lon, lat);
    } else if (activePanel === "panel-routing") {
      setRoutePointFromMapClick(lon, lat);
    }
  });

  // Right click (hold or context) to add new POI
  view.on("hold", (event) => {
    openAddPoiModal(event.mapPoint.longitude, event.mapPoint.latitude);
  });

  // Also support double-click to add a POI easily
  view.on("double-click", (event) => {
    event.stopPropagation(); // prevent default zoom
    openAddPoiModal(event.mapPoint.longitude, event.mapPoint.latitude);
  });
}

// 2. Fetch Points of Interest from Backend
async function fetchPOIs() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/pois`);
    if (!response.ok) throw new Error("Database connection failed");
    const geojson = await response.json();
    
    allPois = geojson.features || [];
    renderPOIsOnMap(allPois);
    populatePOIList(allPois);
    populateRoutingSelects(allPois);
  } catch (error) {
    showToast("Error loading tourist spots", "Could not connect to PostGIS backend. Check if FastAPI is running.", "danger");
  }
}

// 3. Render POI features onto map
function renderPOIsOnMap(features) {
  poiGraphicsLayer.removeAll();
  
  features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    const props = feature.properties;
    
    // Pick symbol color based on category
    let color = [0, 122, 255]; // Blue (Attraction)
    if (props.category === "hotel") color = [255, 149, 0]; // Orange
    if (props.category === "restaurant") color = [255, 59, 48]; // Red
    if (props.category === "park") color = [52, 199, 89]; // Green

    const point = new Point({
      longitude: coords[0],
      latitude: coords[1],
      spatialReference: { wkid: 4326 }
    });

    const markerSymbol = {
      type: "simple-marker",
      color: color,
      size: "12px",
      outline: {
        color: [255, 255, 255],
        width: 1.5
      }
    };

    // Custom Popup Template
    const popupTemplate = {
      title: `{name}`,
      content: `
        <div style="font-family: 'Outfit', sans-serif;">
          ${props.image_url ? `<img class="poi-popup-img" src="${props.image_url}" alt="${props.name}"/>` : ""}
          <p><strong>Category:</strong> <span style="text-transform: capitalize;">${props.category}</span></p>
          <p><strong>Rating:</strong> ⭐ ${props.rating || "N/A"} / 5.0</p>
          <p><strong>Address:</strong> ${props.address || "No address provided"}</p>
          <p>${props.description || "No description available."}</p>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button class="custom-map-btn" onclick="window.setStartFromPopup(${coords[0]}, ${coords[1]}, '${props.name.replace(/'/g, "\\'")}')" title="Set Route Start">🚩</button>
            <button class="custom-map-btn" onclick="window.setEndFromPopup(${coords[0]}, ${coords[1]}, '${props.name.replace(/'/g, "\\'")}')" title="Set Route End">🏁</button>
            <button class="custom-map-btn" onclick="window.setBufferFromPopup(${coords[0]}, ${coords[1]}, '${props.name.replace(/'/g, "\\'")}')" title="Buffer from here">⭕</button>
            <button class="custom-map-btn" onclick="window.deletePoiFromPopup(${props.id}, '${props.name.replace(/'/g, "\\'")}')" title="Remove POI">🗑️</button>
          </div>
        </div>
      `
    };

    const graphic = new Graphic({
      geometry: point,
      symbol: markerSymbol,
      attributes: props,
      popupTemplate: popupTemplate
    });

    poiGraphicsLayer.add(graphic);
  });
}

// 4. Render POIs in Sidebar list
function populatePOIList(features) {
  const list = document.getElementById("pois-list");
  list.innerHTML = "";
  
  if (features.length === 0) {
    list.innerHTML = "<calcite-list-item description='No tourist sites found.'></calcite-list-item>";
    return;
  }

  features.forEach(feature => {
    const props = feature.properties;
    const coords = feature.geometry.coordinates;
    
    let icon = "tour";
    if (props.category === "hotel") icon = "home";
    if (props.category === "restaurant") icon = "shopping-cart";
    if (props.category === "park") icon = "tree";

    const item = document.createElement("calcite-list-item");
    item.setAttribute("label", props.name);
    item.setAttribute("description", `${props.address || ""} • ⭐ ${props.rating || "N/A"}`);
    item.setAttribute("icon-start", icon);
    
    // Zoom on click
    item.addEventListener("click", () => {
      view.goTo({
        center: [coords[0], coords[1]],
        zoom: 16
      }, { duration: 1000 });
      
      // Find matching graphic and open popup
      const matchingGraphic = poiGraphicsLayer.graphics.find(g => g.attributes.id === props.id);
      if (matchingGraphic) {
        view.openPopup({
          features: [matchingGraphic],
          location: matchingGraphic.geometry
        });
      }
    });

    list.appendChild(item);
  });
}

// 5. Populate select inputs for Routing panel
function populateRoutingSelects(features) {
  const startSelect = document.getElementById("route-start-select");
  const endSelect = document.getElementById("route-end-select");
  
  // Clear previous options except default
  startSelect.innerHTML = '<calcite-option value="" selected>-- Select Start POI --</calcite-option>';
  endSelect.innerHTML = '<calcite-option value="" selected>-- Select End POI --</calcite-option>';

  features.forEach(feature => {
    const props = feature.properties;
    const coords = feature.geometry.coordinates;
    const valString = `${coords[0]},${coords[1]}`;

    const optStart = document.createElement("calcite-option");
    optStart.value = valString;
    optStart.textContent = props.name;
    startSelect.appendChild(optStart);

    const optEnd = document.createElement("calcite-option");
    optEnd.value = valString;
    optEnd.textContent = props.name;
    endSelect.appendChild(optEnd);
  });
}

// 6. Calculate Route using OpenRouteService API
async function calculateRoute() {
  const startVal = document.getElementById("route-start-select").value;
  const endVal = document.getElementById("route-end-select").value;

  if (!startVal || !endVal) {
    showToast("Selection required", "Please choose both start and end locations.", "warning");
    return;
  }

  const [startLon, startLat] = startVal.split(",").map(Number);
  const [endLon, endLat] = endVal.split(",").map(Number);

  const btn = document.getElementById("btn-calculate-route");
  btn.setAttribute("loading", "");

  try {
    // POST to the ORS GeoJSON endpoint — returns proper GeoJSON directly
    const response = await fetch(`${ORS_BASE_URL}/geojson`, {
      method: "POST",
      headers: {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json, application/geo+json"
      },
      body: JSON.stringify({
        coordinates: [[startLon, startLat], [endLon, endLat]],
        instructions: true,
        language: "en"
      })
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `ORS API error ${response.status}`);
    }

    const geojson = await response.json();
    const feature = geojson.features[0];
    if (!feature) throw new Error("No route found between these locations.");

    const coords   = feature.geometry.coordinates;  // [[lon, lat], ...]
    const summary  = feature.properties.summary;    // { distance, duration }
    const segments = feature.properties.segments;   // [{ steps: [...] }]

    drawRoute(coords);
    displayDirections(summary, segments);

  } catch (error) {
    showToast("Routing Error", error.message, "danger");
  } finally {
    btn.removeAttribute("loading");
  }
}

// 7. Draw ORS route on the map
// coords: array of [lon, lat] pairs from ORS GeoJSON LineString
function drawRoute(coords) {
  routeGraphicsLayer.removeAll();
  if (!coords || coords.length < 2) return;

  // Build an ArcGIS Polyline from the ORS coordinate array
  const polyline = new Polyline({
    paths: [coords],          // coords is already [[lon,lat],...]
    spatialReference: { wkid: 4326 }
  });

  routeGraphicsLayer.add(new Graphic({
    geometry: polyline,
    symbol: {
      type: "simple-line",
      color: [0, 112, 255, 0.9],
      width: 5,
      cap: "round",
      join: "round"
    }
  }));

  // Start marker (green) and end marker (red)
  const startPt = coords[0];
  const endPt   = coords[coords.length - 1];

  routeGraphicsLayer.addMany([
    new Graphic({
      geometry: new Point({ longitude: startPt[0], latitude: startPt[1], spatialReference: { wkid: 4326 } }),
      symbol: { type: "simple-marker", color: [52, 199, 89], size: "14px", outline: { color: [255,255,255], width: 2.5 } }
    }),
    new Graphic({
      geometry: new Point({ longitude: endPt[0], latitude: endPt[1], spatialReference: { wkid: 4326 } }),
      symbol: { type: "simple-marker", color: [255, 59, 48],  size: "14px", outline: { color: [255,255,255], width: 2.5 } }
    })
  ]);

  view.goTo(polyline.extent.expand(1.5), { duration: 900 });
}

// 8. Display ORS turn-by-turn directions
// summary:  { distance (m), duration (s) }
// segments: [{ steps: [{ type, instruction, name, distance, duration }] }]
function displayDirections(summary, segments) {
  const container    = document.getElementById("route-results-container");
  const distTitle    = document.getElementById("route-distance-title");
  const list         = document.getElementById("route-directions-list");

  container.style.display = "block";

  const km   = (summary.distance / 1000).toFixed(2);
  const mins = Math.round(summary.duration / 60);
  distTitle.textContent = `🏁 ${km} km · ~${mins} min · powered by OpenRouteService`;

  list.innerHTML = "";

  const steps = segments?.[0]?.steps ?? [];
  if (steps.length === 0) {
    list.innerHTML = "<calcite-list-item description='No turn-by-turn steps available.'></calcite-list-item>";
    return;
  }

  steps.forEach((step, idx) => {
    const item = document.createElement("calcite-list-item");
    const dist = step.distance < 1000
      ? `${Math.round(step.distance)} m`
      : `${(step.distance / 1000).toFixed(1)} km`;
    const dur  = formatDuration(step.duration);

    item.setAttribute("label",       `${idx + 1}. ${step.instruction}`);
    item.setAttribute("description", `${dist} · ${dur}`);
    item.setAttribute("icon-start",  getORSStepIcon(step.type));
    list.appendChild(item);
  });
}

// Map ORS step type integers to Calcite icon names
// Reference: https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/instruction-types
function getORSStepIcon(type) {
  const icons = {
    0:  "arrow-up",          // Left (sharp)
    1:  "arrow-up",          // Left
    2:  "arrow-left",        // Slight left
    3:  "arrow-right",       // Slight right
    4:  "arrow-right",       // Right
    5:  "arrow-right",       // Right (sharp)
    6:  "refresh",           // U-turn
    7:  "arrow-up",          // Keep left
    8:  "arrow-up",          // Keep right
    10: "gps-on",            // Arrive (left)
    11: "gps-on",            // Arrive (straight)
    12: "gps-on",            // Arrive (right)
    13: "circle",            // Roundabout
    14: "arrow-up",          // Exit roundabout
    15: "fork",              // Fork left
    16: "fork",              // Fork right
    17: "arrow-up"           // Off route / continue
  };
  return icons[type] ?? "arrow-up";
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

// 9. Handle Buffer selection and PostGIS spatial execution
function setBufferCenter(lon, lat, name = null) {
  bufferCenterPoint = { lon, lat };
  
  const displayVal = name ? `${name} (${lon.toFixed(4)}, ${lat.toFixed(4)})` : `Coords: ${lon.toFixed(4)}, ${lat.toFixed(4)}`;
  document.getElementById("buffer-center-display").value = displayVal;

  tempGraphicsLayer.removeAll();

  // Add temporary center graphic
  const centerMarker = new Graphic({
    geometry: new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } }),
    symbol: {
      type: "simple-marker",
      style: "cross",
      color: [255, 59, 48],
      size: "16px",
      outline: {
        color: [255, 59, 48],
        width: 2
      }
    }
  });
  tempGraphicsLayer.add(centerMarker);
  
  showToast("Center Selected", "Buffer center set. Click 'Run Buffer Query' to analyze.", "brand");
}

async function runBufferQuery() {
  if (!bufferCenterPoint) {
    showToast("Center point required", "Please click on the map to set a buffer center first.", "warning");
    return;
  }

  const radius = document.getElementById("buffer-distance").value;
  const { lon, lat } = bufferCenterPoint;

  try {
    const url = `${BACKEND_URL}/api/analysis/buffer?lon=${lon}&lat=${lat}&distance=${radius}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Buffer query failed");
    const result = await response.json();

    drawBufferPolygon(result.buffer_geometry);
    displayBufferPOIs(result.pois);
  } catch (error) {
    showToast("Buffer Error", error.message, "danger");
  }
}

// Draw buffer circle polygon on map
function drawBufferPolygon(geojsonGeom) {
  // Clear any existing polygons (keep the cross marker which is index 0)
  const items = tempGraphicsLayer.graphics.toArray();
  tempGraphicsLayer.removeAll();
  
  if (items.length > 0) {
    tempGraphicsLayer.add(items[0]); // re-add the center point
  }

  const polygon = new Polygon({
    rings: geojsonGeom.coordinates,
    spatialReference: { wkid: 4326 }
  });

  const fillSymbol = {
    type: "simple-fill",
    color: [0, 122, 255, 0.15], // Translucent blue
    outline: {
      color: [0, 122, 255, 0.8],
      width: 1.5,
      style: "dash"
    }
  };

  const bufferGraphic = new Graphic({
    geometry: polygon,
    symbol: fillSymbol
  });

  tempGraphicsLayer.add(bufferGraphic);
  view.goTo(polygon.extent.expand(1.2), { duration: 1000 });
}

// Display POIs falling within buffer radius
function displayBufferPOIs(pois) {
  const container = document.getElementById("buffer-results-container");
  const countTitle = document.getElementById("buffer-count-title");
  const list = document.getElementById("buffer-results-list");

  container.style.display = "block";
  countTitle.innerHTML = `Found ${pois.length} spots nearby`;
  list.innerHTML = "";

  if (pois.length === 0) {
    list.innerHTML = "<calcite-list-item description='No tourist locations in this radius.'></calcite-list-item>";
    return;
  }

  pois.forEach(poi => {
    const item = document.createElement("calcite-list-item");
    item.setAttribute("label", poi.name);
    item.setAttribute("description", `Distance: ${Math.round(poi.distance_meters)} meters (${poi.category})`);
    item.setAttribute("icon-start", "check-circle");
    
    item.addEventListener("click", () => {
      view.goTo({ center: [poi.lon, poi.lat], zoom: 16 });
    });

    list.appendChild(item);
  });
}

// 10. Shapefile Uploader Function
async function uploadShapefile() {
  const tableNameInput = document.getElementById("upload-table-name");
  const fileInput = document.getElementById("upload-file-input");
  const loader = document.getElementById("upload-loader-container");
  const notice = document.getElementById("upload-result-notice");

  if (!tableNameInput.value || fileInput.files.length === 0) {
    showToast("Incomplete Form", "Please provide a target table name and select a ZIP file.", "warning");
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);
  formData.append("table_name", tableNameInput.value);

  loader.style.display = "block";
  notice.style.display = "none";

  try {
    const response = await fetch(`${BACKEND_URL}/api/upload-shapefile`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Failed to process shapefile");
    }

    const result = await response.json();
    loader.style.display = "none";
    
    notice.style.display = "block";
    notice.innerHTML = `
      <calcite-notice open kind="success">
        <div slot="title">Upload Successful!</div>
        <div slot="message">
          Table: <strong>${result.table_name}</strong><br/>
          Geometry: <strong>${result.geometry_type}</strong><br/>
          Features Imported: <strong>${result.features_imported}</strong>
        </div>
      </calcite-notice>
    `;
    showToast("Import Completed", "Shapefile successfully processed by ArcGIS & PostGIS.", "success");
  } catch (error) {
    loader.style.display = "none";
    notice.style.display = "block";
    notice.innerHTML = `
      <calcite-notice open kind="danger">
        <div slot="title">Import Failed</div>
        <div slot="message">${error.message}</div>
      </calcite-notice>
    `;
    showToast("Import Failed", error.message, "danger");
  }
}

// 11. ArcGIS Online Search Function
async function runArcGisSearch() {
  const query = document.getElementById("arcgis-search-input").value;
  const loader = document.getElementById("arcgis-loader-container");
  const list = document.getElementById("arcgis-results-list");

  if (!query) return;

  loader.style.display = "block";
  list.innerHTML = "";

  try {
    const response = await fetch(`${BACKEND_URL}/api/analysis/arcgis-search?query=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error("Search request failed");
    const data = await response.json();
    
    loader.style.display = "none";
    const results = data.results || [];
    
    if (results.length === 0 || data.results.error) {
      const msg = data.results.error || "No matching tourism layers found.";
      list.innerHTML = `<calcite-list-item description="${msg}"></calcite-list-item>`;
      return;
    }

    results.forEach(item => {
      const listItem = document.createElement("calcite-list-item");
      listItem.setAttribute("label", item.title);
      listItem.setAttribute("description", `Owner: ${item.owner} • Type: Service`);
      listItem.setAttribute("icon-start", "search");
      
      const linkButton = document.createElement("calcite-button");
      linkButton.setAttribute("slot", "actions-end");
      linkButton.setAttribute("appearance", "transparent");
      linkButton.setAttribute("icon-start", "launch");
      linkButton.setAttribute("href", item.url || `https://www.arcgis.com/home/item.html?id=${item.id}`);
      linkButton.setAttribute("target", "_blank");
      
      listItem.appendChild(linkButton);
      list.appendChild(listItem);
    });
  } catch (error) {
    loader.style.display = "none";
    showToast("ArcGIS Search Error", error.message, "danger");
  }
}

// 12. Add New POI functions
function openAddPoiModal(lon, lat) {
  lastClickedCoords = { lon, lat };
  document.getElementById("new-poi-lon-lbl").textContent = lon.toFixed(6);
  document.getElementById("new-poi-lat-lbl").textContent = lat.toFixed(6);
  
  // Clear calcite input fields (use .value property for web components)
  ["new-poi-name", "new-poi-address", "new-poi-image", "new-poi-desc"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const modal = document.getElementById("add-poi-modal");
  modal.open = true;
}

async function saveNewPOI() {
  const name = document.getElementById("new-poi-name").value;
  const category = document.getElementById("new-poi-category").value;
  const rating = parseFloat(document.getElementById("new-poi-rating").value);
  const address = document.getElementById("new-poi-address").value;
  const image_url = document.getElementById("new-poi-image").value;
  const description = document.getElementById("new-poi-desc").value;

  if (!name) {
    showToast("Validation Error", "Attraction Name is required.", "warning");
    return;
  }

  const { lon, lat } = lastClickedCoords;

  const payload = {
    name,
    category,
    rating,
    address,
    image_url: image_url || null,
    description: description || null,
    lon,
    lat
  };

  try {
    const response = await fetch(`${BACKEND_URL}/api/pois`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Failed to insert location to PostGIS.");
    
    // Close modal & reload POIs
    document.getElementById("add-poi-modal").open = false;
    showToast("POI Saved", `Successfully added ${name} to database.`, "success");
    fetchPOIs();
  } catch (error) {
    showToast("Insert Error", error.message, "danger");
  }
}

// Helper: Get active panel depending on sidebar state
function getActivePanelId() {
  const actions = ["action-pois", "action-routing", "action-buffer", "action-upload", "action-arcgis"];
  for (const act of actions) {
    const el = document.getElementById(act);
    if (el && el.hasAttribute("active")) {
      return el.id.replace("action-", "panel-");
    }
  }
  return null;
}

// 13. UI Events Bindings
function setupUIEventListeners() {
  // Action bar buttons
  const actionBar = document.getElementById("sidebar-action-bar");
  const shellPanel = document.querySelector("calcite-shell-panel");

  actionBar.addEventListener("click", (event) => {
    const targetAction = event.target.closest("calcite-action");
    if (!targetAction) return;

    const actionId = targetAction.id;
    const panelId = actionId.replace("action-", "panel-");
    const wasActive = targetAction.hasAttribute("active");

    if (wasActive) {
      // Toggle collapse/expand of the shell panel if clicking active tab
      shellPanel.collapsed = !shellPanel.collapsed;
    } else {
      shellPanel.collapsed = false;

      // Toggle active state in bar
      const actions = actionBar.querySelectorAll("calcite-action");
      actions.forEach(act => act.removeAttribute("active"));
      targetAction.setAttribute("active", "");

      // Hide all panels, show matching panel
      const panels = ["panel-pois", "panel-routing", "panel-buffer", "panel-upload", "panel-arcgis"];
      panels.forEach(pId => {
        const panel = document.getElementById(pId);
        if (pId === panelId) {
          panel.closed = false;
        } else {
          panel.closed = true;
        }
      });
    }

    // Clear temp graphics if switching panels
    if (actionId !== "action-buffer") {
      tempGraphicsLayer.removeAll();
      document.getElementById("buffer-results-container").style.display = "none";
    }
    if (actionId !== "action-routing") {
      routeGraphicsLayer.removeAll();
      document.getElementById("route-results-container").style.display = "none";
    }
  });

  // POI search filtering
  document.getElementById("poi-search").addEventListener("calciteInputChange", (e) => {
    const term = e.target.value.toLowerCase().trim();
    filterAndRenderPOIs(term, getActiveCategoryFilter());
  });

  // Filter chips
  const chips = document.querySelectorAll(".filter-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", (e) => {
      chips.forEach(c => {
        c.removeAttribute("active");
        c.setAttribute("kind", "neutral");
      });
      chip.setAttribute("active", "");
      chip.setAttribute("kind", "brand");

      const category = chip.getAttribute("value");
      const term = document.getElementById("poi-search").value.toLowerCase().trim();
      filterAndRenderPOIs(term, category);
    });
  });

  // Route button
  document.getElementById("btn-calculate-route").addEventListener("click", calculateRoute);
  
  // Clear route
  document.getElementById("btn-clear-route").addEventListener("click", () => {
    routeGraphicsLayer.removeAll();
    tempGraphicsLayer.removeAll();
    removeTempMapClicks(document.getElementById("route-start-select"));
    removeTempMapClicks(document.getElementById("route-end-select"));
    document.getElementById("route-results-container").style.display = "none";
    document.getElementById("route-start-select").value = "";
    document.getElementById("route-end-select").value = "";
    showToast("Route Cleared", "The calculated route line and nodes have been removed.", "brand");
  });

  // Run buffer button
  document.getElementById("btn-run-buffer").addEventListener("click", runBufferQuery);

  // Upload shapefile button
  document.getElementById("btn-upload-shp").addEventListener("click", uploadShapefile);

  // ArcGIS search button
  document.getElementById("btn-arcgis-search").addEventListener("click", runArcGisSearch);
  document.getElementById("arcgis-search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") runArcGisSearch();
  });

  // Save/Cancel POI (Calcite Dialog Events)
  const poiDialog = document.getElementById("add-poi-modal");
  document.getElementById("btn-save-poi").addEventListener("click", saveNewPOI);
  document.getElementById("btn-cancel-poi").addEventListener("click", () => {
    poiDialog.open = false;
  });
  poiDialog.addEventListener("calciteDialogClose", () => {
    poiDialog.open = false;
  });

  // Basemap select change
  document.getElementById("basemap-select").addEventListener("calciteSelectChange", (e) => {
    const selectedBasemap = e.target.value;
    if (map) {
      map.basemap = createBasemap(selectedBasemap);
    }
  });

  // Light/Dark Theme toggle
  const themeToggle = document.getElementById("theme-toggle");
  themeToggle.addEventListener("click", () => {
    const body = document.body;
    const isDark = body.classList.contains("calcite-theme-dark");
    
    if (isDark) {
      body.classList.remove("calcite-theme-dark", "calcite-mode-dark");
      body.classList.add("calcite-theme-light", "calcite-mode-light");
      themeToggle.icon = "moon";
      
      // Switch to a light basemap
      const basemapSelect = document.getElementById("basemap-select");
      if (basemapSelect.value === "dark-gray-vector") {
        basemapSelect.value = "osm";
        if (map) map.basemap = createBasemap("osm");
      }
      showToast("Light Theme Activated", "App style changed to light mode.", "brand");
    } else {
      body.classList.remove("calcite-theme-light", "calcite-mode-light");
      body.classList.add("calcite-theme-dark", "calcite-mode-dark");
      themeToggle.icon = "brightness";
      
      // Switch to a dark basemap
      const basemapSelect = document.getElementById("basemap-select");
      if (["osm", "streets-vector", "topo-vector", "gray-vector"].includes(basemapSelect.value)) {
        basemapSelect.value = "dark-gray-vector";
        if (map) map.basemap = createBasemap("dark-gray-vector");
      }
      showToast("Dark Theme Activated", "App style changed to dark mode.", "brand");
    }
  });
}

// Client filtering helper
function filterAndRenderPOIs(term, category) {
  const filtered = allPois.filter(feature => {
    const props = feature.properties;
    const matchesSearch = props.name.toLowerCase().includes(term) || 
                          (props.description && props.description.toLowerCase().includes(term)) ||
                          (props.address && props.address.toLowerCase().includes(term));
    const matchesCategory = category === "all" || props.category === category;
    
    return matchesSearch && matchesCategory;
  });

  renderPOIsOnMap(filtered);
  populatePOIList(filtered);
}

function getActiveCategoryFilter() {
  const activeChip = document.querySelector(".filter-chip[active]");
  return activeChip ? activeChip.getAttribute("value") : "all";
}

// 14. Toast Alerts Helper
function showToast(title, message, kind = "brand") {
  const alert = document.getElementById("app-alert");
  document.getElementById("alert-title").textContent = title;
  document.getElementById("alert-message").textContent = message;
  alert.setAttribute("kind", kind);
  alert.open = true;
}

// 15. Global callback hooks for Popup/Map clicks
window.setStartFromPopup = function(lon, lat, name) {
  const select = document.getElementById("route-start-select");
  const value = `${lon},${lat}`;
  
  let opt = select.querySelector(`calcite-option[value="${value}"]`);
  if (!opt) {
    opt = document.createElement("calcite-option");
    opt.value = value;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = value;
  showToast("Start Node Set", `Route starting point set to ${name}.`, "brand");
  updateRouteTempMarkers();
  view.closePopup();
};

window.setEndFromPopup = function(lon, lat, name) {
  const select = document.getElementById("route-end-select");
  const value = `${lon},${lat}`;
  
  let opt = select.querySelector(`calcite-option[value="${value}"]`);
  if (!opt) {
    opt = document.createElement("calcite-option");
    opt.value = value;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = value;
  showToast("End Node Set", `Route destination point set to ${name}.`, "brand");
  updateRouteTempMarkers();
  view.closePopup();
};

window.setBufferFromPopup = function(lon, lat, name) {
  // Switch to buffer tab
  const bar = document.getElementById("sidebar-action-bar");
  const act = document.getElementById("action-buffer");
  act.click(); // trigger switch
  
  setBufferCenter(lon, lat, name);
  view.closePopup();
};

window.deletePoiFromPopup = async function(poiId, poiName) {
  if (!confirm(`Are you sure you want to remove "${poiName}" from the database?`)) {
    return;
  }
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/pois/${poiId}`, {
      method: "DELETE"
    });
    
    if (!response.ok) throw new Error("Failed to delete point from database.");
    
    showToast("POI Removed", `Successfully removed ${poiName}.`, "success");
    view.closePopup();
    fetchPOIs(); // Reload POIs on map and sidebar
  } catch (error) {
    showToast("Delete Error", error.message, "danger");
  }
};

function setRoutePointFromMapClick(lon, lat) {
  const startSelect = document.getElementById("route-start-select");
  const endSelect = document.getElementById("route-end-select");
  
  const valString = `${lon},${lat}`;
  const textLabel = `Map Click (${lon.toFixed(4)}, ${lat.toFixed(4)})`;

  const createTempOption = (val, txt) => {
    const opt = document.createElement("calcite-option");
    opt.value = val;
    opt.textContent = txt;
    return opt;
  };

  if (!startSelect.value) {
    let opt = startSelect.querySelector(`calcite-option[value="${valString}"]`);
    if (!opt) {
      opt = createTempOption(valString, textLabel);
      startSelect.appendChild(opt);
    }
    startSelect.value = valString;
    showToast("Route Start Set", `Start point set to map click.`, "brand");
  } else if (!endSelect.value) {
    let opt = endSelect.querySelector(`calcite-option[value="${valString}"]`);
    if (!opt) {
      opt = createTempOption(valString, textLabel);
      endSelect.appendChild(opt);
    }
    endSelect.value = valString;
    showToast("Route End Set", `End point set to map click.`, "brand");
    
    // Automatically calculate route since both are set now!
    calculateRoute();
  } else {
    // Both are set, reset start and clear end
    removeTempMapClicks(startSelect);
    removeTempMapClicks(endSelect);
    
    let opt = startSelect.querySelector(`calcite-option[value="${valString}"]`);
    if (!opt) {
      opt = createTempOption(valString, textLabel);
      startSelect.appendChild(opt);
    }
    startSelect.value = valString;
    endSelect.value = "";
    showToast("Route Start Reset", `Start reset to new map click. Select end point.`, "brand");
  }
  
  updateRouteTempMarkers();
}

function removeTempMapClicks(selectEl) {
  const options = selectEl.querySelectorAll("calcite-option");
  options.forEach(opt => {
    if (opt.textContent.startsWith("Map Click (") || opt.textContent.startsWith("Popup (")) {
      opt.remove();
    }
  });
}

function updateRouteTempMarkers() {
  // Clear routing highlights from tempGraphicsLayer
  // Keep the buffer cross center marker if it exists (which has cross style)
  const bufferCross = tempGraphicsLayer.graphics.find(g => g.symbol && g.symbol.style === "cross");
  tempGraphicsLayer.removeAll();
  if (bufferCross) {
    tempGraphicsLayer.add(bufferCross);
  }
  
  const startVal = document.getElementById("route-start-select").value;
  const endVal = document.getElementById("route-end-select").value;
  
  if (startVal) {
    const [lon, lat] = startVal.split(",").map(Number);
    const startMarker = new Graphic({
      geometry: new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } }),
      symbol: {
        type: "simple-marker",
        color: [52, 199, 89], // Green
        size: "12px",
        outline: { color: [255, 255, 255], width: 2 }
      }
    });
    tempGraphicsLayer.add(startMarker);
  }
  
  if (endVal) {
    const [lon, lat] = endVal.split(",").map(Number);
    const endMarker = new Graphic({
      geometry: new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } }),
      symbol: {
        type: "simple-marker",
        color: [255, 59, 48], // Red
        size: "12px",
        outline: { color: [255, 255, 255], width: 2 }
      }
    });
    tempGraphicsLayer.add(endMarker);
  }
}
