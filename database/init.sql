-- ═══════════════════════════════════════════════════════════════════
-- TourGIS — Kathmandu Valley Tourism Database
-- Districts: Kathmandu | Lalitpur (Patan) | Bhaktapur
-- Data: Real UNESCO Heritage Sites, Temples, Hotels, Restaurants, Parks,
--       Adventure Spots, Shopping Markets, Attractions
-- ═══════════════════════════════════════════════════════════════════

-- Enable PostGIS and pgRouting
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- Drop existing tables (order matters due to FK)
DROP TABLE IF EXISTS poi_recommendations CASCADE;
DROP TABLE IF EXISTS poi_categories CASCADE;
DROP TABLE IF EXISTS pois CASCADE;
DROP TABLE IF EXISTS roads CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Category Lookup Table
--    Defines 8 tourism categories with color and icon metadata
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE poi_categories (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(30) UNIQUE NOT NULL,
    label       VARCHAR(60) NOT NULL,
    color_hex   VARCHAR(7)  NOT NULL DEFAULT '#6b7280',
    icon        VARCHAR(60) NOT NULL DEFAULT 'pin',
    description TEXT
);

INSERT INTO poi_categories (code, label, color_hex, icon, description) VALUES
('heritage',    'Heritage Site',       '#8B4513', 'monument',        'UNESCO World Heritage Sites and historic monuments of the Kathmandu Valley'),
('temple',      'Temple / Religious',  '#C0392B', 'bookmark-catalog','Hindu and Buddhist temples, stupas, gompas and monasteries'),
('attraction',  'Tourist Attraction',  '#2980B9', 'tour',            'Museums, palaces, viewpoints and general visitor attractions'),
('hotel',       'Hotel / Lodging',     '#E67E22', 'home',            'Hotels, resorts, guesthouses and accommodation'),
('restaurant',  'Restaurant / Dining', '#E74C3C', 'fork-spoon',      'Restaurants, cafes, food courts and traditional dining'),
('park',        'Park / Garden',       '#27AE60', 'nature',          'National parks, urban gardens, botanical parks and recreational areas'),
('adventure',   'Adventure / Outdoor', '#8E44AD', 'activity',        'Trekking, hiking, rafting, bungee jumping and outdoor adventure sports'),
('shopping',    'Shopping / Market',   '#16A085', 'label',           'Local markets, bazaars, handicraft shops and souvenir stores');

-- ═══════════════════════════════════════════════════════════════════
-- 2. Points of Interest Table
--    Categories: heritage|temple|attraction|hotel|restaurant|park|adventure|shopping
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE pois (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(150) NOT NULL,
    category   VARCHAR(50)  NOT NULL,  -- heritage|temple|attraction|hotel|restaurant|park|adventure|shopping
    district   VARCHAR(50),            -- kathmandu|lalitpur|bhaktapur
    description TEXT,
    rating     NUMERIC(2,1),
    image_url  TEXT,
    address    VARCHAR(255),
    geom       GEOMETRY(Point, 4326)
);

CREATE INDEX pois_geom_idx ON pois USING gist(geom);
CREATE INDEX pois_district_idx ON pois (district);
CREATE INDEX pois_category_idx ON pois (category);

-- ═══════════════════════════════════════════════════════════════════
-- 2. Roads Table (pgRouting topology)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE roads (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(150),
    district     VARCHAR(50),
    source       INTEGER,
    target       INTEGER,
    cost         DOUBLE PRECISION,
    reverse_cost DOUBLE PRECISION,
    geom         GEOMETRY(LineString, 4326)
);

CREATE INDEX roads_geom_idx ON roads USING gist(geom);

-- ═══════════════════════════════════════════════════════════════════
-- 3. Seed POIs — Kathmandu District (15 spots)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO pois (id, name, category, district, description, rating, image_url, address, geom) VALUES

-- Heritage & UNESCO Sites
(1,  'Pashupatinath Temple',     'temple',     'kathmandu',
     'The most sacred Hindu temple in Nepal, dedicated to Lord Shiva and a UNESCO World Heritage Site. Located on the holy banks of the Bagmati River, it is one of the greatest Shiva temples of the Indian subcontinent.',
     4.9, 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=600',
     'Pashupatinath Road, Kathmandu', ST_SetSRID(ST_Point(85.3486, 27.7105), 4326)),

(2,  'Boudhanath Stupa',         'heritage',   'kathmandu',
     'One of the largest spherical stupas in Nepal and the holiest Tibetan Buddhist temple outside Tibet. This magnificent UNESCO World Heritage Site is surrounded by monasteries and meditation centers.',
     4.9, 'https://images.unsplash.com/photo-1544736779-a33698e1e73a?w=600',
     'Boudha, Kathmandu', ST_SetSRID(ST_Point(85.3620, 27.7215), 4326)),

(3,  'Swayambhunath (Monkey Temple)', 'heritage', 'kathmandu',
     'An ancient religious complex atop a hill in western Kathmandu. Known as the Monkey Temple, this UNESCO World Heritage Site offers panoramic views of the Kathmandu Valley.',
     4.8, 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600',
     'Swayambhu, Kathmandu', ST_SetSRID(ST_Point(85.2905, 27.7149), 4326)),

(4,  'Kathmandu Durbar Square',  'heritage',   'kathmandu',
     'Historic palace square of the former Kathmandu Kingdom featuring ancient palaces, courtyards, and temples. The Hanuman Dhoka Palace complex is a masterpiece of Newari art. UNESCO World Heritage Site.',
     4.7, 'https://images.unsplash.com/photo-1589308078059-be1415eab4c3?w=600',
     'Hanuman Dhoka, Kathmandu', ST_SetSRID(ST_Point(85.3078, 27.7041), 4326)),

-- Attractions
(5,  'Garden of Dreams',         'park',       'kathmandu',
     'A restored neoclassical garden from the early 20th century, featuring six pavilions, ponds, and manicured landscapes. A peaceful oasis in the heart of busy Kathmandu.',
     4.6, 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600',
     'Kaiser Mahal, Thamel, Kathmandu', ST_SetSRID(ST_Point(85.3133, 27.7142), 4326)),

(6,  'Narayanhiti Palace Museum', 'attraction', 'kathmandu',
     'The former royal palace of Nepal, now a public museum. Showcases the opulent royal lifestyle, artifacts, and the site of the 2001 royal massacre. A must-visit historical landmark.',
     4.5, 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=600',
     'Durbar Marg, Kathmandu', ST_SetSRID(ST_Point(85.3168, 27.7161), 4326)),

(7,  'Thamel',                   'attraction', 'kathmandu',
     'The vibrant tourist hub of Kathmandu, packed with trekking gear shops, restaurants, cafes, souvenir stores, and lively nightlife. The gateway to Himalayan adventure.',
     4.4, 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600',
     'Thamel, Kathmandu', ST_SetSRID(ST_Point(85.3083, 27.7172), 4326)),

(8,  'Rani Pokhari',             'attraction', 'kathmandu',
     'A historic pond built in 1670 by King Pratap Malla in memory of his queen. Features a beautiful Shiva temple in its center, accessible only during Tihar festival.',
     4.3, 'https://images.unsplash.com/photo-1541513161836-5e6d3b9c3fcc?w=600',
     'New Road, Kathmandu', ST_SetSRID(ST_Point(85.3139, 27.7076), 4326)),

(9,  'Dharahara Tower',          'attraction', 'kathmandu',
     'A 73-meter reconstructed tower built after the devastating 2015 earthquake. Features an observation deck offering 360° panoramic views of Kathmandu city and the surrounding hills.',
     4.4, 'https://images.unsplash.com/photo-1573914571452-f4ede1e39f27?w=600',
     'Sundhara, Kathmandu', ST_SetSRID(ST_Point(85.3140, 27.7023), 4326)),

(10, 'Kopan Monastery',          'temple',     'kathmandu',
     'A renowned Tibetan Buddhist monastery on a peaceful hilltop north of Boudhanath. Famous for its meditation retreats open to international visitors and stunning views of the valley.',
     4.7, 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=600',
     'Kopan, Kathmandu', ST_SetSRID(ST_Point(85.3701, 27.7365), 4326)),

(11, 'Budhanilkantha Temple',    'temple',     'kathmandu',
     'An important Vaishnava temple featuring a massive 5th-century reclining Vishnu statue carved from a single block of black stone, partially submerged in a natural tank.',
     4.6, 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=600',
     'Budhanilkantha, Kathmandu', ST_SetSRID(ST_Point(85.3622, 27.7912), 4326)),

-- Hotels in Kathmandu
(12, 'Hotel Yak & Yeti',         'hotel',      'kathmandu',
     'A legendary 5-star luxury hotel in central Kathmandu, partly housed in a 19th-century Rana palace. Offers world-class dining, a casino, and exceptional Himalayan hospitality.',
     4.6, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600',
     'Durbar Marg, Kathmandu', ST_SetSRID(ST_Point(85.3164, 27.7155), 4326)),

(13, 'Hyatt Regency Kathmandu',  'hotel',      'kathmandu',
     'A premium 5-star resort adjacent to the sacred Boudhanath Stupa. Offers luxurious rooms, an outdoor pool, a spa, and incredible views of the Himalayan peaks.',
     4.7, 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600',
     'Tara Gaon, Boudha, Kathmandu', ST_SetSRID(ST_Point(85.3612, 27.7209), 4326)),

-- Restaurants in Kathmandu
(14, 'Thamel House Restaurant',  'restaurant', 'kathmandu',
     'An iconic Newari cultural restaurant set in a beautifully restored 100-year-old building in Thamel. Serves authentic traditional Nepali cuisine with live cultural performances.',
     4.5, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600',
     'Thamel, Kathmandu', ST_SetSRID(ST_Point(85.3085, 27.7178), 4326)),

(15, 'Krishnarpan Restaurant',   'restaurant', 'kathmandu',
     'An award-winning fine dining restaurant inside the historic Dwarika''s Hotel, offering a grand multi-course traditional Nepali tasting menu. A must for culinary explorers.',
     4.8, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600',
     'Battisputali, Kathmandu', ST_SetSRID(ST_Point(85.3422, 27.7089), 4326)),

-- ═══════════════════════════════════════════════════════════════════
-- 4. Seed POIs — Lalitpur (Patan) District (8 spots)
-- ═══════════════════════════════════════════════════════════════════

(16, 'Patan Durbar Square',      'heritage',   'lalitpur',
     'The historic palace complex of Patan (Lalitpur), considered one of the finest examples of Newari architecture. Filled with ancient temples, stone carvings, and royal courtyards. UNESCO World Heritage Site.',
     4.9, 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600',
     'Mangal Bazaar, Lalitpur', ST_SetSRID(ST_Point(85.3253, 27.6710), 4326)),

(17, 'Patan Museum',             'attraction', 'lalitpur',
     'Widely regarded as one of the finest museums in Asia, showcasing an outstanding collection of Nepali bronze castings, gilded artwork, and cultural artifacts from the Kathmandu Valley.',
     4.8, 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=600',
     'Patan Durbar Square, Lalitpur', ST_SetSRID(ST_Point(85.3254, 27.6712), 4326)),

(18, 'Kumbheshwar Temple',       'temple',     'lalitpur',
     'A magnificent five-storied pagoda temple dedicated to Lord Shiva, one of only two five-story temples in Nepal. Features sacred tanks used during the Janai Purnima festival.',
     4.6, 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=600',
     'Kumbheshwar, Lalitpur', ST_SetSRID(ST_Point(85.3235, 27.6750), 4326)),

(19, 'Golden Temple (Kwa Bahal)','temple',     'lalitpur',
     'A beautiful 12th-century gilded Buddhist monastery near Patan Durbar Square. The golden roofs and exquisite metalwork panels depicting scenes from Buddha''s life are simply breathtaking.',
     4.7, 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=600',
     'Hiranya Varna Mahavihar, Lalitpur', ST_SetSRID(ST_Point(85.3253, 27.6726), 4326)),

(20, 'Jawalakhel Zoo',           'park',       'lalitpur',
     'Nepal''s only zoological garden, home to over 100 species including the endangered one-horned rhinoceros, royal Bengal tiger, red panda, and Himalayan wolf.',
     4.2, 'https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?w=600',
     'Jawalakhel, Lalitpur', ST_SetSRID(ST_Point(85.3210, 27.6655), 4326)),

(21, 'Mahabouddha Temple',       'temple',     'lalitpur',
     'A terracotta shikhara-style temple covered with over 9,000 small Buddha images on every brick — aptly known as the "Temple of Thousand Buddhas." A truly unique architectural marvel.',
     4.6, 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600',
     'Uku Bahal, Lalitpur', ST_SetSRID(ST_Point(85.3262, 27.6712), 4326)),

(22, 'Summit Hotel Patan',       'hotel',      'lalitpur',
     'A charming heritage-style boutique hotel surrounded by lush gardens in a quiet Patan neighborhood. Offers Himalayan views, a rooftop restaurant, and warm Newari hospitality.',
     4.5, 'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=600',
     'Kupandol, Lalitpur', ST_SetSRID(ST_Point(85.3259, 27.6832), 4326)),

(23, 'Roadhouse Cafe Patan',     'restaurant', 'lalitpur',
     'A beloved multi-cuisine restaurant in Patan offering wood-fired pizzas, traditional Nepali dal bhat, craft beers, and fresh salads in a cozy heritage-building atmosphere.',
     4.4, 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600',
     'Durbar Marg, Lalitpur', ST_SetSRID(ST_Point(85.3248, 27.6708), 4326)),

-- ═══════════════════════════════════════════════════════════════════
-- 5. Seed POIs — Bhaktapur District (8 spots)
-- ═══════════════════════════════════════════════════════════════════

(24, 'Bhaktapur Durbar Square',  'heritage',   'bhaktapur',
     'The ancient royal palace plaza of Bhaktapur city, preserving exquisite medieval Newari architecture. Includes the 55-Window Palace, Lion''s Gate, and stone temples. UNESCO World Heritage Site.',
     4.9, 'https://images.unsplash.com/photo-1589308078059-be1415eab4c3?w=600',
     'Bhaktapur Durbar Square, Bhaktapur', ST_SetSRID(ST_Point(85.4278, 27.6716), 4326)),

(25, 'Nyatapola Temple',         'temple',     'bhaktapur',
     'The tallest pagoda temple in Nepal, a five-storied masterpiece built in 1702 AD by King Bhupatindra Malla. Colossal stone sculptures of wrestlers, elephants, and lions guard each ascending terrace.',
     4.9, 'https://images.unsplash.com/photo-1583417319070-4a69db38a482?w=600',
     'Taumadhi Square, Bhaktapur', ST_SetSRID(ST_Point(85.4282, 27.6714), 4326)),

(26, 'Dattatraya Square',        'heritage',   'bhaktapur',
     'One of Bhaktapur''s oldest squares, home to the ancient Dattatraya Temple and the famous Peacock Window — considered the finest woodcarving in all of Nepal.',
     4.7, 'https://images.unsplash.com/photo-1572522831050-da2a8baf3978?w=600',
     'Dattatraya Square, Bhaktapur', ST_SetSRID(ST_Point(85.4314, 27.6724), 4326)),

(27, 'Pottery Square',           'attraction', 'bhaktapur',
     'An open-air artisan workshop where Bhaktapur''s master potters create traditional red clay pots, figurines, and souvenirs using century-old wheel-throwing and hand-coiling techniques.',
     4.5, 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=600',
     'Sukuldhoka, Bhaktapur', ST_SetSRID(ST_Point(85.4274, 27.6710), 4326)),

(28, 'Changu Narayan Temple',    'heritage',   'bhaktapur',
     'Nepal''s oldest temple dating to the 4th century AD, perched atop a forested hill. Dedicated to Lord Vishnu, it contains some of the finest stone and metal artworks in Nepal. UNESCO World Heritage Site.',
     4.8, 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=600',
     'Changu Village, Bhaktapur', ST_SetSRID(ST_Point(85.4474, 27.6978), 4326)),

(29, 'Siddha Pokhari',           'park',       'bhaktapur',
     'A large and serene historic pond at the western gateway to Bhaktapur city. Surrounded by tiered shrines and gardens, it is a popular spot for morning walks and peaceful reflection.',
     4.2, 'https://images.unsplash.com/photo-1504701954957-2010ec3bcec1?w=600',
     'Siddha Pokhari, Bhaktapur', ST_SetSRID(ST_Point(85.4252, 27.6726), 4326)),

(30, 'Bhadgaon Guest House',     'hotel',      'bhaktapur',
     'A traditional Newari-style guesthouse in the heart of Bhaktapur offering rooftop terrace views directly over Durbar Square and the distant Himalayan range. An authentic medieval city experience.',
     4.4, 'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?w=600',
     'Durbar Square, Bhaktapur', ST_SetSRID(ST_Point(85.4275, 27.6718), 4326)),

(31, 'Cafe Nyatapola',           'restaurant', 'bhaktapur',
     'A celebrated rooftop restaurant with unobstructed views of the magnificent Nyatapola Temple in Taumadhi Square. Serves Nepali, Indian, and continental cuisine. Perfect for sunset dining.',
     4.6, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600',
     'Taumadhi Square, Bhaktapur', ST_SetSRID(ST_Point(85.4280, 27.6713), 4326));

-- ═══════════════════════════════════════════════════════════════════
-- 5b. Seed POIs — Adventure Category
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO pois (id, name, category, district, description, rating, image_url, address, geom) VALUES

(32, 'Shivapuri Nagarjun National Park', 'adventure', 'kathmandu',
     'A pristine national park on the northern fringe of Kathmandu Valley. Popular for day hikes to Shivapuri Peak (2732m) with panoramic Himalayan views, birdwatching, and mountain biking. Also the source of drinking water for Kathmandu.',
     4.7, 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600',
     'Shivapuri, Kathmandu', ST_SetSRID(ST_Point(85.3700, 27.8100), 4326)),

(33, 'Nagarkot Hill Station', 'adventure', 'bhaktapur',
     'A famous hill station at 2175m altitude on the northeastern rim of Kathmandu Valley. Renowned for breathtaking sunrise views over the Himalayas including Mt. Everest, Langtang, and Ganesh Himal ranges. Popular trekking and mountain biking destination.',
     4.8, 'https://images.unsplash.com/photo-1533587851505-d119e13fa0d7?w=600',
     'Nagarkot, Bhaktapur District', ST_SetSRID(ST_Point(85.5200, 27.7200), 4326)),

(34, 'Chandragiri Hills Cable Car', 'adventure', 'kathmandu',
     'A modern cable car system rising to Chandragiri Hill at 2551m on the southwestern rim of Kathmandu Valley. Offers spectacular panoramic views of the Kathmandu Valley and the snow-capped Himalayan range. Features a temple, adventure park, and restaurants at the top.',
     4.6, 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600',
     'Chandragiri, Kirtipur, Kathmandu', ST_SetSRID(ST_Point(85.2217, 27.6658), 4326)),

(35, 'Balaju Water Garden', 'adventure', 'kathmandu',
     'A historic pleasure garden with 22 stone waterspouts (Baisi Dhara) dating from the 17th century. Features the famous reclining Vishnu statue. A peaceful recreation area popular for morning walks and picnics surrounded by lush gardens.',
     4.2, 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600',
     'Balaju, Kathmandu', ST_SetSRID(ST_Point(85.2973, 27.7244), 4326)),

(36, 'Phulchoki Mountain', 'adventure', 'lalitpur',
     'The highest point on the rim of Kathmandu Valley at 2782m. Known as the Mountain of Flowers due to the spectacular rhododendron forests. Excellent bird watching with over 280 recorded species. Offers stunning views of the Himalayas and Kathmandu Valley.',
     4.5, 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600',
     'Phulchoki, Lalitpur District', ST_SetSRID(ST_Point(85.4000, 27.5900), 4326)),

(37, 'Godavari Botanical Garden', 'adventure', 'lalitpur',
     'A large botanical garden at the foot of Phulchoki Mountain covering 82 hectares. Home to over 600 plant species, greenhouse collections, fish ponds, and beautiful picnic spots. The garden serves as a research center and popular recreational destination for Kathmandu Valley residents.',
     4.4, 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600',
     'Godavari, Lalitpur', ST_SetSRID(ST_Point(85.3840, 27.5990), 4326));

-- ═══════════════════════════════════════════════════════════════════
-- 5c. Seed POIs — Shopping Category
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO pois (id, name, category, district, description, rating, image_url, address, geom) VALUES

(38, 'Thamel Shopping District', 'shopping', 'kathmandu',
     'The vibrant tourist hub of Kathmandu, Thamel is a labyrinth of narrow streets packed with shops selling trekking gear, handicrafts, pashmina shawls, thangka paintings, jewelry, and Nepali souvenirs. Also home to numerous restaurants, cafes, bars, and guesthouses.',
     4.6, 'https://images.unsplash.com/photo-1571847140471-1d7766e825ea?w=600',
     'Thamel, Kathmandu', ST_SetSRID(ST_Point(85.3083, 27.7172), 4326)),

(39, 'Asan Bazaar', 'shopping', 'kathmandu',
     'One of the oldest and most bustling traditional markets in Kathmandu, dating back over 1000 years. A lively intersection of merchants selling spices, grains, vegetables, religious items, and daily goods. The historic market captures the authentic commercial and cultural life of old Kathmandu.',
     4.5, 'https://images.unsplash.com/photo-1555421689-3f034debb7a6?w=600',
     'Asan, Kathmandu', ST_SetSRID(ST_Point(85.3097, 27.7064), 4326)),

(40, 'Indra Chowk Market', 'shopping', 'kathmandu',
     'A historic trading square in the heart of old Kathmandu, dedicated to Indra the god of rain. The surrounding area is famous for its colorful bead shops, pashmina stores, and traditional Newari architecture. An excellent place to find authentic jewelry and textile handicrafts.',
     4.3, 'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=600',
     'Indra Chowk, Kathmandu', ST_SetSRID(ST_Point(85.3082, 27.7052), 4326)),

(41, 'Patan Dhoka Handicraft Shops', 'shopping', 'lalitpur',
     'The area around Patan Durbar Square is renowned for its exceptional metalwork, woodcarving, and traditional Newari handicrafts. Numerous artisan workshops and shops line the streets, selling bronze statues, copper vessels, thangka paintings, and intricate carved wooden items.',
     4.7, 'https://images.unsplash.com/photo-1567270671170-c3b7e3de7da1?w=600',
     'Patan Dhoka, Lalitpur', ST_SetSRID(ST_Point(85.3240, 27.6700), 4326)),

(42, 'Mangal Bazaar, Patan', 'shopping', 'lalitpur',
     'A charming traditional market adjacent to Patan Durbar Square selling local vegetables, fresh produce, spices, and traditional Newari items. The area is also home to antique dealers and shops selling traditional metalcraft for which Patan is famous throughout Nepal.',
     4.4, 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=600',
     'Mangal Bazaar, Lalitpur', ST_SetSRID(ST_Point(85.3255, 27.6708), 4326)),

(43, 'Bhaktapur Pottery Square', 'shopping', 'bhaktapur',
     'Potters Square (Tilachhen Tole) in Bhaktapur is one of the last places in Nepal where traditional Newari pottery is still made by hand using ancient techniques. Visitors can watch potters at work spinning clay on traditional foot-powered wheels and browse the hundreds of clay pots, vases, and figurines for sale.',
     4.8, 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=600',
     'Talako, Bhaktapur', ST_SetSRID(ST_Point(85.4274, 27.6710), 4326));

-- ═══════════════════════════════════════════════════════════════════
-- 5d. Seed POIs — Additional Heritage, Attraction & Restaurant
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO pois (id, name, category, district, description, rating, image_url, address, geom) VALUES

(44, 'Kirtipur Citadel', 'heritage', 'kathmandu',
     'The ancient hilltop citadel of Kirtipur, once an independent Newar kingdom that famously resisted Prithvi Narayan Shah for two years. The town preserves traditional Newari architecture, the Chilancho Stupa, Uma Maheshwar Temple, and offers panoramic views of Kathmandu Valley.',
     4.4, 'https://images.unsplash.com/photo-1589308078059-be1415eab4c3?w=600',
     'Kirtipur, Kathmandu', ST_SetSRID(ST_Point(85.2781, 27.6743), 4326)),

(45, 'Dakshinkali Temple', 'temple', 'kathmandu',
     'A famous Hindu temple dedicated to the fierce goddess Kali, located 22km south of Kathmandu in a scenic forest gorge at the confluence of two streams. Known for animal sacrifices performed by devotees especially on Tuesdays and Saturdays. The surrounding area includes picnic spots and forest walks.',
     4.5, 'https://images.unsplash.com/photo-1605640840605-14ac1855827b?w=600',
     'Dakshinkali, Kathmandu', ST_SetSRID(ST_Point(85.2300, 27.6100), 4326)),

(46, 'Namobuddha Monastery', 'temple', 'bhaktapur',
     'A sacred Buddhist pilgrimage site on a hilltop 38km east of Kathmandu at 1750m altitude. According to legend, the Bodhisattva Mahasattva gave his body to feed a starving tigress here. The monastery complex includes temples, stupas, and a meditation center with stunning Himalayan views.',
     4.8, 'https://images.unsplash.com/photo-1544736779-a33698e1e73a?w=600',
     'Namobuddha, Kavre District', ST_SetSRID(ST_Point(85.5040, 27.6290), 4326)),

(47, 'National Museum of Nepal', 'attraction', 'kathmandu',
     'The National Museum of Nepal in Chhauni houses an extensive collection of art, history, and natural history artifacts. The museum contains ancient weapons, coins, paintings, and cultural artifacts spanning thousands of years of Nepali history. A comprehensive repository of the country''s cultural heritage.',
     4.3, 'https://images.unsplash.com/photo-1580974511812-5ed899a1cb48?w=600',
     'Chhauni, Kathmandu', ST_SetSRID(ST_Point(85.3019, 27.7095), 4326)),

(48, 'Boudhanath Restaurants Row', 'restaurant', 'kathmandu',
     'The ring road around Boudhanath Stupa is lined with excellent restaurants offering Tibetan, Nepali, Indian, and international cuisine. Diners can enjoy meals with direct views of the illuminated stupa. Famous spots include rooftop cafes serving butter tea, momos, and thukpa.',
     4.6, 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600',
     'Boudha Ring Road, Kathmandu', ST_SetSRID(ST_Point(85.3618, 27.7212), 4326)),

(49, 'Dwarika Hotel', 'hotel', 'kathmandu',
     'Dwarika''s Hotel is an award-winning heritage luxury hotel in Kathmandu, celebrating Nepal''s rich cultural heritage. Built using original carved wood salvaged from demolitions across the Kathmandu Valley, the hotel is a living museum of traditional Newari craftsmanship and architecture.',
     4.9, 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=600',
     'Battisputali, Kathmandu', ST_SetSRID(ST_Point(85.3450, 27.7095), 4326)),

(50, 'Patan Eco Park', 'park', 'lalitpur',
     'A modern urban ecological park in Lalitpur providing green open space for residents of the rapidly developing Patan metropolitan area. The park features walking trails, native tree plantations, an outdoor amphitheater, children''s play area, and meditation zones.',
     4.1, 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600',
     'Sanepa, Lalitpur', ST_SetSRID(ST_Point(85.3105, 27.6850), 4326));

-- Reset sequence
SELECT setval('pois_id_seq', (SELECT MAX(id) FROM pois));

-- ═══════════════════════════════════════════════════════════════════
-- 5e. Recommendations Table
--     Pre-computed POI-to-POI similarity (same category + proximity)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE poi_recommendations (
    id                SERIAL PRIMARY KEY,
    poi_id            INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
    recommended_poi_id INTEGER NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
    reason            VARCHAR(120),
    score             NUMERIC(3,1) CHECK (score >= 0 AND score <= 10),
    UNIQUE (poi_id, recommended_poi_id)
);

CREATE INDEX poi_rec_poi_idx  ON poi_recommendations (poi_id);
CREATE INDEX poi_rec_rpoi_idx ON poi_recommendations (recommended_poi_id);

-- Seed pre-computed recommendations (same-category pairs + cross-category nearby)
INSERT INTO poi_recommendations (poi_id, recommended_poi_id, reason, score) VALUES
-- Heritage pairs
(1, 2, 'Both UNESCO World Heritage Sites in Kathmandu', 9.5),
(1, 4, 'Both are major Hindu heritage sites in Kathmandu', 8.8),
(2, 3, 'Buddhist heritage sites within 8km', 9.2),
(3, 4, 'Both UNESCO sites in west-central Kathmandu', 8.5),
(4, 44, 'Historic citadels of the Kathmandu Valley kingdoms', 8.0),
-- Temple pairs
(1, 45, 'Major Hindu temples devoted to Shaivite tradition', 8.7),
(45, 1, 'Both major Shiva/Kali temples in Kathmandu District', 8.7),
(1, 46, 'Sacred religious sites — Hindu and Buddhist traditions', 7.5),
-- Attraction pairs
(5, 6, 'Garden of Dreams and Narayanhiti Palace are adjacent', 9.8),
(6, 5, 'Palace next to the iconic Garden of Dreams', 9.8),
(47, 6, 'National Museum and Narayanhiti Palace — both cultural institutions', 8.2),
-- Hotel pairs
(12, 13, 'Luxury international hotels in Kathmandu', 8.0),
(49, 12, 'Heritage and luxury hotels — premium Kathmandu stays', 8.5),
-- Restaurant pairs
(15, 48, 'Fine dining experiences — Kathmandu Valley', 7.5),
-- Park pairs
(5, 50, 'Urban green spaces in the Kathmandu Valley', 7.8),
(36, 37, 'Both natural parks on the southern valley rim', 9.0),
(37, 36, 'Adjacent botanical and nature parks near Phulchoki', 9.0),
-- Adventure pairs
(32, 34, 'Adventure and scenic hill experiences around Kathmandu', 8.5),
(33, 32, 'Himalayan viewpoint trekking destinations', 8.8),
(34, 33, 'Hill station cable car and Nagarkot highland views', 8.3),
(35, 32, 'Nature parks and gardens for outdoor enthusiasts', 7.5),
-- Shopping pairs
(38, 39, 'Thamel and Asan — the two biggest markets in Kathmandu', 9.3),
(39, 40, 'Traditional markets in old Kathmandu walking distance', 9.0),
(40, 39, 'Historic commercial squares of old Kathmandu', 9.0),
(41, 42, 'Patan''s artisan and handicraft shopping areas', 9.5),
(43, 41, 'Traditional craft markets — Bhaktapur and Patan', 8.0);

-- ═══════════════════════════════════════════════════════════════════
-- 5f. Category Statistics View
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW poi_category_stats AS
SELECT
    c.code,
    c.label,
    c.color_hex,
    c.icon,
    COUNT(p.id)              AS poi_count,
    ROUND(AVG(p.rating), 2)  AS avg_rating,
    MAX(p.rating)            AS max_rating
FROM poi_categories c
LEFT JOIN pois p ON p.category = c.code
GROUP BY c.code, c.label, c.color_hex, c.icon
ORDER BY poi_count DESC;

-- ═══════════════════════════════════════════════════════════════════
-- 6. Road Network — Kathmandu Valley Tourism Route Topology
--
-- Node coordinate index (for pgRouting vertex matching):
--  1  = Pashupatinath      (85.3486, 27.7105)
--  2  = Boudhanath         (85.3620, 27.7215)
--  3  = Swayambhunath      (85.2905, 27.7149)
--  4  = Kathmandu Durbar   (85.3078, 27.7041)
--  5  = Garden of Dreams   (85.3133, 27.7142)
--  6  = Narayanhiti Palace (85.3168, 27.7161)
--  7  = Thamel             (85.3083, 27.7172)
--  8  = Rani Pokhari       (85.3139, 27.7076)
--  9  = Dharahara          (85.3140, 27.7023)
-- 10  = Kopan Monastery    (85.3701, 27.7365)
-- 11  = Budhanilkantha     (85.3622, 27.7912)
-- 12  = Hotel Yak & Yeti   (85.3164, 27.7155)
-- 13  = Hyatt Regency      (85.3612, 27.7209)
-- 15  = Krishnarpan Rest.  (85.3422, 27.7089)
-- 16  = Patan Durbar       (85.3253, 27.6710)
-- 17  = Patan Museum       (85.3254, 27.6712)
-- 18  = Kumbheshwar        (85.3235, 27.6750)
-- 20  = Jawalakhel Zoo     (85.3210, 27.6655)
-- 22  = Summit Hotel Patan (85.3259, 27.6832)
-- 24  = Bhaktapur Durbar   (85.4278, 27.6716)
-- 25  = Nyatapola          (85.4282, 27.6714)
-- 26  = Dattatraya Square  (85.4314, 27.6724)
-- 28  = Changu Narayan     (85.4474, 27.6978)
-- 29  = Siddha Pokhari     (85.4252, 27.6726)
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO roads (name, district, source, target, geom) VALUES

-- ── Kathmandu Internal Roads ────────────────────────────────────────
('Araniko Highway — Pashupatinath to Boudhanath',
 'kathmandu', 1, 2,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3486 27.7105, 85.3530 27.7145, 85.3620 27.7215)'), 4326)),

('Kopan Road — Boudhanath to Kopan Monastery',
 'kathmandu', 2, 10,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3620 27.7215, 85.3660 27.7290, 85.3701 27.7365)'), 4326)),

('Boudha-Hyatt Link — Boudhanath to Hyatt Regency',
 'kathmandu', 2, 13,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3620 27.7215, 85.3616 27.7212, 85.3612 27.7209)'), 4326)),

('Ring Road North — Thamel to Swayambhunath',
 'kathmandu', 7, 3,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3083 27.7172, 85.3020 27.7165, 85.2960 27.7158, 85.2905 27.7149)'), 4326)),

('Thamel to Narayanhiti — Durbar Marg Connector',
 'kathmandu', 7, 6,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3083 27.7172, 85.3100 27.7165, 85.3140 27.7160, 85.3168 27.7161)'), 4326)),

('Narayanhiti to Hotel Yak & Yeti — Durbar Marg',
 'kathmandu', 6, 12,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3168 27.7161, 85.3166 27.7158, 85.3164 27.7155)'), 4326)),

('Garden of Dreams to Thamel Walk',
 'kathmandu', 5, 7,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3133 27.7142, 85.3115 27.7155, 85.3083 27.7172)'), 4326)),

('Narayanhiti to Garden of Dreams',
 'kathmandu', 6, 5,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3168 27.7161, 85.3155 27.7155, 85.3133 27.7142)'), 4326)),

('Narayanhiti to Rani Pokhari — New Road',
 'kathmandu', 6, 8,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3168 27.7161, 85.3155 27.7120, 85.3139 27.7076)'), 4326)),

('Rani Pokhari to Dharahara — Sundhara Route',
 'kathmandu', 8, 9,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3139 27.7076, 85.3139 27.7050, 85.3140 27.7023)'), 4326)),

('Dharahara to Kathmandu Durbar Square',
 'kathmandu', 9, 4,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3140 27.7023, 85.3115 27.7030, 85.3078 27.7041)'), 4326)),

('Pashupatinath to Krishnarpan — Battisputali Link',
 'kathmandu', 1, 15,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3486 27.7105, 85.3452 27.7097, 85.3422 27.7089)'), 4326)),

('Ring Road East — Boudhanath to Budhanilkantha',
 'kathmandu', 2, 11,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3620 27.7215, 85.3621 27.7450, 85.3622 27.7912)'), 4326)),

-- ── Kathmandu to Lalitpur (Cross-District) ─────────────────────────
('Bagmati Bridge — Kathmandu Durbar to Patan Durbar',
 'lalitpur', 4, 16,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3078 27.7041, 85.3100 27.6960, 85.3180 27.6870, 85.3253 27.6710)'), 4326)),

('Pulchowk Road — Patan Durbar to Jawalakhel Zoo',
 'lalitpur', 16, 20,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3253 27.6710, 85.3240 27.6690, 85.3225 27.6670, 85.3210 27.6655)'), 4326)),

('Patan Museum to Kumbheshwar Temple',
 'lalitpur', 17, 18,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3254 27.6712, 85.3248 27.6720, 85.3242 27.6733, 85.3235 27.6750)'), 4326)),

('Patan Heritage Loop — Kumbheshwar to Summit Hotel',
 'lalitpur', 18, 22,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3235 27.6750, 85.3245 27.6790, 85.3252 27.6810, 85.3259 27.6832)'), 4326)),

('Patan Durbar to Golden Temple (Walking Path)',
 'lalitpur', 16, 19,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3253 27.6710, 85.3253 27.6718, 85.3253 27.6726)'), 4326)),

('Ring Road South — Patan to Bhaktapur via Thimi',
 'bhaktapur', 16, 24,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3253 27.6710, 85.3500 27.6695, 85.3750 27.6700, 85.4000 27.6706, 85.4278 27.6716)'), 4326)),

-- ── Bhaktapur Internal Roads ────────────────────────────────────────
('Araniko Highway — Kathmandu Center to Bhaktapur',
 'bhaktapur', 8, 24,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.3139 27.7076, 85.3400 27.7050, 85.3700 27.7000, 85.4000 27.6850, 85.4278 27.6716)'), 4326)),

('Bhaktapur Durbar to Nyatapola — Taumadhi Link',
 'bhaktapur', 24, 25,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.4278 27.6716, 85.4280 27.6715, 85.4282 27.6714)'), 4326)),

('Nyatapola to Dattatraya Square',
 'bhaktapur', 25, 26,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.4282 27.6714, 85.4295 27.6718, 85.4314 27.6724)'), 4326)),

('Bhaktapur Durbar to Pottery Square',
 'bhaktapur', 24, 27,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.4278 27.6716, 85.4276 27.6713, 85.4274 27.6710)'), 4326)),

('Siddha Pokhari to Bhaktapur Durbar — Main Gate',
 'bhaktapur', 29, 24,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.4252 27.6726, 85.4260 27.6720, 85.4278 27.6716)'), 4326)),

('Changu Narayan Hill Road — Bhaktapur to Changu',
 'bhaktapur', 24, 28,
 ST_SetSRID(ST_GeomFromText('LINESTRING(85.4278 27.6716, 85.4340 27.6780, 85.4400 27.6870, 85.4474 27.6978)'), 4326));

-- ═══════════════════════════════════════════════════════════════════
-- 7. Compute road costs from actual geographic segment length (meters)
-- ═══════════════════════════════════════════════════════════════════
UPDATE roads SET
    cost         = ST_Length(geom::geography),
    reverse_cost = ST_Length(geom::geography);

-- ═══════════════════════════════════════════════════════════════════
-- 8. Summary view for quick reference
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE
    poi_count   INTEGER;
    road_count  INTEGER;
    cat_count   INTEGER;
    rec_count   INTEGER;
BEGIN
    SELECT COUNT(*) INTO poi_count  FROM pois;
    SELECT COUNT(*) INTO road_count FROM roads;
    SELECT COUNT(*) INTO cat_count  FROM poi_categories;
    SELECT COUNT(*) INTO rec_count  FROM poi_recommendations;
    RAISE NOTICE '✅ TourGIS Kathmandu Valley database initialized.';
    RAISE NOTICE '   Categories:       % tourism categories', cat_count;
    RAISE NOTICE '   POIs:             % tourism spots loaded', poi_count;
    RAISE NOTICE '   Roads:            % road segments loaded', road_count;
    RAISE NOTICE '   Recommendations:  % pre-computed pairs', rec_count;
    RAISE NOTICE '   Districts:        Kathmandu | Lalitpur | Bhaktapur';
END $$;
