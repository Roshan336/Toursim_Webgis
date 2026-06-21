import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "web_gis")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "12345678")

POINT_LAYERS = ("pois", "osm_pois")
ALL_LAYERS = ("province_layer", "district_layer", "gapanapa_layer", "pois", "osm_pois")

def get_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

def get_all_pois(district: str | None = None):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Fetch POIs as GeoJSON Features with optional district filter
        where_clause = "WHERE district = %(district)s" if district else ""
        query = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            ) AS geojson
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', id,
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', to_jsonb(inputs) - 'geom'
                ) AS feature
                FROM (
                    SELECT id, name, category, district, description, rating, image_url, address, geom
                    FROM pois
                    {where_clause}
                    ORDER BY category, name
                ) inputs
            ) features;
        """
        params = {"district": district} if district else {}
        cur.execute(query, params)
        res = cur.fetchone()
        if res and res['geojson']:
            return res['geojson']
        return {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()

def add_poi(name, category, description, rating, image_url, address, lon, lat, district=None):
    conn = get_connection()
    cur = conn.cursor()
    try:
        query = """
            INSERT INTO pois (name, category, district, description, rating, image_url, address, geom)
            VALUES (%s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_Point(%s, %s), 4326))
            RETURNING id;
        """
        cur.execute(query, (name, category, district, description, rating, image_url, address, lon, lat))
        new_id = cur.fetchone()[0]
        conn.commit()
        return new_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()

def find_nearest_node(lon, lat):
    conn = get_connection()
    cur = conn.cursor()
    try:
        # Find nearest node using KNN operator
        query = """
            WITH vertices AS (
                SELECT source AS id, ST_StartPoint(geom) AS geom FROM roads
                UNION
                SELECT target AS id, ST_EndPoint(geom) AS geom FROM roads
            )
            SELECT id FROM vertices
            ORDER BY geom <-> ST_SetSRID(ST_Point(%s, %s), 4326)
            LIMIT 1;
        """
        cur.execute(query, (lon, lat))
        res = cur.fetchone()
        return res[0] if res else None
    finally:
        cur.close()
        conn.close()

def get_route(start_lon, start_lat, end_lon, end_lat):
    start_node = find_nearest_node(start_lon, start_lat)
    end_node = find_nearest_node(end_lon, end_lat)
    
    if start_node is None or end_node is None:
        return {"status": "error", "message": "Could not find nearest road nodes."}

    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # If start and end node are the same, path is empty
        if start_node == end_node:
            return {"status": "success", "segments": [], "total_distance_meters": 0.0}

        # Run Dijkstra via pgRouting
        query = """
            SELECT 
                path.seq,
                roads.name,
                roads.cost AS distance_meters,
                ST_AsGeoJSON(roads.geom)::json AS geom
            FROM pgr_dijkstra(
                'SELECT id, source, target, cost, reverse_cost FROM roads',
                %s, %s, false
            ) AS path
            JOIN roads ON path.edge = roads.id
            ORDER BY path.seq;
        """
        cur.execute(query, (start_node, end_node))
        rows = cur.fetchall()
        
        segments = []
        total_distance = 0.0
        
        for r in rows:
            segments.append({
                "seq": r["seq"],
                "name": r["name"] or "Unnamed Road",
                "distance_meters": round(r["distance_meters"], 2),
                "geometry": r["geom"]
            })
            total_distance += r["distance_meters"]
            
        return {
            "status": "success",
            "start_node": start_node,
            "end_node": end_node,
            "total_distance_meters": round(total_distance, 2),
            "segments": segments
        }
    finally:
        cur.close()
        conn.close()

def get_pois_within_buffer(lon, lat, distance_meters):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        query = """
            SELECT id, name, category, description, rating, image_url, address,
                   ST_X(geom) AS lon, ST_Y(geom) AS lat,
                   ST_Distance(geom::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography) AS distance_meters
            FROM pois
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_Point(%s, %s), 4326)::geography, %s)
            ORDER BY distance_meters;
        """
        cur.execute(query, (lon, lat, lon, lat, distance_meters))
        rows = cur.fetchall()
        
        # Build buffer polygon (for visual display on client)
        cur.execute("""
            SELECT ST_AsGeoJSON(ST_Buffer(ST_SetSRID(ST_Point(%s, %s), 4326)::geography, %s)::geometry)::json AS buffer_geom
        """, (lon, lat, distance_meters))
        buffer_geom = cur.fetchone()["buffer_geom"]

        return {
            "buffer_geometry": buffer_geom,
            "pois": [dict(r) for r in rows]
        }
    finally:
        cur.close()
        conn.close()

def delete_poi(poi_id):
    conn = get_connection()
    cur = conn.cursor()
    try:
        query = "DELETE FROM pois WHERE id = %s;"
        cur.execute(query, (poi_id,))
        conn.commit()
        return cur.rowcount > 0
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()

def get_geojson_layer(layer_name: str, name_filter: str = None, simplify_tolerance: float = None):
    # Check that layer_name is valid to prevent SQL injection
    if layer_name not in ALL_LAYERS:
        raise ValueError("Invalid layer name")
        
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        geom_expr = "geom"
        if simplify_tolerance is not None and simplify_tolerance > 0:
            geom_expr = f"ST_SimplifyPreserveTopology(geom, {float(simplify_tolerance)})"
            
        where_clauses = []
        params = {}
        if name_filter:
            where_clauses.append("name ILIKE %(name_filter)s")
            params["name_filter"] = f"%{name_filter}%"
            
        where_str = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        
        if layer_name == "pois":
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
                ) AS geojson
                FROM (
                    SELECT jsonb_build_object(
                        'type', 'Feature',
                        'id', id,
                        'geometry', ST_AsGeoJSON({geom_expr})::jsonb,
                        'properties', to_jsonb(inputs) - 'geom'
                    ) AS feature
                    FROM (
                        SELECT id, name, category, district, description, rating, image_url, address, geom
                        FROM pois
                        {where_str}
                        ORDER BY name
                    ) inputs
                ) features;
            """
        elif layer_name == "osm_pois":
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
                ) AS geojson
                FROM (
                    SELECT jsonb_build_object(
                        'type', 'Feature',
                        'id', id,
                        'geometry', ST_AsGeoJSON({geom_expr})::jsonb,
                        'properties', to_jsonb(inputs) - 'geom'
                    ) AS feature
                    FROM (
                        SELECT id, osm_id, name, category, district, description, address,
                               website, image_url, tags, fetched_at, 'openstreetmap' AS source, geom
                        FROM osm_pois
                        {where_str}
                        ORDER BY category, name
                    ) inputs
                ) features;
            """
        else:
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
                ) AS geojson
                FROM (
                    SELECT jsonb_build_object(
                        'type', 'Feature',
                        'id', id,
                        'geometry', ST_AsGeoJSON({geom_expr})::jsonb,
                        'properties', properties || jsonb_build_object('id', id, 'name', name)
                    ) AS feature
                    FROM (
                        SELECT id, name, properties, geom
                        FROM {layer_name}
                        {where_str}
                        ORDER BY name
                    ) inputs
                ) features;
            """
            
        cur.execute(query, params)
        res = cur.fetchone()
        if res and res['geojson']:
            return res['geojson']
        return {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()

def spatial_filter_query(target_layer: str, source_layer: str, relation: str, source_feature_id: int = None, distance_meters: float = 0.0):
    if target_layer not in ALL_LAYERS:
        raise ValueError("Invalid target layer")
    if source_layer not in ALL_LAYERS:
        raise ValueError("Invalid source layer")
        
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Build relation condition
        if relation == "intersects":
            spatial_cond = "ST_Intersects(row.geom, s.geom)"
        elif relation == "contains":
            spatial_cond = "ST_Contains(row.geom, s.geom)"
        elif relation == "within":
            spatial_cond = "ST_Within(row.geom, s.geom)"
        elif relation == "touches":
            spatial_cond = "ST_Touches(row.geom, s.geom)"
        elif relation == "within_distance":
            spatial_cond = "ST_DWithin(row.geom::geography, s.geom::geography, %(distance)s)"
        else:
            raise ValueError("Invalid spatial relationship")
            
        # Target properties expression
        if target_layer == "pois":
            target_sub = "SELECT id, name, category, district, description, rating, image_url, address, geom FROM pois"
            prop_expr = "to_jsonb(row) - 'geom'"
        elif target_layer == "osm_pois":
            target_sub = """
                SELECT id, osm_id, name, category, district, description, address,
                       website, image_url, tags, fetched_at, geom
                FROM osm_pois
            """
            prop_expr = "to_jsonb(row) - 'geom'"
        else:
            target_sub = f"SELECT id, name, properties, geom FROM {target_layer}"
            prop_expr = "row.properties || jsonb_build_object('id', row.id, 'name', row.name)"
            
        # Optional source feature filter
        source_where = ""
        params = {"distance": distance_meters}
        if source_feature_id:
            source_where = "WHERE s.id = %(source_feature_id)s"
            params["source_feature_id"] = source_feature_id
            
        query = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            ) AS geojson
            FROM (
                SELECT DISTINCT ON (row.id) jsonb_build_object(
                    'type', 'Feature',
                    'id', row.id,
                    'geometry', ST_AsGeoJSON(row.geom)::jsonb,
                    'properties', {prop_expr}
                ) AS feature
                FROM ({target_sub}) row
                INNER JOIN {source_layer} s ON {spatial_cond}
                {source_where}
                ORDER BY row.id, row.name
            ) features;
        """
        cur.execute(query, params)
        res = cur.fetchone()
        if res and res['geojson']:
            return res['geojson']
        return {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()

def identify_by_location(lon: float, lat: float):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        results = {}
        layers = ["province_layer", "district_layer", "gapanapa_layer"]
        for layer in layers:
            query = f"""
                SELECT id, name, properties, ST_AsGeoJSON(geom)::json AS geom
                FROM {layer}
                WHERE ST_Contains(geom, ST_SetSRID(ST_Point(%s, %s), 4326))
                LIMIT 1;
            """
            cur.execute(query, (lon, lat))
            row = cur.fetchone()
            if row:
                results[layer] = {
                    "id": row["id"],
                    "name": row["name"],
                    "properties": row["properties"],
                    "geometry": row["geom"]
                }
            else:
                results[layer] = None
        return results
    finally:
        cur.close()
        conn.close()

def search_by_attribute(layer_name: str, property_key: str, operator: str, value: str):
    if layer_name not in ALL_LAYERS:
        raise ValueError("Invalid layer name")
        
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        valid_operators = {
            "equals": "=",
            "contains": "ILIKE",
            "starts_with": "ILIKE",
            "ends_with": "ILIKE",
            "greater_than": ">",
            "less_than": "<"
        }
        if operator not in valid_operators:
            raise ValueError("Invalid operator")
            
        sql_op = valid_operators[operator]
        
        if layer_name == "pois":
            valid_cols = ["id", "name", "category", "district", "description", "rating", "image_url", "address"]
            col_name = property_key.lower().strip()
            if col_name not in valid_cols:
                col_name = "name"

            if operator == "contains":
                where_clause = f"{col_name} ILIKE %(value)s"
                val_param = f"%{value}%"
            elif operator == "starts_with":
                where_clause = f"{col_name} ILIKE %(value)s"
                val_param = f"{value}%"
            elif operator == "ends_with":
                where_clause = f"{col_name} ILIKE %(value)s"
                val_param = f"%{value}"
            else:
                where_clause = f"{col_name} {sql_op} %(value)s"
                val_param = value
        elif layer_name == "osm_pois":
            valid_cols = ["id", "osm_id", "name", "category", "district", "description", "address", "website"]
            col_name = property_key.lower().strip()
            if col_name not in valid_cols:
                col_name = "name"

            if operator == "contains":
                where_clause = f"{col_name}::text ILIKE %(value)s"
                val_param = f"%{value}%"
            elif operator == "starts_with":
                where_clause = f"{col_name}::text ILIKE %(value)s"
                val_param = f"{value}%"
            elif operator == "ends_with":
                where_clause = f"{col_name}::text ILIKE %(value)s"
                val_param = f"%{value}"
            else:
                where_clause = f"{col_name}::text {sql_op} %(value)s"
                val_param = value
        else:
            if operator in ("greater_than", "less_than"):
                where_clause = f"CAST(NULLIF(properties->>%(key)s, '') AS numeric) {sql_op} CAST(%(value)s AS numeric)"
                val_param = value
            elif operator == "contains":
                where_clause = "properties->>%(key)s ILIKE %(value)s"
                val_param = f"%{value}%"
            elif operator == "starts_with":
                where_clause = "properties->>%(key)s ILIKE %(value)s"
                val_param = f"{value}%"
            elif operator == "ends_with":
                where_clause = "properties->>%(key)s ILIKE %(value)s"
                val_param = f"%{value}"
            else:
                where_clause = "properties->>%(key)s = %(value)s"
                val_param = value
                
        if layer_name == "pois":
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
                ) AS geojson
                FROM (
                    SELECT jsonb_build_object(
                        'type', 'Feature',
                        'id', id,
                        'geometry', ST_AsGeoJSON(geom)::jsonb,
                        'properties', to_jsonb(inputs) - 'geom'
                    ) AS feature
                    FROM (
                        SELECT id, name, category, district, description, rating, image_url, address, geom
                        FROM pois
                        WHERE {where_clause}
                        ORDER BY name
                    ) inputs
                ) features;
            """
        elif layer_name == "osm_pois":
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
                ) AS geojson
                FROM (
                    SELECT jsonb_build_object(
                        'type', 'Feature',
                        'id', id,
                        'geometry', ST_AsGeoJSON(geom)::jsonb,
                        'properties', to_jsonb(inputs) - 'geom'
                    ) AS feature
                    FROM (
                        SELECT id, osm_id, name, category, district, description, address,
                               website, image_url, tags, fetched_at, geom
                        FROM osm_pois
                        WHERE {where_clause}
                        ORDER BY category, name
                    ) inputs
                ) features;
            """
        else:
            query = f"""
                SELECT jsonb_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
                ) AS geojson
                FROM (
                    SELECT jsonb_build_object(
                        'type', 'Feature',
                        'id', id,
                        'geometry', ST_AsGeoJSON(geom)::jsonb,
                        'properties', properties || jsonb_build_object('id', id, 'name', name)
                    ) AS feature
                    FROM (
                        SELECT id, name, properties, geom
                        FROM {layer_name}
                        WHERE {where_clause}
                        ORDER BY name
                    ) inputs
                ) features;
            """
            
        params = {"value": val_param, "key": property_key}
        cur.execute(query, params)
        res = cur.fetchone()
        if res and res['geojson']:
            return res['geojson']
        return {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()


# ═══════════════════════════════════════════════════════════════════════
# Category & Recommendation Functions
# ═══════════════════════════════════════════════════════════════════════

def get_poi_categories():
    """Return all 8 tourism categories with metadata."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT code, label, color_hex, icon, description
            FROM poi_categories
            ORDER BY id;
        """)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_category_stats():
    """Return per-category POI counts and rating stats from the materialized view."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("SELECT * FROM poi_category_stats;")
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def get_recommendations(poi_id: int, limit: int = 5):
    """
    Return recommended POIs using two strategies:
    1. Pre-computed table entries (highest priority, ordered by score)
    2. PostGIS nearest-neighbor fallback (same category, ordered by distance)
    """
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Fetch source POI
        cur.execute("""
            SELECT id, name, category, district,
                   ST_X(geom) AS lon, ST_Y(geom) AS lat
            FROM pois WHERE id = %s;
        """, (poi_id,))
        source = cur.fetchone()
        if not source:
            return {"source": None, "recommendations": []}

        # 1. Pre-computed recommendations
        cur.execute("""
            SELECT
                p.id, p.name, p.category, p.district,
                p.description, p.rating, p.image_url, p.address,
                ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
                ROUND(ST_Distance(p.geom::geography,
                    ST_SetSRID(ST_Point(%s, %s), 4326)::geography)::numeric, 1) AS distance_m,
                r.reason,
                r.score AS rec_score
            FROM poi_recommendations r
            JOIN pois p ON p.id = r.recommended_poi_id
            WHERE r.poi_id = %s
            ORDER BY r.score DESC
            LIMIT %s;
        """, (source['lon'], source['lat'], poi_id, limit))
        precomputed = [dict(r) for r in cur.fetchall()]
        seen_ids = {poi_id} | {r['id'] for r in precomputed}

        # 2. Nearest-neighbor fallback (same category)
        remaining = limit - len(precomputed)
        spatial_recs = []
        if remaining > 0:
            placeholders = ','.join(['%s'] * len(seen_ids))
            cur.execute(f"""
                SELECT
                    id, name, category, district,
                    description, rating, image_url, address,
                    ST_X(geom) AS lon, ST_Y(geom) AS lat,
                    ROUND(ST_Distance(geom::geography,
                        ST_SetSRID(ST_Point(%s, %s), 4326)::geography)::numeric, 1) AS distance_m,
                    'Nearby place in same category' AS reason,
                    ROUND(rating::numeric, 1) AS rec_score
                FROM pois
                WHERE category = %s
                  AND id NOT IN ({placeholders})
                ORDER BY geom <-> ST_SetSRID(ST_Point(%s, %s), 4326)
                LIMIT %s;
            """, (source['lon'], source['lat'],
                  source['category'],
                  *list(seen_ids),
                  source['lon'], source['lat'],
                  remaining))
            spatial_recs = [dict(r) for r in cur.fetchall()]

        return {
            "source": {
                "id": source['id'],
                "name": source['name'],
                "category": source['category'],
                "district": source['district']
            },
            "recommendations": (precomputed + spatial_recs)[:limit]
        }
    finally:
        cur.close()
        conn.close()


# ═══════════════════════════════════════════════════════════════════════
# PostGIS Spatial Analysis Functions
# ═══════════════════════════════════════════════════════════════════════

def run_cluster_analysis(radius_meters: float = 500, min_points: int = 2):
    """
    PostGIS ST_ClusterDBSCAN — clusters nearby POIs using DBSCAN algorithm.
    Returns each POI with its cluster_id (NULL = noise point).
    """
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT
                id, name, category, district, rating,
                ST_X(geom) AS lon, ST_Y(geom) AS lat,
                ST_ClusterDBSCAN(geom, eps := %s::float / 111320, minpoints := %s)
                    OVER () AS cluster_id
            FROM pois
            ORDER BY cluster_id NULLS LAST, name;
        """, (radius_meters, min_points))
        rows = cur.fetchall()
        cluster_ids = set(r['cluster_id'] for r in rows if r['cluster_id'] is not None)
        return {
            "radius_meters": radius_meters,
            "min_points": min_points,
            "total_points": len(rows),
            "cluster_count": len(cluster_ids),
            "pois": [dict(r) for r in rows]
        }
    finally:
        cur.close()
        conn.close()


def get_nearest_facility(lon: float, lat: float, category: str = None, limit: int = 5):
    """
    Find the N nearest POIs to a given point, optionally filtered by category.
    """
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if category and category != "all":
            cur.execute(f"""
                SELECT
                    id, name, category, district, rating, image_url, address,
                    ST_X(geom) AS lon, ST_Y(geom) AS lat,
                    ROUND(ST_Distance(geom::geography,
                        ST_SetSRID(ST_Point(%s, %s), 4326)::geography)::numeric, 1) AS distance_m
                FROM pois
                WHERE category = %s
                ORDER BY geom <-> ST_SetSRID(ST_Point(%s, %s), 4326)
                LIMIT {int(limit)};
            """, (lon, lat, category, lon, lat))
        else:
            cur.execute(f"""
                SELECT
                    id, name, category, district, rating, image_url, address,
                    ST_X(geom) AS lon, ST_Y(geom) AS lat,
                    ROUND(ST_Distance(geom::geography,
                        ST_SetSRID(ST_Point(%s, %s), 4326)::geography)::numeric, 1) AS distance_m
                FROM pois
                ORDER BY geom <-> ST_SetSRID(ST_Point(%s, %s), 4326)
                LIMIT {int(limit)};
            """, (lon, lat, lon, lat))
        rows = cur.fetchall()
        return {"center": {"lon": lon, "lat": lat}, "category": category, "results": [dict(r) for r in rows]}
    finally:
        cur.close()
        conn.close()


def get_density_zones(radius_meters: float = 1000):
    """
    Computes POI density by counting how many other POIs fall within a buffer
    of each POI. Returns GeoJSON FeatureCollection of buffer polygons.
    """
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feat), '[]'::jsonb)
            ) AS geojson
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(
                        ST_Buffer(p.geom::geography, %s)::geometry
                    )::jsonb,
                    'properties', jsonb_build_object(
                        'poi_id', p.id,
                        'poi_name', p.name,
                        'category', p.category,
                        'density', (
                            SELECT COUNT(*)
                            FROM pois q
                            WHERE q.id != p.id
                              AND ST_DWithin(q.geom::geography, p.geom::geography, %s)
                        )
                    )
                ) AS feat
                FROM pois p
            ) features;
        """, (radius_meters, radius_meters))
        res = cur.fetchone()
        return res['geojson'] if res and res['geojson'] else {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()


def get_service_area_overlap(poi_id: int, radius_meters: float = 1000):
    """
    Finds all POIs within 2x the radius of a given POI (their service areas overlap).
    Returns those POIs' buffer polygons as GeoJSON.
    """
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat, name, category
            FROM pois WHERE id = %s;
        """, (poi_id,))
        source = cur.fetchone()
        if not source:
            return {"error": "POI not found"}

        cur.execute("""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feat), '[]'::jsonb)
            ) AS geojson
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(
                        ST_Buffer(p.geom::geography, %(r)s)::geometry
                    )::jsonb,
                    'properties', jsonb_build_object(
                        'id', p.id,
                        'name', p.name,
                        'category', p.category,
                        'district', p.district,
                        'distance_m', ROUND(ST_Distance(
                            p.geom::geography,
                            ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326)::geography
                        )::numeric, 1)
                    )
                ) AS feat
                FROM pois p
                WHERE p.id != %(poi_id)s
                  AND ST_DWithin(
                    p.geom::geography,
                    ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326)::geography,
                    %(r)s * 2
                  )
                ORDER BY ST_Distance(
                    p.geom::geography,
                    ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326)::geography
                )
            ) features;
        """, {"r": radius_meters, "lon": source['lon'], "lat": source['lat'], "poi_id": poi_id})
        res = cur.fetchone()
        overlap_geojson = res['geojson'] if res and res['geojson'] else {"type": "FeatureCollection", "features": []}

        return {
            "source_poi": {
                "id": poi_id,
                "name": source['name'],
                "category": source['category'],
                "center": {"lon": source['lon'], "lat": source['lat']}
            },
            "radius_meters": radius_meters,
            "overlapping_buffers": overlap_geojson
        }
    finally:
        cur.close()
        conn.close()


# ═══════════════════════════════════════════════════════════════════════
# OpenStreetMap POI Storage (Overpass → Postgres, by category)
# ═══════════════════════════════════════════════════════════════════════

def ensure_osm_schema():
    """Create osm_pois table on existing databases if missing."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS osm_pois (
                id          SERIAL PRIMARY KEY,
                osm_id      BIGINT UNIQUE NOT NULL,
                name        VARCHAR(150) NOT NULL,
                category    VARCHAR(50)  NOT NULL,
                district    VARCHAR(50),
                description TEXT,
                address     VARCHAR(255),
                website     TEXT,
                image_url   TEXT,
                tags        JSONB DEFAULT '{}'::jsonb,
                fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                geom        GEOMETRY(Point, 4326) NOT NULL
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS osm_pois_geom_idx ON osm_pois USING gist(geom);")
        cur.execute("CREATE INDEX IF NOT EXISTS osm_pois_category_idx ON osm_pois (category);")
        cur.execute("CREATE INDEX IF NOT EXISTS osm_pois_district_idx ON osm_pois (district);")
        conn.commit()
    finally:
        cur.close()
        conn.close()


def upsert_osm_pois(features: list, fetched_at: str | None = None) -> dict:
    """Bulk upsert Overpass GeoJSON features into osm_pois, grouped by category."""
    from datetime import datetime, timezone

    ensure_osm_schema()
    conn = get_connection()
    cur = conn.cursor()
    inserted = 0
    updated = 0
    by_category: dict[str, int] = {}
    sync_time = fetched_at or datetime.now(timezone.utc).isoformat()

    try:
        for feat in features:
            props = feat.get("properties") or {}
            coords = (feat.get("geometry") or {}).get("coordinates") or []
            if len(coords) < 2:
                continue

            osm_id = props.get("osm_id")
            if osm_id is None:
                continue

            category = props.get("category") or "attraction"
            if category not in (
                "heritage", "temple", "attraction", "hotel",
                "restaurant", "park", "adventure", "shopping",
            ):
                category = "attraction"
            lon, lat = float(coords[0]), float(coords[1])
            tags = props.get("tags") or {}

            cur.execute("""
                INSERT INTO osm_pois (
                    osm_id, name, category, district, description, address,
                    website, image_url, tags, fetched_at, geom
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s,
                    ST_SetSRID(ST_Point(%s, %s), 4326)
                )
                ON CONFLICT (osm_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    district = EXCLUDED.district,
                    description = EXCLUDED.description,
                    address = EXCLUDED.address,
                    website = EXCLUDED.website,
                    image_url = EXCLUDED.image_url,
                    tags = EXCLUDED.tags,
                    fetched_at = EXCLUDED.fetched_at,
                    geom = EXCLUDED.geom
                RETURNING (xmax = 0) AS inserted;
            """, (
                int(osm_id),
                props.get("name") or f"OSM {osm_id}",
                category,
                props.get("district"),
                props.get("description"),
                props.get("address"),
                props.get("website"),
                props.get("image_url"),
                json.dumps(tags),
                sync_time,
                lon, lat,
            ))
            row = cur.fetchone()
            if row and row[0]:
                inserted += 1
            else:
                updated += 1
            by_category[category] = by_category.get(category, 0) + 1

        conn.commit()
        return {
            "inserted": inserted,
            "updated": updated,
            "total_processed": len(features),
            "by_category": by_category,
            "fetched_at": sync_time,
        }
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        conn.close()


def get_osm_pois_geojson(district: str | None = None, category: str | None = None):
    ensure_osm_schema()
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        where = []
        params = {}
        if district and district != "all":
            where.append("district = %(district)s")
            params["district"] = district
        if category and category != "all":
            where.append("category = %(category)s")
            params["category"] = category
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        cur.execute(f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            ) AS geojson
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', id,
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', to_jsonb(row) - 'geom'
                ) AS feature
                FROM (
                    SELECT id, osm_id, name, category, district, description, address,
                           website, image_url, tags, fetched_at, 'openstreetmap' AS source, geom
                    FROM osm_pois
                    {where_sql}
                    ORDER BY category, name
                ) row
            ) features;
        """, params)
        res = cur.fetchone()
        if res and res["geojson"]:
            return res["geojson"]
        return {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()


def get_osm_category_stats():
    ensure_osm_schema()
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT category, district, COUNT(*)::int AS poi_count, MAX(fetched_at) AS last_synced
            FROM osm_pois
            GROUP BY category, district
            ORDER BY category, district;
        """)
        return [dict(r) for r in cur.fetchall()]
    finally:
        cur.close()
        conn.close()


def _fetch_point_layer_candidates(cur, table: str, lon: float, lat: float, exclude_ids: list[int], limit: int = 25):
    data_source = table
    rating_col = ", rating" if table == "pois" else ", NULL::numeric AS rating"
    extra_cols = "" if table == "pois" else ", tags"
    exclude_clause = "AND id != ALL(%(exclude)s)" if exclude_ids else ""
    params = {"lon": lon, "lat": lat, "exclude": exclude_ids or [-1], "limit": limit}
    cur.execute(f"""
        SELECT id, name, category, district, description, image_url, address
               {rating_col} {extra_cols},
               ST_X(geom) AS lon, ST_Y(geom) AS lat,
               '{data_source}' AS data_source,
               ROUND(ST_Distance(
                   geom::geography,
                   ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326)::geography
               )::numeric, 1) AS distance_m
        FROM {table}
        WHERE TRUE {exclude_clause}
        ORDER BY geom <-> ST_SetSRID(ST_Point(%(lon)s, %(lat)s), 4326)
        LIMIT %(limit)s;
    """, params)
    return [dict(r) for r in cur.fetchall()]


def _fetch_admin_area_candidates(cur, admin_layer: str, feature_ids: list[int], search_value: str | None, limit: int = 30):
    if admin_layer not in ("province_layer", "district_layer", "gapanapa_layer"):
        return []
    pattern = f"%{search_value}%" if search_value else None
    candidates = []
    for table in ("pois", "osm_pois"):
        rating_col = ", p.rating" if table == "pois" else ", NULL::numeric AS rating"
        tags_col = "" if table == "pois" else ", p.tags"
        text_filter = ""
        params = {"ids": feature_ids, "limit": limit}
        if pattern:
            text_filter = "AND (p.name ILIKE %(pattern)s OR p.description ILIKE %(pattern)s OR p.category ILIKE %(pattern)s)"
            params["pattern"] = pattern
        cur.execute(f"""
            SELECT p.id, p.name, p.category, p.district, p.description, p.image_url, p.address
                   {rating_col} {tags_col},
                   ST_X(p.geom) AS lon, ST_Y(p.geom) AS lat,
                   '{table}' AS data_source,
                   ROUND(ST_Distance(
                       p.geom::geography,
                       (SELECT ST_Centroid(ST_Collect(a.geom))::geography FROM {admin_layer} a WHERE a.id = ANY(%(ids)s))
                   )::numeric, 1) AS distance_m
            FROM {table} p
            WHERE EXISTS (
                SELECT 1 FROM {admin_layer} a
                WHERE a.id = ANY(%(ids)s) AND ST_Intersects(p.geom, a.geom)
            )
            {text_filter}
            ORDER BY distance_m NULLS LAST, p.name
            LIMIT %(limit)s;
        """, params)
        candidates.extend(dict(r) for r in cur.fetchall())
    return candidates


def get_search_recommendations(
    layer_name: str,
    search_type: str,
    search_key: str | None,
    search_value: str | None,
    feature_ids: list[int] | None,
    limit: int = 5,
):
    """AI-style recommendations based on a layer search context."""
    from backend.ai_recommendations import rank_recommendations, maybe_enrich_with_openai

    if layer_name not in ALL_LAYERS:
        raise ValueError("Invalid layer name")

    ensure_osm_schema()
    feature_ids = feature_ids or []
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        source_categories: set[str] = set()
        center_lon = center_lat = None
        candidates: list[dict] = []

        if feature_ids and layer_name in POINT_LAYERS:
            cur.execute(f"""
                SELECT category, ST_X(geom) AS lon, ST_Y(geom) AS lat
                FROM {layer_name} WHERE id = ANY(%(ids)s);
            """, {"ids": feature_ids})
            rows = cur.fetchall()
            for row in rows:
                if row.get("category"):
                    source_categories.add(row["category"])
            if rows:
                center_lon = sum(r["lon"] for r in rows) / len(rows)
                center_lat = sum(r["lat"] for r in rows) / len(rows)

        if feature_ids and layer_name in ("province_layer", "district_layer", "gapanapa_layer"):
            candidates.extend(_fetch_admin_area_candidates(cur, layer_name, feature_ids, search_value, limit * 4))
        elif center_lon is not None and center_lat is not None:
            exclude_pois = feature_ids if layer_name == "pois" else []
            exclude_osm = feature_ids if layer_name == "osm_pois" else []
            candidates.extend(_fetch_point_layer_candidates(cur, "pois", center_lon, center_lat, exclude_pois, limit * 3))
            candidates.extend(_fetch_point_layer_candidates(cur, "osm_pois", center_lon, center_lat, exclude_osm, limit * 3))
        elif search_value:
            pattern = f"%{search_value}%"
            cur.execute("""
                SELECT id, name, category, district, description, rating, image_url, address,
                       ST_X(geom) AS lon, ST_Y(geom) AS lat, 'pois' AS data_source,
                       NULL::numeric AS distance_m, NULL::jsonb AS tags
                FROM pois
                WHERE name ILIKE %(p)s OR description ILIKE %(p)s OR category ILIKE %(p)s OR address ILIKE %(p)s
                UNION ALL
                SELECT id, name, category, district, description, NULL AS rating, image_url, address,
                       ST_X(geom) AS lon, ST_Y(geom) AS lat, 'osm_pois' AS data_source,
                       NULL::numeric AS distance_m, tags
                FROM osm_pois
                WHERE name ILIKE %(p)s OR description ILIKE %(p)s OR category ILIKE %(p)s OR address ILIKE %(p)s
                LIMIT 40;
            """, {"p": pattern})
            candidates.extend(dict(r) for r in cur.fetchall())

        ranked = rank_recommendations(
            candidates,
            search_value=search_value,
            source_categories=source_categories,
            limit=limit,
        )
        context = {
            "layer": layer_name,
            "search_type": search_type,
            "search_key": search_key,
            "search_value": search_value,
            "result_count": len(feature_ids),
        }
        ranked = maybe_enrich_with_openai(ranked, context)
        return {"search_context": context, "recommendations": ranked}
    finally:
        cur.close()
        conn.close()
