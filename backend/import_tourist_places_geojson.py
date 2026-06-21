import json
import os
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values, Json
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "web_gis")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "12345678")

VALID_CATEGORIES = {
    "heritage",
    "temple",
    "attraction",
    "hotel",
    "restaurant",
    "park",
    "adventure",
    "shopping",
}

TOURIST_SHOP_TYPES = {
    "antiques",
    "art",
    "bag",
    "books",
    "boutique",
    "carpet",
    "craft",
    "department_store",
    "gift",
    "jewelry",
    "mall",
    "music",
    "musical_instrument",
    "outdoor",
    "spices",
    "sports",
    "tea",
    "watches",
}

GEOJSON_PATH = Path(__file__).resolve().parent.parent / "data" / "kathmandu_valley_all_tourist_places.geojson"
BATCH_SIZE = 1000


def get_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
    )


def normalize_text(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def normalize_rating(value):
    if value is None or value == "":
        return None
    try:
        rating = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(5.0, rating))


def source_id_from_properties(props):
    raw_id = normalize_text(props.get("id"))
    if raw_id:
        return raw_id
    osm_id = props.get("osm_id")
    if osm_id is not None:
        return f"osm_{osm_id}"
    return None


def is_tourist_shopping(props):
    tags = props.get("tags") or {}
    shop_type = normalize_text(tags.get("shop"))
    amenity = normalize_text(tags.get("amenity"))
    return shop_type in TOURIST_SHOP_TYPES or amenity == "marketplace"


def rows_from_geojson(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    skipped = 0

    for index, feature in enumerate(data.get("features", []), start=1):
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or []
        props = feature.get("properties") or {}

        if geometry.get("type") != "Point" or len(coords) < 2:
            skipped += 1
            continue

        lon, lat = coords[0], coords[1]
        category = normalize_text(props.get("category")) or "attraction"
        if category not in VALID_CATEGORIES:
            category = "attraction"
        if category == "shopping" and not is_tourist_shopping(props):
            skipped += 1
            continue

        name = normalize_text(props.get("name")) or f"Tourism Spot {index}"
        source = normalize_text(props.get("source")) or "geojson"
        source_id = source_id_from_properties(props) or f"{source}_{index}_{lon}_{lat}"

        rows.append(
            (
                name,
                category,
                normalize_text(props.get("district")),
                normalize_text(props.get("description")),
                normalize_rating(props.get("rating")),
                normalize_text(props.get("image_url")),
                normalize_text(props.get("address")),
                lon,
                lat,
                source,
                source_id,
                normalize_text(props.get("website")),
                Json(props.get("tags") or {}),
            )
        )

    return rows, skipped


def prepare_pois_table(cur):
    cur.execute("ALTER TABLE pois ADD COLUMN IF NOT EXISTS source VARCHAR(50);")
    cur.execute("ALTER TABLE pois ADD COLUMN IF NOT EXISTS source_id VARCHAR(120);")
    cur.execute("ALTER TABLE pois ADD COLUMN IF NOT EXISTS website TEXT;")
    cur.execute("ALTER TABLE pois ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '{}'::jsonb;")
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS pois_source_source_id_idx
        ON pois (source, source_id);
        """
    )


def import_tourist_places():
    rows, skipped = rows_from_geojson(GEOJSON_PATH)
    if not rows:
        return {"inserted_or_updated": 0, "skipped": skipped}

    conn = get_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                prepare_pois_table(cur)
                sql = """
                    INSERT INTO pois (
                        name, category, district, description, rating, image_url, address,
                        geom, source, source_id, website, tags
                    )
                    VALUES %s
                    ON CONFLICT (source, source_id) DO UPDATE SET
                        name = EXCLUDED.name,
                        category = EXCLUDED.category,
                        district = EXCLUDED.district,
                        description = EXCLUDED.description,
                        rating = EXCLUDED.rating,
                        image_url = EXCLUDED.image_url,
                        address = EXCLUDED.address,
                        geom = EXCLUDED.geom,
                        website = EXCLUDED.website,
                        tags = EXCLUDED.tags;
                """
                template = """
                    (
                        %s, %s, %s, %s, %s, %s, %s,
                        ST_SetSRID(ST_Point(%s, %s), 4326),
                        %s, %s, %s, %s
                    )
                """
                for start in range(0, len(rows), BATCH_SIZE):
                    batch = rows[start : start + BATCH_SIZE]
                    execute_values(cur, sql, batch, template=template, page_size=BATCH_SIZE)

                imported_shopping_ids = [
                    source_id for row in rows if row[1] == "shopping" for source_id in [row[10]]
                ]
                cur.execute(
                    """
                    DELETE FROM pois
                    WHERE category = 'shopping'
                      AND source = 'openstreetmap'
                      AND NOT (source_id = ANY(%s));
                    """,
                    (imported_shopping_ids,),
                )
                removed_shopping = cur.rowcount

                cur.execute("SELECT COUNT(*) FROM pois;")
                total_pois = cur.fetchone()[0]

        return {
            "inserted_or_updated": len(rows),
            "skipped": skipped,
            "removed_non_tourist_shopping": removed_shopping,
            "total_pois": total_pois,
        }
    finally:
        conn.close()


if __name__ == "__main__":
    stats = import_tourist_places()
    print(json.dumps(stats, indent=2))
