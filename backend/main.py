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

from backend.db import get_all_pois, add_poi, get_route, get_pois_within_buffer, delete_poi
from backend.google_routes import GoogleRouteConfigurationError, GoogleRouteError, get_google_route
from backend.gis_analysis import import_shapefile_to_postgis, search_arcgis_tourism_layers
from backend.openrouteservice import (
    OpenRouteServiceConfigurationError,
    OpenRouteServiceError,
    get_openrouteservice_route,
)

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
    name: str = Field(..., example="Coit Tower")
    category: str = Field(..., example="attraction")  # attraction, hotel, restaurant, park
    description: Optional[str] = Field(None, example="Scenic tower in San Francisco")
    rating: Optional[float] = Field(4.5, ge=0.0, le=5.0)
    image_url: Optional[str] = Field(None, example="https://example.com/image.jpg")
    address: Optional[str] = Field(None, example="1 Telegraph Hill Blvd")
    lon: float = Field(..., example=-122.4056)
    lat: float = Field(..., example=37.8024)

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
def get_pois():
    try:
        geojson_data = get_all_pois()
        return geojson_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch POIs: {str(e)}")

@app.post("/api/pois")
def create_poi(poi: POICreate):
    try:
        new_id = add_poi(
            name=poi.name,
            category=poi.category,
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
    distance: float = Query(..., ge=1, le=50000, description="Buffer distance in meters")
):
    try:
        result = get_pois_within_buffer(lon, lat, distance)
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
