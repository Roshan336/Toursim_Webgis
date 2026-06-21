import os
import shutil
import tempfile
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List

from backend.db import (
    get_all_pois, add_poi, get_route, get_pois_within_buffer, delete_poi,
    get_geojson_layer, spatial_filter_query, identify_by_location, search_by_attribute,
    get_poi_categories, get_category_stats, get_recommendations,
    run_cluster_analysis, get_nearest_facility, get_density_zones, get_service_area_overlap,
    upsert_osm_pois, get_osm_pois_geojson, get_osm_category_stats, get_search_recommendations,
    ALL_LAYERS,
)
from backend.google_routes import GoogleRouteConfigurationError, GoogleRouteError, get_google_route
from backend.gis_analysis import import_shapefile_to_postgis, search_arcgis_tourism_layers
from backend.openrouteservice import (
    OpenRouteServiceConfigurationError,
    OpenRouteServiceError,
    get_openrouteservice_route,
)
from backend.overpass_fetch import fetch_kathmandu_pois

load_dotenv()

app = FastAPI(
    title="TourGIS API Backend",
    description="Python Backend for Tourism Web GIS utilizing PostGIS, pgRouting, and ArcGIS Python SDK",
    version="1.0.0"
)

# ── Security Headers Middleware ────────────────────────────────────────────────
# Fixes:
#  - Replaces X-Frame-Options with Content-Security-Policy frame-ancestors
#  - Replaces Expires header with Cache-Control
#  - Removes X-XSS-Protection (deprecated, can enable XSS in modern browsers)
#  - Adds Referrer-Policy and Permissions-Policy
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Cache-Control (preferred over Expires)
        if "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"

        # CSP with frame-ancestors (replaces X-Frame-Options)
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "frame-ancestors 'none';"
        )

        # Remove deprecated / problematic headers.
        # Starlette's MutableHeaders supports deletion, but not dict-style pop().
        for header_name in ("X-Frame-Options", "X-XSS-Protection", "Expires"):
            if header_name in response.headers:
                del response.headers[header_name]

        # Additional hardening
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["X-Content-Type-Options"] = "nosniff"

        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── CORS ───────────────────────────────────────────────────────────────────────
# Restrict to the Vite dev server origin; add production domain when deploying
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):517[3-9]$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

# Pydantic models for request validation
class POICreate(BaseModel):
    name: str = Field(..., example="Pashupatinath Temple")
    category: str = Field(..., example="temple")  # attraction|heritage|temple|hotel|restaurant|park
    district: Optional[str] = Field(None, example="kathmandu")  # kathmandu|lalitpur|bhaktapur
    description: Optional[str] = Field(None, example="Sacred Hindu temple on the Bagmati River")
    rating: Optional[float] = Field(4.5, ge=0.0, le=5.0)
    image_url: Optional[str] = Field(None, example="https://example.com/image.jpg")
    address: Optional[str] = Field(None, example="Pashupatinath Road, Kathmandu")
    lon: float = Field(..., example=85.3486)
    lat: float = Field(..., example=27.7105)

@app.get("/")
def read_root():
    return {
        "app": "TourGIS Backend API",
        "status": "online",
        "database": "connected (PostgreSQL/PostGIS/pgRouting)",
        "features": [
            "POIs management",
            "Shortest path routing (pgRouting)",
            "Buffer queries (PostGIS)",
            "Shapefile importing (ArcGIS Python SDK)",
            "ArcGIS Online integration"
        ]
    }

@app.get("/api/pois")
def get_pois(
    district: Optional[str] = Query(None, description="Filter by district: kathmandu|lalitpur|bhaktapur")
):
    try:
        geojson_data = get_all_pois(district=district)
        return geojson_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch POIs: {str(e)}")


@app.get("/api/overpass-pois")
def get_overpass_pois(
    district: str = Query("all", description="District to query: kathmandu|lalitpur|bhaktapur|all")
):
    """
    Fetch live tourism POIs from OpenStreetMap Overpass API.
    Returns real-time GeoJSON FeatureCollection for Kathmandu Valley.
    """
    try:
        return fetch_kathmandu_pois(district=district)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Overpass API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch live OSM data: {str(e)}")


@app.post("/api/osm/sync")
def sync_osm_pois(
    district: str = Query("all", description="District: kathmandu|lalitpur|bhaktapur|all"),
    category: Optional[str] = Query(None, description="Optional category filter before save"),
):
    """
    Fetch live OSM data via Overpass and upsert into Postgres osm_pois (by category).
    """
    try:
        payload = fetch_kathmandu_pois(district=district)
        features = payload.get("features") or []
        if category and category != "all":
            features = [f for f in features if f.get("properties", {}).get("category") == category]
        stats = upsert_osm_pois(features, payload.get("fetched_at"))
        return {
            "status": "success",
            "district": district,
            "category_filter": category,
            **stats,
        }
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Overpass API error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OSM sync failed: {str(e)}")


@app.get("/api/osm/pois")
def get_stored_osm_pois(
    district: Optional[str] = Query(None, description="Filter by district"),
    category: Optional[str] = Query(None, description="Filter by category code"),
):
    """Return stored OSM POIs from Postgres as GeoJSON."""
    try:
        return get_osm_pois_geojson(district=district, category=category)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch OSM POIs: {str(e)}")


@app.get("/api/osm/stats")
def osm_category_stats():
    """Counts of stored OSM POIs grouped by category and district."""
    try:
        return get_osm_category_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch OSM stats: {str(e)}")

@app.post("/api/pois")
def create_poi(poi: POICreate):
    try:
        new_id = add_poi(
            name=poi.name,
            category=poi.category,
            district=poi.district,
            description=poi.description,
            rating=poi.rating,
            image_url=poi.image_url,
            address=poi.address,
            lon=poi.lon,
            lat=poi.lat
        )
        return {"status": "success", "id": new_id, "message": "POI successfully created."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create POI: {str(e)}")

@app.get("/api/route")
def get_shortest_path(
    start_lon: float = Query(..., description="Longitude of the start point"),
    start_lat: float = Query(..., description="Latitude of the start point"),
    end_lon: float = Query(..., description="Longitude of the end point"),
    end_lat: float = Query(..., description="Latitude of the end point")
):
    try:
        result = calculate_route(start_lon, start_lat, end_lon, end_lat)

        if result.get("status") == "error":
            raise HTTPException(status_code=400, detail=result.get("message"))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Routing analysis failed: {str(e)}")


def calculate_route(start_lon, start_lat, end_lon, end_lat):
    provider = os.getenv("ROUTING_PROVIDER", "auto").strip().lower()

    if provider in ("openrouteservice", "ors"):
        try:
            return get_openrouteservice_route(start_lon, start_lat, end_lon, end_lat)
        except OpenRouteServiceConfigurationError:
            if provider != "auto":
                raise
        except OpenRouteServiceError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e

    if provider in ("google", "google_routes", "auto"):
        try:
            return get_google_route(start_lon, start_lat, end_lon, end_lat)
        except GoogleRouteConfigurationError:
            if provider not in ("auto",):
                raise
        except GoogleRouteError as e:
            raise HTTPException(status_code=502, detail=str(e)) from e

    result = get_route(start_lon, start_lat, end_lon, end_lat)
    result["provider"] = result.get("provider", "pgrouting")
    return result

@app.get("/api/analysis/buffer")
def get_buffer_pois(
    lon: float = Query(..., description="Center point longitude"),
    lat: float = Query(..., description="Center point latitude"),
    distance: float = Query(..., ge=1, le=50000, description="Buffer distance in meters"),
    category: Optional[str] = Query(None, description="Category filter (e.g., heritage, temple, hotel)")
):
    try:
        result = get_pois_within_buffer(lon, lat, distance, category)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Buffer analysis failed: {str(e)}")

@app.post("/api/upload-shapefile")
async def upload_shapefile(
    file: UploadFile = File(..., description="Zipped shapefile (.zip containing .shp, .shx, .dbf, .prj)"),
    table_name: str = Form(..., description="Target database table name")
):
    # Verify file is a zip
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Only zipped shapefiles (.zip) are supported.")
    
    # Save UploadFile to a temporary file
    temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    try:
        shutil.copyfileobj(file.file, temp_zip)
        temp_zip.close()
        
        # Import shapefile
        result = import_shapefile_to_postgis(temp_zip.name, table_name)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Shapefile import failed: {str(e)}")
    finally:
        if os.path.exists(temp_zip.name):
            os.remove(temp_zip.name)

@app.get("/api/analysis/arcgis-search")
def search_arcgis_layers(
    query: str = Query("tourism", description="Query string to search ArcGIS Online layers")
):
    try:
        results = search_arcgis_tourism_layers(query)
        return {"query": query, "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ArcGIS search failed: {str(e)}")

@app.delete("/api/pois/{poi_id}")
def delete_poi_endpoint(poi_id: int):
    try:
        success = delete_poi(poi_id)
        if not success:
            raise HTTPException(status_code=404, detail="POI not found")
        return {"status": "success", "message": "POI successfully removed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/layers/{layer_name}")
def get_layer(
    layer_name: str,
    name: Optional[str] = Query(None, description="Filter features by name"),
    simplify: Optional[float] = Query(None, description="Geometry simplification tolerance (degrees). 0 to disable.")
):
    """
    Get GeoJSON FeatureCollection for a layer (province_layer, district_layer, gapanapa_layer, pois).
    Applies geometry simplification by default for performance.
    """
    try:
        # Default simplification values for performance
        if simplify is None:
            if layer_name == "gapanapa_layer":
                simplify = 0.001  # ~100m, shrinks 47MB to <1MB
            elif layer_name == "district_layer":
                simplify = 0.0005 # ~50m, shrinks 18MB to <800KB
            else:
                simplify = 0.0     # no simplification for province / pois

        geojson_data = get_geojson_layer(layer_name, name_filter=name, simplify_tolerance=simplify)
        return geojson_data
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch layer: {str(e)}")

@app.get("/api/layers/{layer_name}/features")
def get_layer_feature_list(layer_name: str):
    """
    Returns a light list of feature names and IDs from a layer to populate dropdown lists.
    """
    if layer_name not in ("province_layer", "district_layer", "gapanapa_layer", "pois", "osm_pois"):
        raise HTTPException(status_code=400, detail="Invalid layer name")
    
    from backend.db import get_connection
    conn = get_connection()
    cur = conn.cursor()
    try:
        if layer_name == "pois":
            cur.execute("SELECT id, name FROM pois ORDER BY name;")
        elif layer_name == "osm_pois":
            cur.execute("SELECT id, name FROM osm_pois ORDER BY name;")
        else:
            cur.execute(f"SELECT id, name FROM {layer_name} ORDER BY name;")
        rows = cur.fetchall()
        return [{"id": r[0], "name": r[1]} for r in rows]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()

@app.get("/api/analysis/spatial-filter")
def run_spatial_filter(
    target_layer: str = Query(..., description="Target layer name (province_layer|district_layer|gapanapa_layer|pois)"),
    source_layer: str = Query(..., description="Source layer name (province_layer|district_layer|gapanapa_layer|pois)"),
    relation: str = Query(..., description="Spatial relationship (intersects|contains|within|touches|within_distance)"),
    source_feature_id: Optional[int] = Query(None, description="Optional ID of specific feature in source layer to filter by"),
    distance: Optional[float] = Query(0.0, description="Buffer distance in meters for within_distance relationship")
):
    """
    Select features from a target layer that have a spatial relationship with features in a source layer.
    Similar to 'Select Layer By Location' in ArcGIS Pro.
    """
    try:
        result = spatial_filter_query(
            target_layer=target_layer,
            source_layer=source_layer,
            relation=relation,
            source_feature_id=source_feature_id,
            distance_meters=distance
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Spatial filtering failed: {str(e)}")

@app.get("/api/analysis/identify")
def identify_location(
    lon: float = Query(..., description="Longitude of click point"),
    lat: float = Query(..., description="Latitude of click point")
):
    """
    Identify Province, District, and GapaNapa at a specific map coordinate.
    """
    try:
        result = identify_by_location(lon, lat)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Identify query failed: {str(e)}")

@app.get("/api/analysis/attribute-filter")
def run_attribute_filter(
    layer_name: str = Query(..., description="Layer to search (province_layer|district_layer|gapanapa_layer|pois)"),
    property_key: str = Query(..., description="Property/Field key to search (e.g. 'name', 'STATE_CODE', 'Province')"),
    operator: str = Query(..., description="Search operator (equals|contains|starts_with|ends_with|greater_than|less_than)"),
    value: str = Query(..., description="Search value to match")
):
    """
    Filter features by attribute query. Similar to 'Select Layer By Attribute' in ArcGIS Pro.
    """
    try:
        result = search_by_attribute(
            layer_name=layer_name,
            property_key=property_key,
            operator=operator,
            value=value
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Attribute filtering failed: {str(e)}")


# ─── Tourism Categories & Recommendations ─────────────────────────────────────

@app.get("/api/categories")
def list_categories():
    """
    Return all 8 tourism categories with their label, color, and icon metadata.
    """
    try:
        return get_poi_categories()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch categories: {str(e)}")


@app.get("/api/categories/stats")
def list_category_stats():
    """
    Return per-category statistics: POI count, average rating, max rating.
    """
    try:
        return get_category_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch category stats: {str(e)}")


@app.get("/api/pois/recommended")
def get_poi_recommendations(
    poi_id: int = Query(..., description="Source POI ID to find recommendations for"),
    limit: int = Query(5, ge=1, le=20, description="Number of recommendations to return")
):
    """
    Return recommended POIs for a given source POI.
    Uses pre-computed similarity scores + PostGIS nearest-neighbor fallback.
    """
    try:
        result = get_recommendations(poi_id=poi_id, limit=limit)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recommendations failed: {str(e)}")


@app.get("/api/recommendations/search")
def search_recommendations(
    layer_name: str = Query(..., description="Layer that was searched"),
    search_type: str = Query("attribute", description="attribute or spatial"),
    search_key: Optional[str] = Query(None, description="Field searched (attribute queries)"),
    search_value: Optional[str] = Query(None, description="Search text/value"),
    feature_ids: Optional[str] = Query(None, description="Comma-separated result feature IDs"),
    limit: int = Query(5, ge=1, le=15),
):
    """
    AI-style recommendations after a layer search (attribute or spatial).
    Combines category affinity, keyword overlap, distance, and optional OpenAI reasons.
    """
    if layer_name not in ALL_LAYERS:
        raise HTTPException(status_code=400, detail="Invalid layer name")
    ids = []
    if feature_ids:
        ids = [int(x.strip()) for x in feature_ids.split(",") if x.strip().isdigit()]
    try:
        return get_search_recommendations(
            layer_name=layer_name,
            search_type=search_type,
            search_key=search_key,
            search_value=search_value,
            feature_ids=ids,
            limit=limit,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search recommendations failed: {str(e)}")


# ─── PostGIS Spatial Analysis ─────────────────────────────────────────────────

@app.get("/api/analysis/cluster")
def cluster_analysis(
    radius: float = Query(500, ge=50, le=10000, description="Cluster radius in meters"),
    min_points: int = Query(2, ge=1, le=20, description="Minimum points to form a cluster")
):
    """
    Run PostGIS ST_ClusterDBSCAN to group nearby POIs into spatial clusters.
    Each POI is assigned a cluster_id (NULL = noise / isolated point).
    """
    try:
        return run_cluster_analysis(radius_meters=radius, min_points=min_points)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cluster analysis failed: {str(e)}")


@app.get("/api/analysis/nearest-facility")
def nearest_facility(
    lon: float = Query(..., description="Longitude of the query point"),
    lat: float = Query(..., description="Latitude of the query point"),
    category: Optional[str] = Query(None, description="Filter by category code (leave empty for all)"),
    limit: int = Query(5, ge=1, le=20, description="Number of nearest facilities to return")
):
    """
    Find the N nearest POIs to a map location, optionally filtered by category.
    Results are ordered by distance ascending.
    """
    try:
        return get_nearest_facility(lon=lon, lat=lat, category=category, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Nearest facility query failed: {str(e)}")


@app.get("/api/analysis/density")
def density_analysis(
    radius: float = Query(1000, ge=100, le=20000, description="Buffer radius in meters for density calculation")
):
    """
    Generate POI density zones. Each POI gets a buffer polygon annotated
    with how many other POIs fall within that radius.
    """
    try:
        return get_density_zones(radius_meters=radius)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Density analysis failed: {str(e)}")


@app.get("/api/analysis/service-overlap")
def service_area_overlap(
    poi_id: int = Query(..., description="Source POI ID"),
    radius: float = Query(1000, ge=100, le=20000, description="Service area radius in meters")
):
    """
    Find all POIs whose service area buffers overlap with the source POI's buffer.
    Returns GeoJSON FeatureCollection of overlapping buffer polygons.
    """
    try:
        return get_service_area_overlap(poi_id=poi_id, radius_meters=radius)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Service area overlap failed: {str(e)}")

@app.get("/api/geocode")
def geocode_address(
    text: str = Query(..., description="Address or place name to geocode")
):
    """
    Geocode an address or place name using OpenRouteService Geocoding API.
    Restricts results to Nepal (country code: NP).
    """
    import urllib.request
    import urllib.parse
    import json
    
    api_key = os.getenv("OPENROUTESERVICE_API_KEY")
    if not api_key:
        api_key = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjhiMTM3MjEyMWY2NjQ3MTFiZGY4M2JmODk0Zjc5MzNkIiwiaCI6Im11cm11cjY0In0="
        
    try:
        encoded_text = urllib.parse.quote(text)
        url = f"https://api.openrouteservice.org/geocode/search?api_key={api_key}&text={encoded_text}&boundary.country=NP&size=5"
        
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Geocoding service error: {str(e)}")

@app.post("/api/analysis/isochrones")
def get_isochrones(
    lon: float = Query(..., description="Longitude of center point"),
    lat: float = Query(..., description="Latitude of center point"),
    profile: str = Query("driving-car", description="Travel profile: driving-car|foot-walking|cycling-regular"),
    range_type: str = Query("time", description="Range type: time|distance"),
    ranges: List[float] = Query(..., description="Ranges list (minutes for time, meters for distance)")
):
    """
    Generate travel time or distance isochrones using the OpenRouteService Isochrones API.
    Converts time input from minutes to seconds as expected by ORS.
    """
    import urllib.request
    import json
    
    api_key = os.getenv("OPENROUTESERVICE_API_KEY")
    if not api_key:
        api_key = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjhiMTM3MjEyMWY2NjQ3MTFiZGY4M2JmODk0Zjc5MzNkIiwiaCI6Im11cm11cjY0In0="
        
    processed_ranges = []
    for r in ranges:
        if range_type == "time":
            processed_ranges.append(int(r * 60))
        else:
            processed_ranges.append(int(r))
            
    url = f"https://api.openrouteservice.org/v2/isochrones/{profile}"
    
    body = {
        "locations": [[lon, lat]],
        "range": processed_ranges,
        "range_type": range_type
    }
    
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json, application/geo+json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            return data
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenRouteService Isochrones failed: {str(e)}")



