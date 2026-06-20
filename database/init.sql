-- Enable PostGIS and pgRouting (already done, but good practice)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- Drop tables if they exist to start fresh
DROP TABLE IF EXISTS pois CASCADE;
DROP TABLE IF EXISTS roads CASCADE;

-- 1. Create Points of Interest table
CREATE TABLE pois (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'attraction', 'hotel', 'restaurant', 'park'
    description TEXT,
    rating NUMERIC(2,1),
    image_url TEXT,
    address VARCHAR(255),
    geom GEOMETRY(Point, 4326)
);

-- Index POIs
CREATE INDEX pois_geom_idx ON pois USING gist(geom);

-- 2. Create Roads table (for routing)
-- source and target are explicit nodes that represent intersection vertices.
CREATE TABLE roads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    source INTEGER,
    target INTEGER,
    cost DOUBLE PRECISION,
    reverse_cost DOUBLE PRECISION,
    geom GEOMETRY(LineString, 4326)
);

-- Index Roads
CREATE INDEX roads_geom_idx ON roads USING gist(geom);

-- 3. Seed Points of Interest (Tourism Spots in San Francisco Downtown)
-- These points will be close to the road network vertices.
INSERT INTO pois (id, name, category, description, rating, image_url, address, geom) VALUES
(1, 'Union Square', 'attraction', 'A vibrant 2.6-acre public plaza in downtown San Francisco, famous for shopping, dining, and theater.', 4.5, 'https://images.unsplash.com/photo-1549346155-752179a32c2a?w=500', '333 Post St, San Francisco, CA 94108', ST_SetSRID(ST_Point(-122.4074, 37.7879), 4326)),
(2, 'Chinatown Gateway', 'attraction', 'The iconic Dragon Gate entrance to San Francisco historic Chinatown district, filled with shops and eateries.', 4.4, 'https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=500', 'Grant Ave & Bush St, San Francisco, CA 94108', ST_SetSRID(ST_Point(-122.4058, 37.7907), 4326)),
(3, 'SFMOMA', 'attraction', 'San Francisco Museum of Modern Art, featuring a vast collection of contemporary art and photography.', 4.6, 'https://images.unsplash.com/photo-1561055657-b9e0bf0fa360?w=500', '151 3rd St, San Francisco, CA 94103', ST_SetSRID(ST_Point(-122.4011, 37.7857), 4326)),
(4, 'Ferry Building', 'attraction', 'A historic food hall and terminal for ferries that cross the San Francisco Bay, featuring local artisan food sellers.', 4.7, 'https://images.unsplash.com/photo-1600683935293-6c846fa673be?w=500', '1 Ferry Building, San Francisco, CA 94111', ST_SetSRID(ST_Point(-122.3937, 37.7955), 4326)),
(5, 'Coit Tower', 'attraction', 'A 210-foot tower in Pioneer Park offering panoramic 360-degree views of the city and bay.', 4.5, 'https://images.unsplash.com/photo-1544013919-e372637e794e?w=500', '1 Telegraph Hill Blvd, San Francisco, CA 94133', ST_SetSRID(ST_Point(-122.4056, 37.8024), 4326)),
(6, 'Lombard Street', 'attraction', 'Known as the crookedest street in the world, featuring eight sharp hairpin turns lined with beautiful flowers.', 4.6, 'https://images.unsplash.com/photo-1533036494709-3221b6d1b827?w=500', 'Lombard St, San Francisco, CA 94133', ST_SetSRID(ST_Point(-122.4193, 37.8021), 4326)),
(7, 'Fisherman Wharf', 'attraction', 'A historic waterfront district home to Pier 39, fresh seafood, sea lions, and museums.', 4.3, 'https://images.unsplash.com/photo-1506012787146-f92b2d7d6d96?w=500', 'Jefferson St, San Francisco, CA 94133', ST_SetSRID(ST_Point(-122.4177, 37.8080), 4326)),
(8, 'The Westin St. Francis', 'hotel', 'Historic luxury hotel located directly on Union Square, offering elegant rooms and historic dining.', 4.4, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=500', '335 Powell St, San Francisco, CA 94102', ST_SetSRID(ST_Point(-122.4082, 37.7877), 4326)),
(9, 'Tadich Grill', 'restaurant', 'The oldest continuously running restaurant in California, serving fresh seafood and classic cocktails.', 4.5, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=500', '240 California St, San Francisco, CA 94111', ST_SetSRID(ST_Point(-122.3998, 37.7934), 4326)),
(10, 'Salesforce Park', 'park', 'A modern, 5.4-acre public park featuring a botanical garden, walking trails, and art installations, built atop the transit center.', 4.8, 'https://images.unsplash.com/photo-1588668214407-6ea9a6d8c272?w=500', '425 Mission St, San Francisco, CA 94105', ST_SetSRID(ST_Point(-122.3970, 37.7895), 4326));

-- Adjust primary key auto-increment starting sequence
SELECT setval('pois_id_seq', (SELECT MAX(id) FROM pois));

-- 4. Seed Connected Road Network (Explicit Topological sources and targets matching the vertices)
-- Nodes mapping:
-- Node 1: Union Square (-122.4074, 37.7879)
-- Node 2: Chinatown Gateway (-122.4058, 37.7907)
-- Node 3: SFMOMA (-122.4011, 37.7857)
-- Node 4: Ferry Building (-122.3937, 37.7955)
-- Node 5: Coit Tower (-122.4056, 37.8024)
-- Node 6: Lombard Street (-122.4193, 37.8021)
-- Node 7: Fisherman's Wharf (-122.4177, 37.8080)
-- Node 8: The Westin St. Francis (-122.4082, 37.7877)
-- Node 9: Tadich Grill (-122.3998, 37.7934)
-- Node 10: Salesforce Park (-122.3970, 37.7895)

INSERT INTO roads (name, source, target, geom) VALUES
('Post Street (Union Square to SFMOMA Area)', 1, 3, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4074 37.7879, -122.4011 37.7857)'), 4326)),
('Grant Ave (Union Square to Chinatown Gateway)', 1, 2, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4074 37.7879, -122.4058 37.7907)'), 4326)),
('Chinatown to Coit Tower Route', 2, 5, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4058 37.7907, -122.4056 37.8024)'), 4326)),
('Coit Tower Hill Descend to Fisherman Wharf', 5, 7, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4056 37.8024, -122.4177 37.8080)'), 4326)),
('Waterfront Link (Ferry Building to Fisherman Wharf)', 4, 7, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.3937 37.7955, -122.4056 37.8024, -122.4177 37.8080)'), 4326)),
('Lombard Street Crooked Section', 7, 6, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4177 37.8080, -122.4193 37.8021)'), 4326)),
('Lombard St to Union Square Connector', 6, 1, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4193 37.8021, -122.4074 37.7879)'), 4326)),
('Downtown Link (SFMOMA to Ferry Building)', 3, 4, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4011 37.7857, -122.3970 37.7895, -122.3937 37.7955)'), 4326)),
('Financial District Link (Ferry Building to Chinatown Gateway)', 4, 2, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.3937 37.7955, -122.3998 37.7934, -122.4058 37.7907)'), 4326)),
('Hotel Union Square Connection', 8, 1, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.4082 37.7877, -122.4074 37.7879)'), 4326)),
('Tadich Grill Connection', 9, 4, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.3998 37.7934, -122.3937 37.7955)'), 4326)),
('Salesforce Park Connection', 10, 3, ST_SetSRID(ST_GeomFromText('LINESTRING(-122.3970 37.7895, -122.4011 37.7857)'), 4326));

-- Update costs to the geodesic length of each road segment in meters (for realistic travel routing)
UPDATE roads SET 
    cost = ST_Length(geom::geography),
    reverse_cost = ST_Length(geom::geography);
