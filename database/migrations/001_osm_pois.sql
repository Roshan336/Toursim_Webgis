-- Migration: add osm_pois table for stored OpenStreetMap tourism data
-- Run against an existing TourGIS database: psql -d web_gis -f database/migrations/001_osm_pois.sql

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'osm_pois_category_fk'
    ) THEN
        ALTER TABLE osm_pois
            ADD CONSTRAINT osm_pois_category_fk
            FOREIGN KEY (category) REFERENCES poi_categories(code);
    END IF;
EXCEPTION WHEN others THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS osm_pois_geom_idx ON osm_pois USING gist(geom);
CREATE INDEX IF NOT EXISTS osm_pois_category_idx ON osm_pois (category);
CREATE INDEX IF NOT EXISTS osm_pois_district_idx ON osm_pois (district);
CREATE INDEX IF NOT EXISTS osm_pois_tags_idx ON osm_pois USING gin(tags);

CREATE OR REPLACE VIEW osm_category_stats AS
SELECT
    category,
    district,
    COUNT(*)::int AS poi_count,
    MAX(fetched_at) AS last_synced
FROM osm_pois
GROUP BY category, district
ORDER BY category, district;
