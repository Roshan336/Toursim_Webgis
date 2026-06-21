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
import DistanceMeasurement2D from "@arcgis/core/widgets/DistanceMeasurement2D";

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
let poiGraphicsLayer, routeGraphicsLayer, tempGraphicsLayer, overpassGraphicsLayer;
let provinceGraphicsLayer, districtGraphicsLayer, gapanapaGraphicsLayer, selectionGraphicsLayer, isochronesGraphicsLayer;
let allPois = [];
let overpassPois = [];
let routingStartCoords = null; // [lon, lat]
let routingEndCoords = null; // [lon, lat]
let routingClickMode = null; // 'start' | 'end' | null
let bufferCenterPoint = null;
let measurementWidget = null;
let isLoggedIn = false;
let isochroneCenterPoint = null;
let lastClickedCoords = null;
let activeCategoryFilter = "all";
let activeDistrictFilter  = "all";
let isIdentifyActive = false;
let isProvinceLoaded = false;
let isDistrictLoaded = false;
let isGapaNapaLoaded = false;
// New feature state
let nearestFacilityMode = false;
let nearestFacilityCoords = null;
let analysisGraphicsLayer = null;
let recommendationsGraphicsLayer = null;
let lastGisResult = null;
let lastGisTargetLayer = "";

function createBasemap(id) {
  const config = BASEMAPS[id] || BASEMAPS.osm;
  return new Basemap({
    title: config.title,
    baseLayers: config.baseLayers.map(createLayer => createLayer()),
    referenceLayers: (config.referenceLayers || []).map(createLayer => createLayer())
  });
}

// Initial Setup: await Calcite custom element registration BEFORE map init.
document.addEventListener("DOMContentLoaded", async () => {
  await defineCustomElements();
  initMap();
  setupUIEventListeners();
  setupGeocoder();
  setupRoutingGeocoders();
  setupLayersDrawer();
  initIsochroneUI();
  initAnalysisPanels();
  // Silently pre-load POI data in the background.
  // Nothing is rendered until the user picks a category or searches.
  await fetchPOIsData();
  populatePoiSelects();
  showPOIEmptyState();
});

// 1. Initialize Map and Views
function initMap() {
  provinceGraphicsLayer = new GraphicsLayer({ id: "province-layer", opacity: 1.0 });
  districtGraphicsLayer = new GraphicsLayer({ id: "district-layer", opacity: 1.0 });
  gapanapaGraphicsLayer = new GraphicsLayer({ id: "gapanapa-layer", opacity: 1.0 });
  selectionGraphicsLayer = new GraphicsLayer({ id: "selection-layer" });
  isochronesGraphicsLayer = new GraphicsLayer({ id: "isochrones-layer" });
  
  poiGraphicsLayer     = new GraphicsLayer({ id: "pois-layer" });
  routeGraphicsLayer   = new GraphicsLayer({ id: "route-layer" });
  tempGraphicsLayer    = new GraphicsLayer({ id: "temp-layer" });
  overpassGraphicsLayer = new GraphicsLayer({ id: "overpass-layer" });

  map = new Map({
    basemap: createBasemap("osm"),
    layers: [
      gapanapaGraphicsLayer,
      districtGraphicsLayer,
      provinceGraphicsLayer,
      isochronesGraphicsLayer,
      selectionGraphicsLayer,
      routeGraphicsLayer,
      tempGraphicsLayer,
      overpassGraphicsLayer,
      poiGraphicsLayer
    ]
  });

  view = new MapView({
    container: "viewDiv",
    map: map,
    center: [85.3240, 27.7172], // Kathmandu Valley centre
    zoom: 12,
    attributionVisible: true,
    ui: { components: [] }
  });

  view.when(() => {
    view.ui.add(new Zoom({ view }), "top-left");
    
    measurementWidget = new DistanceMeasurement2D({
      view: view,
      container: "measure-container"
    });

    console.log("Map and UI components loaded successfully.");
  }).catch(err => {
    console.error("MapView failed to load:", err);
    showToast("Map Error", "Failed to load map. Check console for details.", "danger");
  });

  // Map Listeners
  // Single click: handle buffer center selection or routing point selection
  view.on("click", (event) => {
    const lat = event.mapPoint.latitude;
    const lon = event.mapPoint.longitude;

    // Nearest facility mode takes priority
    if (nearestFacilityMode && typeof handleNearestFacilityClick === "function") {
      handleNearestFacilityClick(event);
      return;
    }
    
    // Check if identify mode is active
    if (isIdentifyActive) {
      runIdentifyQuery(lon, lat);
      return;
    }
    
    const activePanel = getActivePanelId();
    if (routingClickMode === "start") {
      setRoutingStart(lon, lat, `Map Click (${lon.toFixed(5)}, ${lat.toFixed(5)})`);
      resetRoutingClickMode();
    } else if (routingClickMode === "end") {
      setRoutingEnd(lon, lat, `Map Click (${lon.toFixed(5)}, ${lat.toFixed(5)})`);
      resetRoutingClickMode();
    } else if (activePanel === "panel-isochrones") {
      setIsochroneCenter(lon, lat);
    } else if (activePanel === "panel-buffer") {
      setBufferCenter(lon, lat);
    } else if (activePanel === "panel-routing") {
      if (!routingStartCoords) {
        setRoutingStart(lon, lat, `Map Click (${lon.toFixed(5)}, ${lat.toFixed(5)})`);
      } else if (!routingEndCoords) {
        setRoutingEnd(lon, lat, `Map Click (${lon.toFixed(5)}, ${lat.toFixed(5)})`);
        calculateRoute();
      } else {
        clearRoutingState();
        setRoutingStart(lon, lat, `Map Click (${lon.toFixed(5)}, ${lat.toFixed(5)})`);
      }
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
// Silent background fetch — loads data into allPois without rendering anything.
async function fetchPOIsData() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/pois`);
    if (!response.ok) throw new Error("Database connection failed");
    const geojson = await response.json();
    allPois = geojson.features || [];
    populateRoutingSelects(allPois);
  } catch (error) {
    showToast("Error loading tourist spots", "Could not connect to PostGIS backend. Check if FastAPI is running.", "danger");
  }
}

// Full fetch + render — used after adding or deleting a POI.
async function fetchPOIs() {
  await fetchPOIsData();
  // After a data mutation, re-apply the current filter so results stay consistent.
  const term = document.getElementById("poi-search")?.value?.toLowerCase().trim() || "";
  const hasFilter = activeCategoryFilter !== "all" || activeDistrictFilter !== "all" || term !== "";
  if (hasFilter) {
    filterAndRenderPOIs(term, activeCategoryFilter, activeDistrictFilter);
  } else {
    // No active filter — keep map/list clean; just show empty state.
    poiGraphicsLayer.removeAll();
    showPOIEmptyState();
  }
}

// 3. Render POI features onto map
function renderPOIsOnMap(features) {
  poiGraphicsLayer.removeAll();

  features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    const props  = feature.properties;

    // Category → color mapping (Kathmandu Valley palette)
    const COLOR_MAP = {
      heritage:    [139, 69,  19],   // Saddle Brown
      temple:      [180, 30,  30],   // Deep Red (sacred)
      attraction:  [0,   122, 255],  // Brand Blue
      hotel:       [255, 149, 0],    // Amber/Orange
      restaurant:  [255, 59,  48],   // Coral Red
      park:        [52,  199, 89],   // Green
    };
    const color = COLOR_MAP[props.category] || COLOR_MAP.attraction;

    const point = new Point({
      longitude: coords[0],
      latitude:  coords[1],
      spatialReference: { wkid: 4326 }
    });

    // Larger markers for UNESCO heritage
    const markerSize = (props.category === "heritage") ? "14px" : "11px";

    const markerSymbol = {
      type: "simple-marker",
      color: color,
      size: markerSize,
      outline: { color: [255, 255, 255], width: 1.5 }
    };

    // District badge in popup
    const districtBadge = props.district
      ? `<span class="district-badge district-${props.district}">${props.district.charAt(0).toUpperCase() + props.district.slice(1)}</span>`
      : "";

    const popupTemplate = {
      title: `{name}`,
      content: `
        <div style="font-family: 'Outfit', sans-serif;">
          ${props.image_url ? `<img class="poi-popup-img" src="${props.image_url}" alt="${props.name}"/>` : ""}
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
            ${districtBadge}
            <span class="category-badge category-${props.category}">${(props.category || "").replace(/_/g, " ")}</span>
          </div>
          <p><strong>Rating:</strong> ⭐ ${props.rating || "N/A"} / 5.0</p>
          <p><strong>Address:</strong> ${props.address || "No address provided"}</p>
          <p>${props.description || "No description available."}</p>
          <div style="display:flex;gap:8px;margin-top:10px;">
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
// Show a friendly empty-state prompt in the POI list.
function showPOIEmptyState(message) {
  const list = document.getElementById("pois-list");
  if (!list) return;
  const msg = message || "Choose a category above or search for a place to explore tourism spots.";
  list.innerHTML = `
    <div class="poi-empty-state">
      <calcite-icon icon="map-pin" scale="l" style="color: var(--calcite-ui-brand);"></calcite-icon>
      <p class="poi-empty-title">Discover Nepal</p>
      <p class="poi-empty-hint">${msg}</p>
    </div>
  `;
}

function populatePOIList(features) {
  const list = document.getElementById("pois-list");
  list.innerHTML = "";

  if (features.length === 0) {
    showPOIEmptyState("No tourism spots match your filter. Try a different category or search term.");
    return;
  }

  features.forEach(feature => {
    const props  = feature.properties;
    const coords = feature.geometry.coordinates;

    const ICON_MAP = {
      heritage:   "layer",
      temple:     "effects",
      attraction: "tour",
      hotel:      "home",
      restaurant: "shopping-cart",
      park:       "tree",
    };
    const icon = ICON_MAP[props.category] || "tour";

    const districtLabel = props.district
      ? ` • ${props.district.charAt(0).toUpperCase() + props.district.slice(1)}`
      : "";

    const item = document.createElement("calcite-list-item");
    item.setAttribute("label", props.name);
    item.setAttribute("description", `${props.address || ""}${districtLabel} • ⭐ ${props.rating || "N/A"}`);
    item.setAttribute("icon-start", icon);

    item.addEventListener("click", () => {
      view.goTo({ center: [coords[0], coords[1]], zoom: 16 }, { duration: 1000 });
      const matchingGraphic = poiGraphicsLayer.graphics.find(g => g.attributes.id === props.id);
      if (matchingGraphic) {
        view.openPopup({ features: [matchingGraphic], location: matchingGraphic.geometry });
      }
    });

    list.appendChild(item);
  });
}

// 5. Populate select inputs for Routing panel (Deprecated - using inputs now)
function populateRoutingSelects(features) {
  // Deprecated: Inputs are autocompleted dynamically
}

// 6. Calculate Route using OpenRouteService API
async function calculateRoute() {
  if (!routingStartCoords || !routingEndCoords) {
    showToast("Selection required", "Please choose both start and end locations.", "warning");
    return;
  }

  const [startLon, startLat] = routingStartCoords;
  const [endLon, endLat] = routingEndCoords;

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

  const activeChip = document.querySelector(".filter-chip[active]");
  const category = activeChip && activeChip.value !== 'all' ? activeChip.value : '';
  const categoryParam = category ? `&category=${category}` : '';

  try {
    const url = `${BACKEND_URL}/api/analysis/buffer?lon=${lon}&lat=${lat}&distance=${radius}${categoryParam}`;
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
  const name        = document.getElementById("new-poi-name").value;
  const category    = document.getElementById("new-poi-category").value;
  const district    = document.getElementById("new-poi-district").value;
  const rating      = parseFloat(document.getElementById("new-poi-rating").value);
  const address     = document.getElementById("new-poi-address").value;
  const image_url   = document.getElementById("new-poi-image").value;
  const description = document.getElementById("new-poi-desc").value;

  if (!name) {
    showToast("Validation Error", "Attraction Name is required.", "warning");
    return;
  }

  const { lon, lat } = lastClickedCoords;

  const payload = {
    name, category, district,
    rating,
    address,
    image_url:   image_url   || null,
    description: description || null,
    lon, lat
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

function getActivePanelId() {
  const actions = ["action-pois", "action-routing", "action-buffer", "action-isochrones", "action-recommend", "action-spatial-analysis"];
  for (const act of actions) {
    const el = document.getElementById(act);
    if (el && el.hasAttribute("active")) {
      return el.id.replace("action-", "panel-");
    }
  }
  return null;
}

// 10a. Overpass Live Data Fetch
async function fetchOverpassData() {
  const district = document.getElementById("overpass-district-select").value;
  const loader   = document.getElementById("overpass-loader-container");
  const container = document.getElementById("overpass-results-container");
  const countTitle = document.getElementById("overpass-count-title");
  const list      = document.getElementById("overpass-results-list");

  loader.style.display = "block";
  container.style.display = "none";

  try {
    const response = await fetch(`${BACKEND_URL}/api/overpass-pois?district=${encodeURIComponent(district)}`);
    if (!response.ok) throw new Error("Overpass API request failed");
    const data = await response.json();

    loader.style.display = "none";
    overpassPois = data.features || [];

    // Render on map (separate layer with different style)
    renderOverpassOnMap(overpassPois);

    // Show results list
    container.style.display = "block";
    countTitle.textContent = `${overpassPois.length} live POIs loaded from OSM`;
    list.innerHTML = "";

    const topResults = overpassPois.slice(0, 40); // show top 40
    topResults.forEach(feature => {
      const props = feature.properties;
      const item  = document.createElement("calcite-list-item");
      item.setAttribute("label", props.name);
      item.setAttribute("description",
        `${props.category} • ${props.district || ""} ${props.address ? "• " + props.address : ""}`);
      item.setAttribute("icon-start", "satellite-2");
      item.addEventListener("click", () => {
        const [lon, lat] = feature.geometry.coordinates;
        view.goTo({ center: [lon, lat], zoom: 17 }, { duration: 800 });
      });
      list.appendChild(item);
    });

    if (overpassPois.length > 40) {
      const moreItem = document.createElement("calcite-list-item");
      moreItem.setAttribute("label", `… and ${overpassPois.length - 40} more`);
      moreItem.setAttribute("description", "Zoom the map to explore all results");
      list.appendChild(moreItem);
    }

    showToast("Live Data Loaded", `${overpassPois.length} OpenStreetMap tourism spots loaded.`, "success");
  } catch (error) {
    loader.style.display = "none";
    showToast("Overpass Error", error.message, "danger");
  }
}

function renderOverpassOnMap(features) {
  overpassGraphicsLayer.removeAll();
  features.forEach(feature => {
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;

    const COLOR_MAP = {
      heritage:   [139, 69,  19],
      temple:     [180, 30,  30],
      attraction: [0,   122, 255],
      hotel:      [255, 149, 0],
      restaurant: [255, 59,  48],
      park:       [52,  199, 89],
    };
    const color = COLOR_MAP[props.category] || [100, 100, 200];

    const graphic = new Graphic({
      geometry: new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } }),
      symbol: {
        type: "simple-marker",
        color: [...color, 0.8],
        size: "9px",
        style: "diamond",
        outline: { color: [255, 255, 255, 0.9], width: 1 }
      },
      attributes: props,
      popupTemplate: {
        title: props.name,
        content: `<div style="font-family:'Outfit',sans-serif">
          <p><strong>Category:</strong> ${props.category}</p>
          <p><strong>District:</strong> ${props.district || "Unknown"}</p>
          ${props.description ? `<p>${props.description}</p>` : ""}
          ${props.address    ? `<p><strong>Address:</strong> ${props.address}</p>` : ""}
          <p style="font-size:0.8em;color:#888">Source: OpenStreetMap (OSM ID: ${props.osm_id})</p>
        </div>`
      }
    });
    overpassGraphicsLayer.add(graphic);
  });
}

function clearOverpassLayer() {
  overpassGraphicsLayer.removeAll();
  overpassPois = [];
  const container  = document.getElementById("overpass-results-container");
  const countTitle = document.getElementById("overpass-count-title");
  const list       = document.getElementById("overpass-results-list");
  container.style.display = "none";
  countTitle.textContent = "0 live POIs loaded";
  list.innerHTML = "";
  showToast("Layer Cleared", "Live OSM data removed from map.", "brand");
}

function downloadOverpassAsGeoJson() {
  if (!overpassPois || overpassPois.length === 0) {
    showToast("No data", "There are no live OSM features to download.", "warning");
    return;
  }
  
  const featureCollection = {
    type: "FeatureCollection",
    features: overpassPois
  };
  
  const content = JSON.stringify(featureCollection, null, 2);
  const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const district = document.getElementById("overpass-district-select").value;
  const filename = `osm_live_pois_${district}_${new Date().toISOString().slice(0, 10)}.geojson`;
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast("GeoJSON Downloaded", `Downloaded ${overpassPois.length} features to ${filename}`, "success");
}

function downloadOverpassAsCsv() {
  if (!overpassPois || overpassPois.length === 0) {
    showToast("No data", "There are no live OSM features to download.", "warning");
    return;
  }
  
  const keysSet = new Set();
  overpassPois.forEach(f => {
    if (f.properties) {
      Object.keys(f.properties).forEach(k => keysSet.add(k));
    }
  });
  
  const headers = Array.from(keysSet);
  headers.push("longitude");
  headers.push("latitude");
  
  const csvRows = [];
  csvRows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(","));
  
  overpassPois.forEach(f => {
    const rowValues = headers.map(h => {
      if (h === "longitude") {
        return f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates[0] : "";
      }
      if (h === "latitude") {
        return f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates[1] : "";
      }
      
      const val = f.properties && f.properties[h] !== undefined ? f.properties[h] : "";
      const strVal = typeof val === "object" ? JSON.stringify(val) : String(val);
      return `"${strVal.replace(/"/g, '""')}"`;
    });
    csvRows.push(rowValues.join(","));
  });
  
  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const district = document.getElementById("overpass-district-select").value;
  const filename = `osm_live_pois_${district}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast("CSV Downloaded", `Downloaded ${overpassPois.length} features to ${filename}`, "success");
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
    const panelId  = actionId.replace("action-", "panel-");
    const wasActive = targetAction.hasAttribute("active");

    if (wasActive) {
      shellPanel.collapsed = !shellPanel.collapsed;
    } else {
      shellPanel.collapsed = false;

      const actions = actionBar.querySelectorAll("calcite-action");
      actions.forEach(act => act.removeAttribute("active"));
      targetAction.setAttribute("active", "");

      const panels = ["panel-pois", "panel-routing", "panel-buffer", "panel-isochrones", "panel-recommend", "panel-spatial-analysis", "panel-measure"];
      panels.forEach(pId => {
        const panel = document.getElementById(pId);
        if (panel) {
          if (pId === panelId) {
            panel.closed = false;
          } else {
            panel.closed = true;
          }
        }
      });
    }

    if (actionId !== "action-buffer") {
      tempGraphicsLayer.removeAll();
      document.getElementById("buffer-results-container").style.display = "none";
    }
    if (actionId !== "action-routing") {
      routeGraphicsLayer.removeAll();
      document.getElementById("route-results-container").style.display = "none";
    }
    if (actionId !== "action-isochrones") {
      if (isochronesGraphicsLayer) isochronesGraphicsLayer.removeAll();
    }
  });

  // POI search filtering
  document.getElementById("poi-search").addEventListener("calciteInputChange", (e) => {
    const term = e.target.value.toLowerCase().trim();
    filterAndRenderPOIs(term, activeCategoryFilter, activeDistrictFilter);
  });

  // Category filter chips
  const chips = document.querySelectorAll(".filter-chip");
  chips.forEach(chip => {
    chip.addEventListener("click", (e) => {
      chips.forEach(c => {
        c.removeAttribute("active");
        c.setAttribute("kind", "neutral");
      });
      chip.setAttribute("active", "");
      chip.setAttribute("kind", "brand");
      activeCategoryFilter = chip.getAttribute("value");
      const term = document.getElementById("poi-search").value.toLowerCase().trim();
      filterAndRenderPOIs(term, activeCategoryFilter, activeDistrictFilter);
    });
  });

  // District filter chips
  const districtChips = document.querySelectorAll(".district-chip");
  districtChips.forEach(chip => {
    chip.addEventListener("click", () => {
      districtChips.forEach(c => {
        c.removeAttribute("active");
        c.setAttribute("kind", "neutral");
      });
      chip.setAttribute("active", "");
      chip.setAttribute("kind", "brand");
      activeDistrictFilter = chip.getAttribute("value");
      const term = document.getElementById("poi-search").value.toLowerCase().trim();
      filterAndRenderPOIs(term, activeCategoryFilter, activeDistrictFilter);
    });
  });

  // Login / Logout Logic
  const actionLogin = document.getElementById("action-login");
  
  // Check auth state on load
  if (localStorage.getItem("isLoggedIn") === "true") {
    const user = localStorage.getItem("username") || "User";
    actionLogin.setAttribute("text", `Logout (${user})`);
    isLoggedIn = true;
  }

  actionLogin.addEventListener("click", () => {
    if (localStorage.getItem("isLoggedIn") === "true") {
      window.location.href = "logout.html";
    } else {
      window.location.href = "login.html";
    }
  });

  // Route buttons
  document.getElementById("btn-calculate-route").addEventListener("click", calculateRoute);
  document.getElementById("btn-clear-route").addEventListener("click", () => {
    clearRoutingState();
    showToast("Route Cleared", "The calculated route line and nodes have been removed.", "brand");
  });

  // Buffer buttons
  document.getElementById("btn-run-buffer").addEventListener("click", runBufferQuery);


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

  // Initialize GeoJSON layer and GIS selection listeners
  setupGeoJsonUIEventListeners();
}

// Client filtering helper
function filterAndRenderPOIs(term, category, district) {
  // If nothing is selected/searched, keep map clean and show empty state.
  const hasFilter = category !== "all" || district !== "all" || term !== "";
  if (!hasFilter) {
    poiGraphicsLayer.removeAll();
    showPOIEmptyState();
    return;
  }

  const filtered = allPois.filter(feature => {
    const props = feature.properties;
    const matchesSearch = props.name.toLowerCase().includes(term) ||
                          (props.description && props.description.toLowerCase().includes(term)) ||
                          (props.address && props.address.toLowerCase().includes(term));
    const matchesCategory = category === "all" || props.category === category;
    const matchesDistrict = district === "all" || props.district === district;
    return matchesSearch && matchesCategory && matchesDistrict;
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
  setRoutingStart(lon, lat, name);
  showToast("Start Node Set", `Route starting point set to ${name}.`, "brand");
  view.closePopup();
};

window.setEndFromPopup = function(lon, lat, name) {
  setRoutingEnd(lon, lat, name);
  showToast("End Node Set", `Route destination point set to ${name}.`, "brand");
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

function setRoutingStart(lon, lat, label) {
  routingStartCoords = [lon, lat];
  const input = document.getElementById("route-start-search");
  if (input) input.value = label;
  updateRouteTempMarkers();
}

function setRoutingEnd(lon, lat, label) {
  routingEndCoords = [lon, lat];
  const input = document.getElementById("route-end-search");
  if (input) input.value = label;
  updateRouteTempMarkers();
}

function resetRoutingClickMode() {
  routingClickMode = null;
  const btnStart = document.getElementById("btn-route-start-map");
  const btnEnd = document.getElementById("btn-route-end-map");
  if (btnStart) {
    btnStart.setAttribute("kind", "neutral");
    btnStart.removeAttribute("appearance");
  }
  if (btnEnd) {
    btnEnd.setAttribute("kind", "neutral");
    btnEnd.removeAttribute("appearance");
  }
}

function clearRoutingState() {
  routingStartCoords = null;
  routingEndCoords = null;
  resetRoutingClickMode();
  const startInput = document.getElementById("route-start-search");
  const endInput = document.getElementById("route-end-search");
  if (startInput) startInput.value = "";
  if (endInput) endInput.value = "";
  routeGraphicsLayer.removeAll();
  
  const resultsContainer = document.getElementById("route-results-container");
  if (resultsContainer) resultsContainer.style.display = "none";
  
  updateRouteTempMarkers();
}

function updateRouteTempMarkers() {
  // Clear routing highlights from tempGraphicsLayer
  // Keep the buffer cross center marker if it exists (which has cross style)
  const bufferCross = tempGraphicsLayer.graphics.find(g => g.symbol && g.symbol.style === "cross");
  tempGraphicsLayer.removeAll();
  if (bufferCross) {
    tempGraphicsLayer.add(bufferCross);
  }
  
  if (routingStartCoords) {
    const [lon, lat] = routingStartCoords;
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
  
  if (routingEndCoords) {
    const [lon, lat] = routingEndCoords;
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

// ═══════════════════════════════════════════════════════════════════
// FLOATING LAYERS DRAWER LOGIC
// ═══════════════════════════════════════════════════════════════════

function setupLayersDrawer() {
  const drawer = document.getElementById("layers-drawer");
  const backdrop = document.getElementById("layers-drawer-backdrop");
  const openBtn = document.getElementById("btn-open-layers-drawer");
  const closeBtn = document.getElementById("btn-close-layers-drawer");

  function openDrawer() {
    drawer.classList.add("open");
    backdrop.classList.remove("hidden");
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.add("hidden");
  }

  if (openBtn) openBtn.addEventListener("click", openDrawer);
  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
  if (backdrop) backdrop.addEventListener("click", closeDrawer);

  // Section Accordion Logic
  const sectionHeaders = document.querySelectorAll(".ld-section-header");
  sectionHeaders.forEach(header => {
    header.addEventListener("click", () => {
      const sectionId = header.getAttribute("data-section");
      const body = document.getElementById(`ld-body-${sectionId}`);
      
      if (body.classList.contains("collapsed")) {
        // Expand
        body.classList.remove("collapsed");
        header.classList.remove("collapsed");
      } else {
        // Collapse
        body.classList.add("collapsed");
        header.classList.add("collapsed");
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// GEOJSON LAYERS & GIS ANALYSIS LOGIC
// ═══════════════════════════════════════════════════════════════════

function setupGeoJsonUIEventListeners() {
  // 1. Layer Toggles
  document.getElementById("chk-layer-province").addEventListener("calciteSwitchChange", async (e) => {
    const checked = e.target.checked;
    provinceGraphicsLayer.visible = checked;
    if (checked && !isProvinceLoaded) {
      const simplifyVal = document.getElementById("chk-simplify-geom").checked ? 0.0001 : 0.0;
      showToast("Loading Provinces", "Fetching province boundary shapes...", "brand");
      await loadGeoJsonLayer("province_layer", provinceGraphicsLayer, simplifyVal);
      isProvinceLoaded = true;
    }
  });

  document.getElementById("chk-layer-district").addEventListener("calciteSwitchChange", async (e) => {
    const checked = e.target.checked;
    districtGraphicsLayer.visible = checked;
    if (checked && !isDistrictLoaded) {
      const simplifyVal = document.getElementById("chk-simplify-geom").checked ? 0.0005 : 0.0;
      showToast("Loading Districts", "Fetching district boundary shapes...", "brand");
      await loadGeoJsonLayer("district_layer", districtGraphicsLayer, simplifyVal);
      isDistrictLoaded = true;
    }
  });

  document.getElementById("chk-layer-gapanapa").addEventListener("calciteSwitchChange", async (e) => {
    const checked = e.target.checked;
    gapanapaGraphicsLayer.visible = checked;
    if (checked && !isGapaNapaLoaded) {
      const simplifyVal = document.getElementById("chk-simplify-geom").checked ? 0.001 : 0.0;
      showToast("Loading GapaNapa", "Fetching local units (GapaNapa) boundary shapes. This may take a moment...", "brand");
      await loadGeoJsonLayer("gapanapa_layer", gapanapaGraphicsLayer, simplifyVal);
      isGapaNapaLoaded = true;
    }
  });

  // Re-load trigger on simplify option change
  document.getElementById("chk-simplify-geom").addEventListener("calciteCheckboxChange", () => {
    isProvinceLoaded = false;
    isDistrictLoaded = false;
    isGapaNapaLoaded = false;
    
    if (document.getElementById("chk-layer-province").checked) {
      document.getElementById("chk-layer-province").dispatchEvent(new CustomEvent("calciteSwitchChange"));
    }
    if (document.getElementById("chk-layer-district").checked) {
      document.getElementById("chk-layer-district").dispatchEvent(new CustomEvent("calciteSwitchChange"));
    }
    if (document.getElementById("chk-layer-gapanapa").checked) {
      document.getElementById("chk-layer-gapanapa").dispatchEvent(new CustomEvent("calciteSwitchChange"));
    }
  });

  // 3. Identify Click Toggle
  const btnToggleIdentify = document.getElementById("btn-toggle-identify");
  btnToggleIdentify.addEventListener("click", () => {
    isIdentifyActive = !isIdentifyActive;
    if (isIdentifyActive) {
      btnToggleIdentify.textContent = "Identify Active (Click Map)";
      btnToggleIdentify.setAttribute("appearance", "solid");
      btnToggleIdentify.setAttribute("kind", "brand");
      document.getElementById("viewDiv").style.cursor = "crosshair";
      showToast("Identify Mode Enabled", "Click anywhere on the map to identify the Province, District, and GapaNapa.", "brand");
    } else {
      btnToggleIdentify.textContent = "Enable Click-to-Identify";
      btnToggleIdentify.setAttribute("appearance", "outline");
      btnToggleIdentify.setAttribute("kind", "brand");
      document.getElementById("viewDiv").style.cursor = "default";
      document.getElementById("identify-results-card").classList.add("hidden");
      selectionGraphicsLayer.removeAll();
    }
  });

  // 4. Attribute Field Selection population
  const attrLayerSelect = document.getElementById("attr-layer-select");
  const attrKeySelect = document.getElementById("attr-key-select");
  
  const updateAttrFields = () => {
    const layer = attrLayerSelect.value;
    attrKeySelect.innerHTML = "";
    
    let fields = [];
    if (layer === "pois") {
      fields = [
        { value: "name", label: "Name" },
        { value: "category", label: "Category" },
        { value: "district", label: "District" },
        { value: "rating", label: "Rating" },
        { value: "address", label: "Address" },
        { value: "description", label: "Description" }
      ];
    } else if (layer === "province_layer") {
      fields = [
        { value: "Province", label: "Province Name" },
        { value: "STATE_CODE", label: "State Code" },
        { value: "Shape_Area", label: "Shape Area" }
      ];
    } else if (layer === "district_layer") {
      fields = [
        { value: "DISTRICT", label: "District Name" },
        { value: "Province", label: "Province" },
        { value: "STATE_CODE", label: "State Code" }
      ];
    } else if (layer === "gapanapa_layer") {
      fields = [
        { value: "GaPa_NaPa", label: "Local Unit Name" },
        { value: "DISTRICT_1", label: "District" },
        { value: "Type_GN", label: "Type (Gaunpalika/Nagarpalika)" },
        { value: "CENTER", label: "Center" },
        { value: "STATE_CODE", label: "State Code" }
      ];
    }
    
    fields.forEach(f => {
      const opt = document.createElement("calcite-option");
      opt.value = f.value;
      opt.textContent = f.label;
      attrKeySelect.appendChild(opt);
    });
    updateSqlPreview();
  };
  
  attrLayerSelect.addEventListener("calciteSelectChange", updateAttrFields);
  updateAttrFields(); // initial run

  document.getElementById("attr-operator-select").addEventListener("calciteSelectChange", updateSqlPreview);
  document.getElementById("attr-value-input").addEventListener("calciteInputInput", updateSqlPreview);
  attrKeySelect.addEventListener("calciteSelectChange", updateSqlPreview);

  // 5. Attribute Query execution
  document.getElementById("btn-run-attribute-query").addEventListener("click", runAttributeQuery);

  // 6. Spatial Layer selection dependency & Feature population
  const spatialSourceSelect = document.getElementById("spatial-source-select");
  const spatialSourceFeatureSelect = document.getElementById("spatial-source-feature-select");
  
  const updateSpatialSourceFeatures = async () => {
    const sourceLayer = spatialSourceSelect.value;
    spatialSourceFeatureSelect.innerHTML = '<calcite-option value="" selected>-- All features --</calcite-option>';
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/layers/${sourceLayer}/features`);
      if (!res.ok) throw new Error("Failed to fetch features");
      const features = await res.json();
      
      features.forEach(f => {
        const opt = document.createElement("calcite-option");
        opt.value = f.id;
        opt.textContent = f.name;
        spatialSourceFeatureSelect.appendChild(opt);
      });
    } catch (err) {
      console.error("Error populating source features:", err);
    }
  };
  
  spatialSourceSelect.addEventListener("calciteSelectChange", updateSpatialSourceFeatures);
  updateSpatialSourceFeatures(); // initial run

  // Show/Hide distance based on spatial relation
  const spatialRelationSelect = document.getElementById("spatial-relation-select");
  const spatialDistanceGroup = document.getElementById("spatial-distance-group");
  
  spatialRelationSelect.addEventListener("calciteSelectChange", (e) => {
    if (e.target.value === "within_distance") {
      spatialDistanceGroup.classList.remove("hidden");
    } else {
      spatialDistanceGroup.classList.add("hidden");
    }
  });

  // 7. Spatial Query execution
  document.getElementById("btn-run-spatial-query").addEventListener("click", runSpatialQuery);

  // 8. Clear Selection results
  document.getElementById("btn-clear-gis-results").addEventListener("click", clearGisSelection);
  document.getElementById("btn-export-gis-csv").addEventListener("click", exportGisResultsToCsv);
}

// Load a GeoJSON layer boundary and display it
async function loadGeoJsonLayer(layerName, graphicsLayer, simplifyVal) {
  try {
    const url = `${BACKEND_URL}/api/layers/${layerName}?simplify=${simplifyVal}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    
    graphicsLayer.removeAll();
    
    let fillRGB = [0, 100, 250]; 
    let outlineRGB = [255, 255, 255];
    let outlineWidth = 1.0;
    
    if (layerName === "province_layer") {
      fillRGB = [0, 150, 136]; 
      outlineWidth = 2.0;
    } else if (layerName === "district_layer") {
      fillRGB = [156, 39, 176]; 
      outlineWidth = 1.5;
    } else if (layerName === "gapanapa_layer") {
      fillRGB = [76, 175, 80]; 
      outlineWidth = 0.8;
    }
    
    const features = data.features || [];
    features.forEach(feat => {
      if (!feat.geometry) return;
      
      const geomType = feat.geometry.type;
      let polyGeom;
      
      if (geomType === "Polygon") {
        polyGeom = new Polygon({
          rings: feat.geometry.coordinates,
          spatialReference: { wkid: 4326 }
        });
      } else if (geomType === "MultiPolygon") {
        const allRings = [];
        feat.geometry.coordinates.forEach(polyCoords => {
          polyCoords.forEach(ring => {
            allRings.push(ring);
          });
        });
        polyGeom = new Polygon({
          rings: allRings,
          spatialReference: { wkid: 4326 }
        });
      } else {
        return;
      }
      
      const symbol = {
        type: "simple-fill",
        color: [...fillRGB, 0.25], 
        outline: {
          color: [...outlineRGB, 0.8],
          width: outlineWidth
        }
      };
      
      const popupTemplate = {
        title: feat.properties.name || "Boundary Feature",
        content: `
          <div style="font-family: 'Outfit', sans-serif;">
            <p><strong>Name:</strong> ${feat.properties.name || "N/A"}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;"/>
            <div style="max-height: 150px; overflow-y: auto; font-size: 0.85em;">
              <table style="width: 100%; border-collapse: collapse;">
                ${Object.entries(feat.properties)
                  .filter(([k]) => !["id", "name", "geom", "properties"].includes(k.toLowerCase()))
                  .map(([k, v]) => `
                    <tr>
                      <td style="font-weight: 600; padding: 2px 4px; border-bottom: 1px solid #f0f0f0;">${k}</td>
                      <td style="padding: 2px 4px; border-bottom: 1px solid #f0f0f0;">${v}</td>
                    </tr>
                  `).join("")}
              </table>
            </div>
          </div>
        `
      };
      
      const graphic = new Graphic({
        geometry: polyGeom,
        symbol: symbol,
        attributes: feat.properties,
        popupTemplate: popupTemplate
      });
      
      graphicsLayer.add(graphic);
    });
    
  } catch (error) {
    console.error(`Error loading layer ${layerName}:`, error);
    showToast("Layer Error", `Failed to load boundary layer. Check FastAPI backend console.`, "danger");
  }
}

// Run Click-to-Identify Query
async function runIdentifyQuery(lon, lat) {
  const identifyCard = document.getElementById("identify-results-card");
  const identifyDetails = document.getElementById("identify-details");
  
  identifyCard.classList.remove("hidden");
  identifyDetails.innerHTML = "<calcite-loader text='Identifying coordinates...'></calcite-loader>";
  
  selectionGraphicsLayer.removeAll();
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/analysis/identify?lon=${lon}&lat=${lat}`);
    if (!response.ok) throw new Error("Identify query failed");
    const result = await response.json();
    
    identifyDetails.innerHTML = "";
    
    const layerNames = {
      "province_layer": "Province",
      "district_layer": "District",
      "gapanapa_layer": "GapaNapa (Local Unit)"
    };
    
    let foundAny = false;
    
    // Add point marker at clicked coordinates
    const clickPoint = new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } });
    const pointGraphic = new Graphic({
      geometry: clickPoint,
      symbol: {
        type: "simple-marker",
        style: "cross",
        color: [255, 69, 0],
        size: "14px",
        outline: { color: [255, 255, 255], width: 1.5 }
      }
    });
    selectionGraphicsLayer.add(pointGraphic);

    for (const [layerKey, data] of Object.entries(result)) {
      if (data) {
        foundAny = true;
        const item = document.createElement("div");
        item.className = "identify-item";
        item.innerHTML = `
          <span class="identify-label">${layerNames[layerKey] || layerKey}</span>
          <div class="identify-value">${data.name}</div>
          <div style="font-size: 0.8em; color: #64748b; margin-top: 2px;">
            ${Object.entries(data.properties)
              .filter(([k]) => !["id", "name", "geom", "properties"].includes(k.toLowerCase()))
              .slice(0, 3)
              .map(([k, v]) => `<strong>${k}:</strong> ${v}`)
              .join(" | ")}
          </div>
        `;
        identifyDetails.appendChild(item);
        
        // Highlight boundary polygon on map
        if (data.geometry) {
          const geomType = data.geometry.type;
          let polyGeom;
          if (geomType === "Polygon") {
            polyGeom = new Polygon({ rings: data.geometry.coordinates, spatialReference: { wkid: 4326 } });
          } else if (geomType === "MultiPolygon") {
            const allRings = [];
            data.geometry.coordinates.forEach(polyCoords => {
              polyCoords.forEach(ring => {
                allRings.push(ring);
              });
            });
            polyGeom = new Polygon({ rings: allRings, spatialReference: { wkid: 4326 } });
          }
          
          if (polyGeom) {
            const highlightSymbol = {
              type: "simple-fill",
              color: [255, 235, 59, 0.15], // soft yellow
              outline: {
                color: [255, 235, 59, 1.0], // bright yellow
                width: 2.0
              }
            };
            
            const highlightGraphic = new Graphic({
              geometry: polyGeom,
              symbol: highlightSymbol
            });
            selectionGraphicsLayer.add(highlightGraphic);
          }
        }
      }
    }
    
    if (!foundAny) {
      identifyDetails.innerHTML = "<p>No boundary boundaries contain this coordinate.</p>";
    }
    
  } catch (error) {
    console.error("Identify error:", error);
    identifyDetails.innerHTML = `<p style="color:red">Error: ${error.message}</p>`;
  }
}

// ─── SQL Preview and CSV Export Enhancements ──────────────────────────────────

function updateSqlPreview() {
  const layerSelect = document.getElementById("attr-layer-select");
  const keySelect = document.getElementById("attr-key-select");
  const opSelect = document.getElementById("attr-operator-select");
  const valInput = document.getElementById("attr-value-input");
  
  if (!layerSelect || !keySelect || !opSelect || !valInput) return;
  
  const layer = layerSelect.value;
  const key = keySelect.value;
  const op = opSelect.value;
  const val = valInput.value || "...";
  
  if (!key) {
    const previewEl = document.getElementById("attr-sql-preview");
    if (previewEl) previewEl.textContent = "SELECT * FROM pois WHERE name ILIKE '%...%';";
    return;
  }
  
  let where_clause = "";
  const col_name = key.toLowerCase().trim();
  
  if (layer === "pois") {
    if (op === "contains") {
      where_clause = `${col_name} ILIKE '%${val}%'`;
    } else if (op === "starts_with") {
      where_clause = `${col_name} ILIKE '${val}%'`;
    } else if (op === "ends_with") {
      where_clause = `${col_name} ILIKE '%${val}'`;
    } else if (op === "equals") {
      where_clause = `${col_name} = '${val}'`;
    } else if (op === "greater_than") {
      where_clause = `${col_name} > '${val}'`;
    } else if (op === "less_than") {
      where_clause = `${col_name} < '${val}'`;
    }
  } else {
    if (op === "greater_than") {
      where_clause = `CAST(NULLIF(properties->>'${key}', '') AS numeric) > CAST('${val}' AS numeric)`;
    } else if (op === "less_than") {
      where_clause = `CAST(NULLIF(properties->>'${key}', '') AS numeric) < CAST('${val}' AS numeric)`;
    } else if (op === "contains") {
      where_clause = `properties->>'${key}' ILIKE '%${val}%'`;
    } else if (op === "starts_with") {
      where_clause = `properties->>'${key}' ILIKE '${val}%'`;
    } else if (op === "ends_with") {
      where_clause = `properties->>'${key}' ILIKE '%${val}'`;
    } else {
      where_clause = `properties->>'${key}' = '${val}'`;
    }
  }
  
  let query = "";
  if (layer === "pois") {
    query = `SELECT id, name, category, district, description, rating, image_url, address, geom\nFROM pois\nWHERE ${where_clause}\nORDER BY name;`;
  } else {
    query = `SELECT id, name, properties, geom\nFROM ${layer}\nWHERE ${where_clause}\nORDER BY name;`;
  }
  
  const previewEl = document.getElementById("attr-sql-preview");
  if (previewEl) {
    previewEl.textContent = query;
  }
}

function exportGisResultsToCsv() {
  if (!lastGisResult || !lastGisResult.features || lastGisResult.features.length === 0) {
    showToast("No data", "There are no query results to export.", "warning");
    return;
  }
  
  const features = lastGisResult.features;
  
  const keysSet = new Set();
  features.forEach(f => {
    if (f.properties) {
      Object.keys(f.properties).forEach(k => keysSet.add(k));
    }
  });
  
  const isPointLayer = features.some(f => f.geometry && f.geometry.type === "Point");
  const headers = Array.from(keysSet);
  if (isPointLayer) {
    headers.push("longitude");
    headers.push("latitude");
  } else {
    headers.push("geometry_type");
  }
  
  const csvRows = [];
  csvRows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(","));
  
  features.forEach(f => {
    const rowValues = headers.map(h => {
      if (h === "longitude") {
        return f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates[0] : "";
      }
      if (h === "latitude") {
        return f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates[1] : "";
      }
      if (h === "geometry_type") {
        return f.geometry ? f.geometry.type : "None";
      }
      
      const val = f.properties && f.properties[h] !== undefined ? f.properties[h] : "";
      const strVal = typeof val === "object" ? JSON.stringify(val) : String(val);
      return `"${strVal.replace(/"/g, '""')}"`;
    });
    csvRows.push(rowValues.join(","));
  });
  
  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const filename = `gis_selection_${lastGisTargetLayer}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast("CSV Exported", `Successfully exported ${features.length} features to ${filename}`, "success");
}

// Run Attribute Query (Select by Attribute)
async function runAttributeQuery() {
  const layer = document.getElementById("attr-layer-select").value;
  const key = document.getElementById("attr-key-select").value;
  const op = document.getElementById("attr-operator-select").value;
  const val = document.getElementById("attr-value-input").value;
  
  if (!val) {
    showToast("Input required", "Please enter a value to search for.", "warning");
    return;
  }
  
  const btn = document.getElementById("btn-run-attribute-query");
  btn.setAttribute("loading", "");
  
  try {
    const url = `${BACKEND_URL}/api/analysis/attribute-filter?layer_name=${layer}&property_key=${key}&operator=${op}&value=${encodeURIComponent(val)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Query execution failed");
    
    const geojson = await res.json();
    displayGisQueryResult(geojson, layer);
    
  } catch (error) {
    console.error("Attribute query error:", error);
    showToast("Query Failed", error.message, "danger");
  } finally {
    btn.removeAttribute("loading");
  }
}

// Run Spatial Query (Select by Location)
async function runSpatialQuery() {
  const target = document.getElementById("spatial-target-select").value;
  const relation = document.getElementById("spatial-relation-select").value;
  const source = document.getElementById("spatial-source-select").value;
  const sourceFeatureId = document.getElementById("spatial-source-feature-select").value;
  const distance = document.getElementById("spatial-distance-input").value;
  
  const btn = document.getElementById("btn-run-spatial-query");
  btn.setAttribute("loading", "");
  
  try {
    let url = `${BACKEND_URL}/api/analysis/spatial-filter?target_layer=${target}&source_layer=${source}&relation=${relation}`;
    if (sourceFeatureId) {
      url += `&source_feature_id=${sourceFeatureId}`;
    }
    if (relation === "within_distance") {
      url += `&distance=${distance}`;
    }
    
    const res = await fetch(url);
    if (!res.ok) throw new Error("Spatial query failed");
    
    const geojson = await res.json();
    displayGisQueryResult(geojson, target);
    
  } catch (error) {
    console.error("Spatial query error:", error);
    showToast("Spatial selection failed", error.message, "danger");
  } finally {
    btn.removeAttribute("loading");
  }
}

// Display results of GIS analysis queries (Attribute / Spatial)
function displayGisQueryResult(geojson, targetLayer) {
  lastGisResult = geojson;
  lastGisTargetLayer = targetLayer;
  selectionGraphicsLayer.removeAll();
  
  const features = geojson.features || [];
  
  const container = document.getElementById("gis-results-container");
  const countTitle = document.getElementById("gis-results-title");
  const list = document.getElementById("gis-results-list");
  
  list.innerHTML = "";
  
  if (features.length === 0) {
    container.classList.remove("hidden");
    countTitle.textContent = "Selected: 0 features";
    list.innerHTML = "<calcite-list-item description='No features match the selection criteria.'></calcite-list-item>";
    showToast("No matches", "Query returned 0 features.", "warning");
    return;
  }
  
  container.classList.remove("hidden");
  countTitle.textContent = `Selected: ${features.length} features`;
  
  features.forEach(feat => {
    if (!feat.geometry) return;
    
    const props = feat.properties;
    const geomType = feat.geometry.type;
    let graphicGeom;
    let symbol;
    
    if (geomType === "Point") {
      const coords = feat.geometry.coordinates;
      graphicGeom = new Point({ longitude: coords[0], latitude: coords[1], spatialReference: { wkid: 4326 } });
      symbol = {
        type: "simple-marker",
        color: [0, 255, 255, 0.8], // bright cyan
        size: "14px",
        outline: { color: [255, 235, 59], width: 2 } // yellow outline
      };
    } else {
      // Polygon / MultiPolygon
      if (geomType === "Polygon") {
        graphicGeom = new Polygon({ rings: feat.geometry.coordinates, spatialReference: { wkid: 4326 } });
      } else if (geomType === "MultiPolygon") {
        const allRings = [];
        feat.geometry.coordinates.forEach(polyCoords => {
          polyCoords.forEach(ring => {
            allRings.push(ring);
          });
        });
        graphicGeom = new Polygon({ rings: allRings, spatialReference: { wkid: 4326 } });
      }
      
      symbol = {
        type: "simple-fill",
        color: [0, 255, 255, 0.15], // soft cyan
        outline: {
          color: [0, 255, 255, 1.0], // bright cyan
          width: 2.5
        }
      };
    }
    
    const graphic = new Graphic({
      geometry: graphicGeom,
      symbol: symbol,
      attributes: props
    });
    
    selectionGraphicsLayer.add(graphic);
    
    // Add item to result list
    const item = document.createElement("calcite-list-item");
    item.setAttribute("label", props.name || `Feature #${props.id}`);
    
    let desc = "";
    if (targetLayer === "pois") {
      desc = `Category: ${props.category || "N/A"} • Rating: ⭐ ${props.rating || "N/A"}`;
    } else {
      desc = Object.entries(props)
        .filter(([k]) => !["id", "name", "geom", "properties"].includes(k.toLowerCase()))
        .slice(0, 2)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
    }
    
    item.setAttribute("description", desc);
    item.setAttribute("icon-start", targetLayer === "pois" ? "tour" : "polygon");
    
    item.addEventListener("click", () => {
      // Zoom to feature
      view.goTo({ target: graphicGeom, zoom: targetLayer === "pois" ? 15 : undefined }, { duration: 1000 });
    });
    
    list.appendChild(item);
  });
  
  // Automatically zoom to extent of all selected features
  view.goTo(selectionGraphicsLayer.graphics).catch(err => {
    if (selectionGraphicsLayer.graphics.length > 0) {
      view.goTo({ target: selectionGraphicsLayer.graphics.getItemAt(0).geometry, zoom: 14 });
    }
  });
  
  showToast("Query Completed", `Found and highlighted ${features.length} features.`, "success");
}

// Clear all selection highlights and results list
function clearGisSelection() {
  selectionGraphicsLayer.removeAll();
  document.getElementById("gis-results-container").classList.add("hidden");
  document.getElementById("gis-results-list").innerHTML = "";
  showToast("Selection Cleared", "Query highlights removed.", "brand");
}

// Bind openAddPoiModal on window so geocoder popups can call it
window.openAddPoiModal = openAddPoiModal;

// ═══════════════════════════════════════════════════════════════════
// OPENROUTESERVICE GEOCODING LOGIC
// ═══════════════════════════════════════════════════════════════════

function setupGeocoder() {
  const inputEl = document.getElementById("geocoder-input");
  const resultsList = document.getElementById("geocoder-results-list");
  
  let debounceTimeout = null;
  
  // Listen to text input with debounce
  inputEl.addEventListener("calciteInputInput", (e) => {
    const query = e.target.value.trim();
    
    // Clear debounce
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    if (query.length < 3) {
      resultsList.classList.add("hidden");
      resultsList.innerHTML = "";
      return;
    }
    
    debounceTimeout = setTimeout(async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/geocode?text=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error("Geocoding failed");
        const data = await response.json();
        
        const features = data.features || [];
        resultsList.innerHTML = "";
        
        if (features.length === 0) {
          const item = document.createElement("calcite-list-item");
          item.setAttribute("label", "No places found");
          item.setAttribute("description", "Try searching another query in Nepal");
          resultsList.appendChild(item);
        } else {
          features.forEach(feat => {
            const props = feat.properties;
            const coords = feat.geometry.coordinates; // [lon, lat]
            
            const item = document.createElement("calcite-list-item");
            item.setAttribute("label", props.name || props.label || "Unknown Place");
            item.setAttribute("description", `${props.locality || ""} ${props.region || ""}`.trim() || "Nepal");
            item.setAttribute("icon-start", "pin");
            
            item.addEventListener("click", () => {
              // Zoom to coordinate
              view.goTo({
                center: [coords[0], coords[1]],
                zoom: 16
              }, { duration: 1200 });
              
              // Clear previous selection highlight/temp markers
              tempGraphicsLayer.removeAll();
              
              // Add a search highlight marker
              const searchMarker = new Graphic({
                geometry: new Point({ longitude: coords[0], latitude: coords[1], spatialReference: { wkid: 4326 } }),
                symbol: {
                  type: "simple-marker",
                  color: [0, 122, 255], // blue
                  size: "14px",
                  outline: { color: [255, 255, 255], width: 2 }
                }
              });
              tempGraphicsLayer.add(searchMarker);
              
              // Open popup with buttons to route or save POI
              const placeName = props.name || props.label || "Searched Place";
              view.openPopup({
                title: placeName,
                location: searchMarker.geometry,
                content: `
                  <div style="font-family: 'Outfit', sans-serif;">
                    <p style="margin: 0 0 8px 0; font-size: 0.9em; color: #555;"><b>Location:</b> ${props.label || "Nepal"}</p>
                  </div>
                `
              });
              
              resultsList.classList.add("hidden");
            });
            resultsList.appendChild(item);
          });
        }
        
        resultsList.classList.remove("hidden");
      } catch (err) {
        console.error("Geocoding suggestion error:", err);
      }
    }, 300);
  });
  
  // Hide results list when clicking outside
  document.addEventListener("click", (e) => {
    const geocoderContainer = document.getElementById("geocoder-search-container");
    if (geocoderContainer && !geocoderContainer.contains(e.target)) {
      resultsList.classList.add("hidden");
    }
  });
}

function setupRoutingGeocoders() {
  setupSingleRoutingGeocoder("route-start-search", "route-start-results", "start");
  setupSingleRoutingGeocoder("route-end-search", "route-end-results", "end");
  
  // Set up the map buttons
  const btnStartMap = document.getElementById("btn-route-start-map");
  const btnEndMap = document.getElementById("btn-route-end-map");
  
  if (btnStartMap) {
    btnStartMap.addEventListener("click", (e) => {
      e.stopPropagation();
      if (routingClickMode === "start") {
        resetRoutingClickMode();
      } else {
        resetRoutingClickMode();
        routingClickMode = "start";
        btnStartMap.setAttribute("kind", "brand");
        btnStartMap.setAttribute("appearance", "solid");
        showToast("Map Click Active", "Click on the map to set the routing Start point.", "brand");
      }
    });
  }
  
  if (btnEndMap) {
    btnEndMap.addEventListener("click", (e) => {
      e.stopPropagation();
      if (routingClickMode === "end") {
        resetRoutingClickMode();
      } else {
        resetRoutingClickMode();
        routingClickMode = "end";
        btnEndMap.setAttribute("kind", "brand");
        btnEndMap.setAttribute("appearance", "solid");
        showToast("Map Click Active", "Click on the map to set the routing End point.", "brand");
      }
    });
  }
}

function setupSingleRoutingGeocoder(inputId, resultsListId, type) {
  const inputEl = document.getElementById(inputId);
  const resultsList = document.getElementById(resultsListId);
  if (!inputEl || !resultsList) return;
  
  let debounceTimeout = null;
  
  inputEl.addEventListener("calciteInputInput", (e) => {
    const query = e.target.value.trim();
    
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    if (query.length < 2) {
      resultsList.classList.add("hidden");
      resultsList.innerHTML = "";
      return;
    }
    
    debounceTimeout = setTimeout(async () => {
      try {
        const matches = [];
        
        // 1. Search local DB POIs
        const localMatches = allPois.filter(p => p.properties?.name?.toLowerCase().includes(query.toLowerCase()));
        localMatches.forEach(p => {
          matches.push({
            name: p.properties.name,
            description: `Database POI · ${p.properties.category || ""}`,
            coords: p.geometry.coordinates,
            source: "local"
          });
        });
        
        // 2. Search Overpass live POIs if any loaded
        const liveMatches = overpassPois.filter(p => p.properties?.name?.toLowerCase().includes(query.toLowerCase()));
        liveMatches.forEach(p => {
          matches.push({
            name: p.properties.name,
            description: `Live OSM POI · ${p.properties.category || ""}`,
            coords: p.geometry.coordinates,
            source: "live"
          });
        });
        
        // 3. Search ORS Geocoding API if query is 3+ chars
        if (query.length >= 3) {
          const response = await fetch(`${BACKEND_URL}/api/geocode?text=${encodeURIComponent(query)}`);
          if (response.ok) {
            const data = await response.json();
            const features = data.features || [];
            features.forEach(feat => {
              const props = feat.properties;
              matches.push({
                name: props.name || props.label || "Unknown Place",
                description: `${props.locality || ""} ${props.region || ""}`.trim() || "Address Search",
                coords: feat.geometry.coordinates,
                source: "geocoding"
              });
            });
          }
        }
        
        resultsList.innerHTML = "";
        
        if (matches.length === 0) {
          const item = document.createElement("calcite-list-item");
          item.setAttribute("label", "No places found");
          item.setAttribute("description", "Try searching another query in Nepal");
          resultsList.appendChild(item);
        } else {
          // Take top 6 results
          matches.slice(0, 6).forEach(match => {
            const item = document.createElement("calcite-list-item");
            item.setAttribute("label", match.name);
            item.setAttribute("description", match.description);
            item.setAttribute("icon-start", match.source === "local" ? "bookmark" : "pin");
            
            item.addEventListener("click", () => {
              if (type === "start") {
                setRoutingStart(match.coords[0], match.coords[1], match.name);
              } else {
                setRoutingEnd(match.coords[0], match.coords[1], match.name);
                if (routingStartCoords) {
                  calculateRoute();
                }
              }
              
              resultsList.classList.add("hidden");
              
              // Highlight selection on map
              view.goTo({
                center: [match.coords[0], match.coords[1]],
                zoom: 15
              }, { duration: 1000 });
            });
            resultsList.appendChild(item);
          });
        }
        
        resultsList.classList.remove("hidden");
      } catch (err) {
        console.error("Routing geocoding error:", err);
      }
    }, 250);
  });
  
  // Hide results list when clicking outside
  document.addEventListener("click", (e) => {
    if (inputEl && !inputEl.contains(e.target) && resultsList && !resultsList.contains(e.target)) {
      resultsList.classList.add("hidden");
    }
  });
}

// Bind isochrone center setter and routing geocoders on window
window.setIsochroneCenter = setIsochroneCenter;
window.setupRoutingGeocoders = setupRoutingGeocoders;

// ═══════════════════════════════════════════════════════════════════
// OPENROUTESERVICE ISOCHRONES LOGIC
// ═══════════════════════════════════════════════════════════════════

function setIsochroneCenter(lon, lat, name) {
  isochroneCenterPoint = { lon, lat };
  const label = name || `Coordinates: ${lon.toFixed(4)}, ${lat.toFixed(4)}`;
  document.getElementById("iso-center-display").value = label;
  
  // Highlight center point
  tempGraphicsLayer.removeAll();
  const pointGraphic = new Graphic({
    geometry: new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } }),
    symbol: {
      type: "simple-marker",
      style: "circle",
      color: [0, 122, 255],
      size: "14px",
      outline: { color: [255, 255, 255], width: 2 }
    }
  });
  tempGraphicsLayer.add(pointGraphic);
  showToast("Center Selected", "Isochrone center point set. Click 'Generate Isochrones' to calculate.", "brand");
}

async function runIsochroneAnalysis() {
  if (!isochroneCenterPoint) {
    showToast("Center Required", "Please click on the map or search a place to set the center point first.", "warning");
    return;
  }
  
  const profile = document.getElementById("iso-profile-select").value;
  const rangeType = document.getElementById("iso-range-type").value;
  const r1 = parseFloat(document.getElementById("slider-iso-range-1").value);
  const r2 = parseFloat(document.getElementById("slider-iso-range-2").value);
  const r3 = parseFloat(document.getElementById("slider-iso-range-3").value);
  
  // Sort ranges in ascending order so ORS generates them correctly
  const ranges = [r1, r2, r3].sort((a, b) => a - b);
  
  const btn = document.getElementById("btn-run-isochrones");
  btn.setAttribute("loading", "");
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/analysis/isochrones?lon=${isochroneCenterPoint.lon}&lat=${isochroneCenterPoint.lat}&profile=${profile}&range_type=${rangeType}&ranges=${ranges.join("&ranges=")}`, {
      method: "POST"
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to generate isochrones.");
    }
    
    const geojson = await response.json();
    drawIsochrones(geojson, rangeType);
    
  } catch (error) {
    console.error("Isochrones error:", error);
    showToast("Isochrone Analysis Failed", error.message, "danger");
  } finally {
    btn.removeAttribute("loading");
  }
}

function drawIsochrones(geojson, rangeType) {
  isochronesGraphicsLayer.removeAll();
  
  const features = geojson.features || [];
  if (features.length === 0) {
    showToast("No Isochrones Found", "The routing API did not return any polygons.", "warning");
    return;
  }
  
  // Sort features in descending order of their range value!
  // This ensures the largest polygon (outer) is drawn first (at the bottom)
  // and the smallest polygon (inner) is drawn last (on the top).
  features.sort((a, b) => {
    const valA = a.properties.value || 0;
    const valB = b.properties.value || 0;
    return valB - valA; // descending
  });
  
  // concentric colors (outer -> red, mid -> orange, inner -> green)
  const COLOR_PALETTE = [
    { fill: [255, 59, 48, 0.18], outline: [255, 59, 48, 0.9] },       // Red (Outermost)
    { fill: [255, 149, 0, 0.28], outline: [255, 149, 0, 0.9] },      // Orange (Mid)
    { fill: [52, 199, 89, 0.38], outline: [52, 199, 89, 0.9] }       // Green (Innermost)
  ];
  
  features.forEach((feat, idx) => {
    if (!feat.geometry) return;
    
    const geomType = feat.geometry.type;
    let polyGeom;
    
    if (geomType === "Polygon") {
      polyGeom = new Polygon({
        rings: feat.geometry.coordinates,
        spatialReference: { wkid: 4326 }
      });
    } else if (geomType === "MultiPolygon") {
      const allRings = [];
      feat.geometry.coordinates.forEach(polyCoords => {
        polyCoords.forEach(ring => {
          allRings.push(ring);
        });
      });
      polyGeom = new Polygon({
        rings: allRings,
        spatialReference: { wkid: 4326 }
      });
    } else {
      return;
    }
    
    const colorTheme = COLOR_PALETTE[Math.min(idx, COLOR_PALETTE.length - 1)];
    const val = feat.properties.value;
    const label = rangeType === "time" ? `${Math.round(val / 60)} minutes` : `${val} meters`;
    
    const popupTemplate = {
      title: "Isochrone Zone",
      content: `
        <div style="font-family: 'Outfit', sans-serif;">
          <p><strong>Reachable Within:</strong> ${label}</p>
          <p><strong>Area:</strong> ${feat.properties.area_in_meters ? (feat.properties.area_in_meters / 1000000).toFixed(2) + " km²" : "N/A"}</p>
        </div>
      `
    };
    
    const graphic = new Graphic({
      geometry: polyGeom,
      symbol: {
        type: "simple-fill",
        color: colorTheme.fill,
        outline: {
          color: colorTheme.outline,
          width: 2.0
        }
      },
      attributes: feat.properties,
      popupTemplate: popupTemplate
    });
    
    isochronesGraphicsLayer.add(graphic);
  });
  
  // Zoom to the bounds of the isochrones
  view.goTo(isochronesGraphicsLayer.graphics).catch(() => {});
  showToast("Isochrones Generated", `Successfully mapped ${features.length} travel bands.`, "success");
}

function clearIsochrones() {
  if (isochronesGraphicsLayer) isochronesGraphicsLayer.removeAll();
  tempGraphicsLayer.removeAll();
  isochroneCenterPoint = null;
  document.getElementById("iso-center-display").value = "";
  showToast("Isochrones Cleared", "Travel bands and center point removed.", "brand");
}

// Initialize Isochrone UI sliders and forms
// Called from the main DOMContentLoaded so the DOM is always ready.
function initIsochroneUI() {
  const rangeTypeSelect = document.getElementById("iso-range-type");
  const slider1 = document.getElementById("slider-iso-range-1");
  const slider2 = document.getElementById("slider-iso-range-2");
  const slider3 = document.getElementById("slider-iso-range-3");
  const lbl1 = document.getElementById("lbl-iso-range-1");
  const lbl2 = document.getElementById("lbl-iso-range-2");
  const lbl3 = document.getElementById("lbl-iso-range-3");

  if (!rangeTypeSelect || !slider1) {
    console.warn("Isochrone UI elements not found — skipping init.");
    return;
  }

  const updateLabels = () => {
    const type = rangeTypeSelect.value;
    const suffix = type === "time" ? "min" : "m";
    if (lbl1) lbl1.textContent = `Range 1: ${slider1.value} ${suffix}`;
    if (lbl2) lbl2.textContent = `Range 2: ${slider2.value} ${suffix}`;
    if (lbl3) lbl3.textContent = `Range 3: ${slider3.value} ${suffix}`;
  };

  rangeTypeSelect.addEventListener("calciteSelectChange", () => {
    const type = rangeTypeSelect.value;
    if (type === "time") {
      slider1.min = 1;   slider1.max = 60;    slider1.value = 5;    slider1.step = 1;
      slider2.min = 1;   slider2.max = 60;    slider2.value = 10;   slider2.step = 1;
      slider3.min = 1;   slider3.max = 60;    slider3.value = 15;   slider3.step = 1;
    } else {
      slider1.min = 100; slider1.max = 20000; slider1.value = 1000; slider1.step = 100;
      slider2.min = 100; slider2.max = 20000; slider2.value = 2000; slider2.step = 100;
      slider3.min = 100; slider3.max = 20000; slider3.value = 5000; slider3.step = 100;
    }
    updateLabels();
  });

  slider1.addEventListener("calciteSliderChange", updateLabels);
  slider2.addEventListener("calciteSliderChange", updateLabels);
  slider3.addEventListener("calciteSliderChange", updateLabels);

  // Bind buttons
  const btnRun   = document.getElementById("btn-run-isochrones");
  const btnClear = document.getElementById("btn-clear-isochrones");
  if (btnRun)   btnRun.addEventListener("click", runIsochroneAnalysis);
  if (btnClear) btnClear.addEventListener("click", clearIsochrones);
}


// ═══════════════════════════════════════════════════════════════════════════════
// NEW FEATURES: Recommendations + Spatial Analysis
// ═══════════════════════════════════════════════════════════════════════════════

// Category colors map (matching DB)
const CATEGORY_COLORS = {
  heritage:    "#8B4513",
  temple:      "#C0392B",
  attraction:  "#2980B9",
  hotel:       "#E67E22",
  restaurant:  "#E74C3C",
  park:        "#27AE60",
  adventure:   "#8E44AD",
  shopping:    "#16A085"
};

// Generate an array of distinct colors for cluster visualization
const CLUSTER_PALETTE = [
  "#E74C3C","#3498DB","#2ECC71","#F39C12","#9B59B6",
  "#1ABC9C","#E67E22","#E91E63","#00BCD4","#8BC34A",
  "#FF5722","#607D8B","#795548","#9C27B0","#03A9F4"
];

/** Populate POI dropdowns in recommendations and spatial analysis panels.
 *  Uses already-loaded allPois data — no extra fetch needed. */
function populatePoiSelects() {
  try {
    // Use allPois (already fetched by fetchPOIsData) if available,
    // otherwise fall back to a fresh fetch.
    const source = allPois.length > 0 ? allPois : null;
    if (!source) {
      // Fallback: fetch independently (e.g. if called before data is ready)
      fetch(`${BACKEND_URL}/api/pois`)
        .then(r => r.json())
        .then(fc => _fillPoiSelects(fc.features || []))
        .catch(e => console.warn("Could not populate POI selects:", e));
      return;
    }
    _fillPoiSelects(source);
  } catch (e) {
    console.warn("Could not populate POI selects:", e);
  }
}

function _fillPoiSelects(features) {
  const pois = features
    .map(f => ({ id: f.id ?? f.properties?.id, name: f.properties?.name }))
    .filter(p => p.id != null && p.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const selects = ["rec-poi-select", "overlap-poi-select"];
  selects.forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    // Keep the first placeholder option only
    while (sel.children.length > 1) sel.removeChild(sel.lastChild);
    pois.forEach(p => {
      const opt = document.createElement("calcite-option");
      opt.value = String(p.id);
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  });
}

/** Initialize the analysis graphics layer */
function ensureAnalysisLayer() {
  if (!analysisGraphicsLayer) {
    analysisGraphicsLayer = new GraphicsLayer({ title: "Spatial Analysis", listMode: "hide" });
    map.add(analysisGraphicsLayer);
  }
  if (!recommendationsGraphicsLayer) {
    recommendationsGraphicsLayer = new GraphicsLayer({ title: "Recommendations", listMode: "hide" });
    map.add(recommendationsGraphicsLayer);
  }
}

// ─── Recommendations Panel ───────────────────────────────────────────────────

function getCategoryBadgeHtml(category) {
  const color = CATEGORY_COLORS[category] || "#6b7280";
  return `<span class="category-badge cat-badge-${category}" style="background:${color}">${category}</span>`;
}

async function runRecommendations() {
  const poiId = document.getElementById("rec-poi-select").value;
  if (!poiId) { showToast("No POI Selected", "Please choose a tourism spot first.", "warning"); return; }
  
  const limit  = document.getElementById("rec-limit").value || 5;

  try {
    const res  = await fetch(`${BACKEND_URL}/api/pois/recommended?poi_id=${poiId}&limit=${limit}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    if (!data.source) { showToast("Not Found", "POI not found in database.", "warning"); return; }

    ensureAnalysisLayer();
    recommendationsGraphicsLayer.removeAll();

    // Show source card
    const srcCard = document.getElementById("rec-source-card");
    srcCard.classList.remove("hidden");
    srcCard.innerHTML = `
      <div class="rec-source-name">📍 ${data.source.name}</div>
      <div class="rec-source-meta">
        ${getCategoryBadgeHtml(data.source.category)}
        <span style="margin-left:6px; color:var(--calcite-ui-text-3)">${data.source.district || ""} District</span>
      </div>`;

    // Fly to source POI on map
    const srcPoi = allPois.find(p => p.id === parseInt(poiId));
    if (srcPoi && srcPoi.geometry) {
      view.goTo({ center: [srcPoi.geometry.x, srcPoi.geometry.y], zoom: 13 });
    }

    // Render recommendation cards
    const container = document.getElementById("rec-results-container");
    const list      = document.getElementById("rec-results-list");
    container.classList.remove("hidden");
    list.innerHTML = "";

    if (!data.recommendations || data.recommendations.length === 0) {
      list.innerHTML = `<p style="color:var(--calcite-ui-text-2);font-size:13px;text-align:center;padding:12px">No recommendations found for this POI.</p>`;
      return;
    }

    data.recommendations.forEach((rec, idx) => {
      const card = document.createElement("div");
      card.className = "rec-card";
      const distKm = rec.distance_m != null ? (rec.distance_m / 1000).toFixed(1) + " km" : "—";
      const score  = rec.rec_score  != null ? `★ ${rec.rec_score}` : "";
      card.innerHTML = `
        <div class="rec-card-rank">${idx + 1}</div>
        <div class="rec-card-body">
          <div class="rec-card-name">${rec.name}</div>
          <div class="rec-card-meta">
            ${getCategoryBadgeHtml(rec.category)}
            ${score ? `<span class="rec-score-badge">${score}</span>` : ""}
            <span class="rec-dist-badge">📏 ${distKm}</span>
          </div>
          <div class="rec-card-reason">${rec.reason || ""}</div>
          <button class="rec-fly-btn" data-lon="${rec.lon}" data-lat="${rec.lat}" data-name="${rec.name}">
            🗺 View on Map
          </button>
        </div>`;
      list.appendChild(card);

      // Draw a highlighted marker on map for this recommendation
      if (rec.lon && rec.lat) {
        const color = CATEGORY_COLORS[rec.category] || [100, 100, 200];
        recommendationsGraphicsLayer.add(new Graphic({
          geometry: { type: "point", longitude: rec.lon, latitude: rec.lat },
          symbol: {
            type: "simple-marker",
            style: "circle",
            size: "14px",
            color: CATEGORY_COLORS[rec.category] || "#6b7280",
            outline: { color: "#ffffff", width: 2 }
          },
          attributes: { name: rec.name, category: rec.category, rank: idx + 1 },
          popupTemplate: {
            title: `#${idx+1} — ${rec.name}`,
            content: `<b>Category:</b> ${rec.category}<br><b>Distance:</b> ${distKm}<br><i>${rec.reason || ""}</i>`
          }
        }));
      }
    });

    // Fly-to button click handlers
    list.querySelectorAll(".rec-fly-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const lon = parseFloat(btn.dataset.lon);
        const lat = parseFloat(btn.dataset.lat);
        if (!isNaN(lon) && !isNaN(lat)) view.goTo({ center: [lon, lat], zoom: 15 });
      });
    });

    showToast("Recommendations Ready", `Found ${data.recommendations.length} places similar to "${data.source.name}".`, "success");
  } catch (err) {
    showToast("Recommendations Failed", err.message, "danger");
  }
}

function clearRecommendations() {
  if (recommendationsGraphicsLayer) recommendationsGraphicsLayer.removeAll();
  document.getElementById("rec-source-card").classList.add("hidden");
  document.getElementById("rec-results-container").classList.add("hidden");
}

// ─── Cluster Analysis (DBSCAN) ───────────────────────────────────────────────

async function runClusterAnalysis() {
  const radius    = parseInt(document.getElementById("slider-cluster-radius").value) || 500;
  const minPoints = parseInt(document.getElementById("slider-cluster-minpts").value) || 2;
  
  try {
    const res  = await fetch(`${BACKEND_URL}/api/analysis/cluster?radius=${radius}&min_points=${minPoints}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    ensureAnalysisLayer();
    analysisGraphicsLayer.removeAll();

    const colorMap = {};
    let colorIdx = 0;

    data.pois.forEach(poi => {
      const cid = poi.cluster_id;
      let color;
      if (cid === null || cid === undefined) {
        color = [150, 150, 150, 180]; // noise = grey
      } else {
        if (!(cid in colorMap)) {
          colorMap[cid] = CLUSTER_PALETTE[colorIdx % CLUSTER_PALETTE.length];
          colorIdx++;
        }
        color = colorMap[cid];
      }
      analysisGraphicsLayer.add(new Graphic({
        geometry: { type: "point", longitude: poi.lon, latitude: poi.lat },
        symbol: {
          type: "simple-marker",
          style: "circle",
          size: cid !== null ? "16px" : "10px",
          color: color,
          outline: { color: "#ffffff", width: 2 }
        },
        attributes: { ...poi },
        popupTemplate: {
          title: poi.name,
          content: `<b>Cluster:</b> ${cid !== null ? "#" + cid : "Noise (isolated)"}<br><b>Category:</b> ${poi.category}<br><b>District:</b> ${poi.district}`
        }
      }));
    });

    // Show result stats
    const resultsBox = document.getElementById("cluster-results");
    resultsBox.classList.remove("hidden");

    const legendItems = Object.entries(colorMap).map(([cid, color]) => {
      const count = data.pois.filter(p => p.cluster_id === parseInt(cid)).length;
      return `<div class="cluster-legend-item"><div class="cluster-dot" style="background:${color}"></div>Cluster ${cid} (${count} places)</div>`;
    }).join("");

    resultsBox.innerHTML = `
      <div class="analysis-stat"><span class="stat-label">Total POIs</span><span class="stat-value">${data.total_points}</span></div>
      <div class="analysis-stat"><span class="stat-label">Clusters Found</span><span class="stat-value">${data.cluster_count}</span></div>
      <div class="analysis-stat"><span class="stat-label">Noise Points</span><span class="stat-value">${data.pois.filter(p => p.cluster_id === null).length}</span></div>
      <div class="analysis-stat"><span class="stat-label">Radius</span><span class="stat-value">${data.radius_meters}m</span></div>
      <div class="cluster-legend">${legendItems}<div class="cluster-legend-item"><div class="cluster-dot" style="background:#969696"></div>Noise</div></div>`;

    view.goTo(analysisGraphicsLayer.graphics);
    showToast("Cluster Analysis Done", `Found ${data.cluster_count} clusters across ${data.total_points} POIs.`, "success");
  } catch (err) {
    showToast("Cluster Analysis Failed", err.message, "danger");
  }
}

// ─── Nearest Facility Finder ─────────────────────────────────────────────────

function toggleNearestFacilityMode() {
  nearestFacilityMode = !nearestFacilityMode;
  const btn = document.getElementById("btn-toggle-nearest");
  if (nearestFacilityMode) {
    btn.setAttribute("appearance", "solid");
    btn.textContent = "Click on the Map...";
    showToast("Nearest Facility Mode", "Click anywhere on the map to set the query location.", "brand");
  } else {
    btn.setAttribute("appearance", "outline");
    btn.textContent = "Enable Map Click Mode";
  }
}

async function runNearestFacility() {
  if (!nearestFacilityCoords) {
    showToast("No Location", "Enable map click mode and click the map first.", "warning");
    return;
  }
  const [lon, lat] = nearestFacilityCoords;
  const catEl    = document.getElementById("nearest-category-select");
  const category = catEl ? catEl.value : "";
  const limit    = parseInt(document.getElementById("slider-nearest-limit").value) || 5;
  
  try {
    let url = `${BACKEND_URL}/api/analysis/nearest-facility?lon=${lon}&lat=${lat}&limit=${limit}`;
    if (category) url += `&category=${encodeURIComponent(category)}`;

    const res  = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    ensureAnalysisLayer();
    analysisGraphicsLayer.removeAll();

    // Draw query center marker
    analysisGraphicsLayer.add(new Graphic({
      geometry: { type: "point", longitude: lon, latitude: lat },
      symbol: { type: "simple-marker", style: "cross", size: "18px", color: "#E74C3C", outline: { color: "#fff", width: 2 } }
    }));

    // Draw result POIs with connection lines
    data.results.forEach((poi, idx) => {
      const color = CATEGORY_COLORS[poi.category] || "#6b7280";
      analysisGraphicsLayer.add(new Graphic({
        geometry: { type: "polyline", paths: [[[lon, lat], [poi.lon, poi.lat]]] },
        symbol: { type: "simple-line", color: [100, 100, 200, 120], width: 1.5, style: "dash" }
      }));
      analysisGraphicsLayer.add(new Graphic({
        geometry: { type: "point", longitude: poi.lon, latitude: poi.lat },
        symbol: {
          type: "simple-marker", style: "circle", size: "14px",
          color: color, outline: { color: "#fff", width: 2 }
        },
        attributes: { ...poi, rank: idx + 1 },
        popupTemplate: {
          title: `#${idx + 1} — ${poi.name}`,
          content: `<b>Distance:</b> ${poi.distance_m >= 1000 ? (poi.distance_m/1000).toFixed(2)+"km" : poi.distance_m+"m"}<br><b>Category:</b> ${poi.category}<br><b>Rating:</b> ${poi.rating || "—"}`
        }
      }));
    });

    // Show results
    const box = document.getElementById("nearest-results");
    box.classList.remove("hidden");
    box.innerHTML = data.results.map((poi, idx) => `
      <div class="nearest-result-item">
        <div class="nearest-rank-circle">${idx + 1}</div>
        <div>
          <div class="nearest-name">${poi.name}</div>
          <div class="nearest-cat">${getCategoryBadgeHtml(poi.category)}</div>
          <div class="nearest-dist">📏 ${poi.distance_m >= 1000 ? (poi.distance_m/1000).toFixed(2)+" km" : poi.distance_m+" m"}</div>
        </div>
      </div>`).join("");

    view.goTo({ center: [lon, lat], zoom: 13 });
    showToast("Nearest Facilities", `${data.results.length} facilities found near clicked point.`, "success");
  } catch (err) {
    showToast("Nearest Facility Failed", err.message, "danger");
  }
}

// ─── Density Zones ────────────────────────────────────────────────────────────

async function runDensityAnalysis() {
  const radius = parseInt(document.getElementById("slider-density-radius").value) || 1000;

  try {
    const res  = await fetch(`${BACKEND_URL}/api/analysis/density?radius=${radius}`);
    if (!res.ok) throw new Error(await res.text());
    const geojson = await res.json();

    ensureAnalysisLayer();
    analysisGraphicsLayer.removeAll();

    const densities = geojson.features.map(f => f.properties.density);
    const maxDensity = Math.max(...densities, 1);

    geojson.features.forEach(feat => {
      if (!feat.geometry) return;
      const density  = feat.properties.density;
      const ratio    = density / maxDensity;
      // Green → Yellow → Red gradient by density
      const r = Math.round(255 * Math.min(ratio * 2, 1));
      const g = Math.round(255 * Math.min(2 - ratio * 2, 1));
      const alpha = 0.2 + ratio * 0.35;

      const coords = feat.geometry.coordinates[0].map(c => [c[0], c[1]]);
      analysisGraphicsLayer.add(new Graphic({
        geometry: new Polygon({ rings: [coords], spatialReference: { wkid: 4326 } }),
        symbol: {
          type: "simple-fill",
          color: [r, g, 0, alpha],
          outline: { color: [r, g, 0, 0.6], width: 1 }
        },
        attributes: feat.properties,
        popupTemplate: {
          title: feat.properties.poi_name,
          content: `<b>Nearby POIs within ${radius}m:</b> ${density}<br><b>Category:</b> ${feat.properties.category}`
        }
      }));
    });

    view.goTo(analysisGraphicsLayer.graphics);
    showToast("Density Map Generated", `${geojson.features.length} density zones drawn. Red = high concentration.`, "success");
  } catch (err) {
    showToast("Density Analysis Failed", err.message, "danger");
  }
}

function clearDensityAnalysis() {
  if (analysisGraphicsLayer) analysisGraphicsLayer.removeAll();
  showToast("Density Cleared", "Density zones removed from map.", "brand");
}

// ─── Service Area Overlap ─────────────────────────────────────────────────────

async function runServiceAreaOverlap() {
  const poiId  = document.getElementById("overlap-poi-select").value;
  if (!poiId) { showToast("No POI", "Please select a source POI.", "warning"); return; }
  const radius = parseInt(document.getElementById("slider-overlap-radius").value) || 1000;

  try {
    const res  = await fetch(`${BACKEND_URL}/api/analysis/service-overlap?poi_id=${poiId}&radius=${radius}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    ensureAnalysisLayer();
    analysisGraphicsLayer.removeAll();

    // Draw source POI buffer
    const src = data.source_poi;
    if (src && src.center) {
      const srcCoords = [src.center.lon, src.center.lat];
      analysisGraphicsLayer.add(new Graphic({
        geometry: { type: "point", longitude: src.center.lon, latitude: src.center.lat },
        symbol: {
          type: "simple-marker", style: "circle", size: "18px",
          color: [231, 76, 60, 200], outline: { color: "#fff", width: 3 }
        },
        popupTemplate: { title: "Source: " + src.name, content: `Service radius: ${radius}m` }
      }));
    }

    // Draw overlapping buffers
    const overlaps = data.overlapping_buffers;
    if (overlaps && overlaps.features) {
      overlaps.features.forEach((feat, idx) => {
        if (!feat.geometry) return;
        const coords = feat.geometry.coordinates[0].map(c => [c[0], c[1]]);
        const color  = CATEGORY_COLORS[feat.properties.category] || "#6b7280";
        const rgb    = hexToRgb(color);
        analysisGraphicsLayer.add(new Graphic({
          geometry: new Polygon({ rings: [coords], spatialReference: { wkid: 4326 } }),
          symbol: {
            type: "simple-fill",
            color: [...rgb, 60],
            outline: { color: [...rgb, 200], width: 2 }
          },
          attributes: feat.properties,
          popupTemplate: {
            title: feat.properties.name,
            content: `<b>Category:</b> ${feat.properties.category}<br><b>Distance from source:</b> ${feat.properties.distance_m}m`
          }
        }));
      });

      const box = document.getElementById("overlap-results");
      box.classList.remove("hidden");
      box.innerHTML = `
        <div class="analysis-stat"><span class="stat-label">Source POI</span><span class="stat-value">${src.name}</span></div>
        <div class="analysis-stat"><span class="stat-label">Overlapping POIs</span><span class="stat-value">${overlaps.features.length}</span></div>
        <div class="analysis-stat"><span class="stat-label">Service Radius</span><span class="stat-value">${radius}m</span></div>`;
    }

    view.goTo({ center: [src.center.lon, src.center.lat], zoom: 13 });
    showToast("Overlap Analysis Done", `${overlaps.features.length} POIs overlap with "${src.name}".`, "success");
  } catch (err) {
    showToast("Overlap Analysis Failed", err.message, "danger");
  }
}

function clearServiceAreaOverlap() {
  if (analysisGraphicsLayer) analysisGraphicsLayer.removeAll();
  document.getElementById("overlap-results").classList.add("hidden");
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [100, 100, 200];
}

// ─── Initialize new panels — called from the main DOMContentLoaded ──────────

function initAnalysisPanels() {

  // Slider labels for spatial analysis panel
  const clusterRadiusSlider = document.getElementById("slider-cluster-radius");
  const clusterMinPtsSlider = document.getElementById("slider-cluster-minpts");
  const densityRadiusSlider = document.getElementById("slider-density-radius");
  const overlapRadiusSlider = document.getElementById("slider-overlap-radius");
  const nearestLimitSlider  = document.getElementById("slider-nearest-limit");

  if (clusterRadiusSlider) {
    clusterRadiusSlider.addEventListener("calciteSliderChange", e =>
      (document.getElementById("lbl-cluster-radius").textContent = `Cluster Radius: ${e.target.value}m`));
  }
  if (clusterMinPtsSlider) {
    clusterMinPtsSlider.addEventListener("calciteSliderChange", e =>
      (document.getElementById("lbl-cluster-minpts").textContent = `Min. Points per Cluster: ${e.target.value}`));
  }
  if (densityRadiusSlider) {
    densityRadiusSlider.addEventListener("calciteSliderChange", e =>
      (document.getElementById("lbl-density-radius").textContent = `Density Radius: ${e.target.value}m`));
  }
  if (overlapRadiusSlider) {
    overlapRadiusSlider.addEventListener("calciteSliderChange", e =>
      (document.getElementById("lbl-overlap-radius").textContent = `Service Radius: ${e.target.value}m`));
  }
  if (nearestLimitSlider) {
    nearestLimitSlider.addEventListener("calciteSliderChange", e =>
      (document.getElementById("lbl-nearest-limit").textContent = `Results: ${e.target.value}`));
  }

  // Button bindings — Recommendations
  const btnRunRec   = document.getElementById("btn-run-recommendations");
  const btnClearRec = document.getElementById("btn-clear-recommendations");
  if (btnRunRec)   btnRunRec.addEventListener("click", runRecommendations);
  if (btnClearRec) btnClearRec.addEventListener("click", clearRecommendations);

  // Button bindings — Spatial Analysis
  const btnCluster  = document.getElementById("btn-run-cluster");
  const btnNearest  = document.getElementById("btn-run-nearest");
  const btnToggleN  = document.getElementById("btn-toggle-nearest");
  const btnDensity  = document.getElementById("btn-run-density");
  const btnClrDens  = document.getElementById("btn-clear-density");
  const btnOverlap  = document.getElementById("btn-run-overlap");
  const btnClrOvlp  = document.getElementById("btn-clear-overlap");

  if (btnCluster)  btnCluster.addEventListener("click", runClusterAnalysis);
  if (btnNearest)  btnNearest.addEventListener("click", runNearestFacility);
  if (btnToggleN)  btnToggleN.addEventListener("click", toggleNearestFacilityMode);
  if (btnDensity)  btnDensity.addEventListener("click", runDensityAnalysis);
  if (btnClrDens)  btnClrDens.addEventListener("click", clearDensityAnalysis);
  if (btnOverlap)  btnOverlap.addEventListener("click", runServiceAreaOverlap);
  if (btnClrOvlp)  btnClrOvlp.addEventListener("click", clearServiceAreaOverlap);
}

// Handle map clicks for nearest facility mode
// This hook integrates with the existing view.on("click") handler in initMap
// We patch the existing click handler to also route to nearest-facility mode
// by observing nearestFacilityMode state
const _origHandleMapClick = typeof handleMapClick === "function" ? handleMapClick : null;

function handleNearestFacilityClick(event) {
  if (!nearestFacilityMode) return false;
  const pt = event.mapPoint;
  nearestFacilityCoords = [pt.longitude, pt.latitude];
  const display = document.getElementById("nearest-center-display");
  if (display) display.value = `${pt.longitude.toFixed(5)}, ${pt.latitude.toFixed(5)}`;
  nearestFacilityMode = false;
  const btn = document.getElementById("btn-toggle-nearest");
  if (btn) { btn.setAttribute("appearance", "outline"); btn.textContent = "Enable Map Click Mode"; }
  showToast("Location Set", `Query point set to ${pt.longitude.toFixed(4)}, ${pt.latitude.toFixed(4)}`, "success");
  return true;
}

// Expose helper so the existing click handler can call it
window.__handleNearestFacilityClick = handleNearestFacilityClick;
