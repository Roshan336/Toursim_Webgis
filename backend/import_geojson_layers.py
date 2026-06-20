import os
import json
import psycopg2
from shapely.geometry import shape
from shapely.ops import orient
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

layers_to_import = [
    {
        "name": "province_layer",
        "file": "../data/Province.geojson",
        "name_field": "Province"
    },
    {
        "name": "district_layer",
        "file": "../data/Districts.geojson",
        "name_field": "DISTRICT"
    },
    {
        "name": "gapanapa_layer",
        "file": "../data/GapaNapa.geojson",
        "name_field": "GaPa_NaPa"
    }
]

def import_geojson(layer):
    table_name = layer["name"]
    file_path = layer["file"]
    name_field = layer["name_field"]
    
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return
        
    print(f"Reading {file_path}...")
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    features = data.get("features", [])
    print(f"Loaded {len(features)} features for {table_name}.")
    
    conn = get_connection()
    cur = conn.cursor()
    
    try:
        # Create table
        cur.execute(f"DROP TABLE IF EXISTS {table_name} CASCADE;")
        cur.execute(f"""
            CREATE TABLE {table_name} (
                id SERIAL PRIMARY KEY,
                name VARCHAR(150),
                properties JSONB,
                geom GEOMETRY(Geometry, 4326)
            );
        """)
        conn.commit()
        
        # Insert features
        insert_query = f"""
            INSERT INTO {table_name} (name, properties, geom)
            VALUES (%s, %s, ST_GeomFromText(%s, 4326));
        """
        
        print(f"Inserting into {table_name}...")
        for i, feat in enumerate(features):
            props = feat.get("properties", {})
            name_val = props.get(name_field)
            if not name_val:
                # Try case insensitive fallback
                for k, v in props.items():
                    if k.lower() == name_field.lower():
                        name_val = v
                        break
            
            # Fallback if still None
            if not name_val:
                name_val = f"Unknown_{i}"
                
            geom_dict = feat.get("geometry")
            if not geom_dict:
                continue
                
            # Use shapely to validate and convert to WKT
            try:
                geom_shape = shape(geom_dict)
                if not geom_shape.is_valid:
                    geom_shape = geom_shape.buffer(0) # fix invalid geometries
                wkt = geom_shape.wkt
            except Exception as e:
                print(f"Failed to parse geometry for feature {i}: {e}")
                continue
                
            cur.execute(insert_query, (str(name_val), json.dumps(props), wkt))
            
            if (i + 1) % 100 == 0:
                print(f"  Inserted {i + 1} features...")
                
        # Create spatial index and name index
        print(f"Creating indexes on {table_name}...")
        cur.execute(f"CREATE INDEX {table_name}_geom_idx ON {table_name} USING gist(geom);")
        cur.execute(f"CREATE INDEX {table_name}_name_idx ON {table_name} (name);")
        conn.commit()
        print(f"Successfully imported {table_name}.")
        
    except Exception as e:
        conn.rollback()
        print(f"Error importing {table_name}: {e}")
        raise e
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    for layer in layers_to_import:
        import_geojson(layer)
    print("All layers imported successfully!")
