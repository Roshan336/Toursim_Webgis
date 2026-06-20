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

def get_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )

def get_all_pois():
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Fetch POIs as GeoJSON Features
        query = """
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(feature)
            ) AS geojson
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', id,
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', to_jsonb(inputs) - 'geom'
                ) AS feature
                FROM (
                    SELECT id, name, category, description, rating, image_url, address, geom
                    FROM pois
                ) inputs
            ) features;
        """
        cur.execute(query)
        res = cur.fetchone()
        if res and res['geojson']:
            return res['geojson']
        return {"type": "FeatureCollection", "features": []}
    finally:
        cur.close()
        conn.close()

def add_poi(name, category, description, rating, image_url, address, lon, lat):
    conn = get_connection()
    cur = conn.cursor()
    try:
        query = """
            INSERT INTO pois (name, category, description, rating, image_url, address, geom)
            VALUES (%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_Point(%s, %s), 4326))
            RETURNING id;
        """
        cur.execute(query, (name, category, description, rating, image_url, address, lon, lat))
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
