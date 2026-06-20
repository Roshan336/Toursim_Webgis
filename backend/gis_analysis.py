import os
import zipfile
import tempfile
import shutil
from arcgis.gis import GIS
from arcgis.features import GeoAccessor
from backend.db import get_connection
from dotenv import load_dotenv

load_dotenv()

ARCGIS_USERNAME = os.getenv("ARCGIS_USERNAME")
ARCGIS_PASSWORD = os.getenv("ARCGIS_PASSWORD")
ARCGIS_API_KEY = os.getenv("ARCGIS_API_KEY")

def get_arcgis_gis_connection():
    """
    Connect to the ArcGIS Online platform using credentials.
    """
    if ARCGIS_USERNAME and ARCGIS_PASSWORD:
        try:
            return GIS("https://www.arcgis.com", username=ARCGIS_USERNAME, password=ARCGIS_PASSWORD)
        except Exception as e:
            print(f"ArcGIS Login failed, falling back to anonymous or API key: {e}")
    
    if ARCGIS_API_KEY:
        return GIS(api_key=ARCGIS_API_KEY)
    
    return GIS()

def search_arcgis_tourism_layers(query="tourism San Francisco", max_results=5):
    """
    Search ArcGIS Online for spatial datasets matching the query.
    """
    try:
        gis = get_arcgis_gis_connection()
        items = gis.content.search(query=query, item_type="Feature Service", max_items=max_results)
        
        results = []
        for item in items:
            results.append({
                "id": item.id,
                "title": item.title,
                "url": item.url,
                "owner": item.owner,
                "tags": item.tags,
                "snippet": item.snippet or ""
            })
        return results
    except Exception as e:
        return {"error": f"Failed to query ArcGIS Platform: {str(e)}"}

def import_shapefile_to_postgis(zip_path: str, table_name: str):
    """
    Extract a shapefile ZIP, load it using ArcGIS Python SDK Spatially Enabled DataFrame,
    and import the geometry and attributes into PostgreSQL/PostGIS.
    """
    temp_dir = tempfile.mkdtemp()
    try:
        # Extract the shapefile ZIP file
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        # Search for the .shp file inside extracted files
        shp_file = None
        for root, dirs, files in os.walk(temp_dir):
            for file in files:
                if file.endswith('.shp'):
                    shp_file = os.path.join(root, file)
                    break
            if shp_file:
                break
        
        if not shp_file:
            raise FileNotFoundError("Could not find a .shp file in the uploaded zip.")
        
        # Read the shapefile into an ArcGIS Spatially Enabled DataFrame (SEDF)
        sdf = GeoAccessor.from_featureclass(shp_file)
        
        # Get shapefile geometry type
        geom_type = sdf.spatial.geometry_type
        
        # Ensure geom_type is a string (e.g. if list, take first element)
        g_type = geom_type
        if isinstance(g_type, list) and len(g_type) > 0:
            g_type = g_type[0]
        elif hasattr(g_type, 'iloc') or isinstance(g_type, (set, tuple)):
            g_type = list(g_type)[0] if len(g_type) > 0 else "Geometry"
            
        g_type = str(g_type).strip().lower()
        
        # Map shapefile geometry types to PostGIS geometry types
        # ESRI's geometry type mapping: Point, Polyline, Polygon, MultiPoint
        postgis_geom_type = "GEOMETRY(Geometry, 4326)"
        if "point" in g_type:
            postgis_geom_type = "GEOMETRY(Point, 4326)"
        elif "polyline" in g_type or "linestring" in g_type:
            postgis_geom_type = "GEOMETRY(LineString, 4326)"
        elif "polygon" in g_type:
            postgis_geom_type = "GEOMETRY(Polygon, 4326)"
        elif "multipoint" in g_type:
            postgis_geom_type = "GEOMETRY(MultiPoint, 4326)"
            
        # Filter columns to import: exclude shape/geometry & default auto-generated IDs
        excluded_cols = ['SHAPE', 'geometry', 'id', 'objectid', 'fid', 'index']
        columns = [col for col in sdf.columns if col.lower() not in excluded_cols]
        
        # Connect to Postgres
        conn = get_connection()
        cur = conn.cursor()
        
        # Prepare table creation SQL
        col_defs = []
        for col in columns:
            # Sanitize column names for SQL safety
            sanitized_col = col.lower().strip().replace(' ', '_').replace('-', '_')
            col_defs.append(f"{sanitized_col} TEXT")
            
        col_defs_str = ", ".join(col_defs)
        
        # Create table in PostGIS
        # Check if table name is alphanumeric or clean
        sanitized_table = "".join(c for c in table_name if c.isalnum() or c == '_').lower()
        
        cur.execute(f"DROP TABLE IF EXISTS {sanitized_table} CASCADE;")
        create_sql = f"""
            CREATE TABLE {sanitized_table} (
                id SERIAL PRIMARY KEY,
                geom {postgis_geom_type},
                {col_defs_str}
            );
        """
        cur.execute(create_sql)
        conn.commit()
        
        # Insert rows
        insert_cols = ["geom"] + [col.lower().strip().replace(' ', '_').replace('-', '_') for col in columns]
        placeholders = ["ST_GeomFromText(%s, 4326)"] + ["%s"] * len(columns)
        
        insert_sql = f"""
            INSERT INTO {sanitized_table} ({", ".join(insert_cols)})
            VALUES ({", ".join(placeholders)});
        """
        
        count = 0
        for idx, row in sdf.iterrows():
            geom = row['SHAPE']
            # Get geometry WKT (Well-Known Text)
            wkt = None
            if hasattr(geom, 'wkt'):
                wkt = geom.wkt
            elif hasattr(geom, 'as_shapely'):
                wkt = geom.as_shapely.wkt
            elif hasattr(geom, 'centroid'):
                # fallback to point centroid if polygon/line doesn't export wkt directly
                wkt = f"POINT({geom.centroid[0]} {geom.centroid[1]})"
            
            if not wkt:
                continue
                
            vals = [wkt]
            for col in columns:
                val = row[col]
                vals.append(str(val) if val is not None else None)
                
            cur.execute(insert_sql, tuple(vals))
            count += 1
            
        conn.commit()
        
        return {
            "status": "success",
            "message": f"Successfully imported shapefile into table '{sanitized_table}'",
            "table_name": sanitized_table,
            "geometry_type": geom_type,
            "features_imported": count
        }
        
    except Exception as e:
        if 'conn' in locals() and conn:
            conn.rollback()
        raise e
    finally:
        if 'cur' in locals() and cur:
            cur.close()
        if 'conn' in locals() and conn:
            conn.close()
        shutil.rmtree(temp_dir)
