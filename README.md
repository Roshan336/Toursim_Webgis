# Kathmandu Valley Tourism WebGIS

An interactive, full-stack Web Geographic Information System (WebGIS) application designed for tourism mapping, spatial queries, routing, and advanced spatial analytics in the Kathmandu Valley, Nepal. 

This project integrates **FastAPI**, **PostgreSQL/PostGIS**, **ArcGIS Maps SDK for JavaScript**, and **Esri Calcite Components** to deliver an ArcGIS Pro-style interface in a web browser.

---

## 🚀 Key Features

### 1. Interactive Map & GIS Boundaries
- Visualizes administrative boundaries of Nepal (Provinces, Districts, and Local Units / GapaNapas).
- Renders tourist Points of Interest (POIs) with dynamic markers styled by category.
- Map click coordinates identify and highlight intersecting boundary layers in real-time.

### 2. Route Planner & Autocomplete Geocoder
- Calculates shortest routes using the **OpenRouteService Directions API**.
- Pick start and destination nodes interactively on the map or search using the autocomplete address finder.
- Autocomplete searches across local PostGIS POIs, OpenStreetMap (Overpass API), and OpenRouteService Geocoding.

### 3. Travel Time Isochrone Analysis
- Generates travel range zones (contours) representing reachable areas from a selected point.
- Supports **Driving (Car)**, **Walking (Foot)**, and **Cycling (Regular)** modes with custom time/distance intervals.

### 4. ArcGIS-Style Select by Attribute
- Select layer features using SQL-like expressions.
- Features a **live SQL query preview** block compiled dynamically on the client side.
- Displays query result lists and flashes highlighted geometries on the map.
- Exports selection sets to **CSV files**, including spatial coordinates.

### 5. ArcGIS-Style Select by Location (Spatial Filter)
- Select features from a target layer based on their spatial relationship with a source layer.
- Supports spatial relationship predicates: `Intersects`, `Contains`, `Within`, `Touches`, and `Within Distance`.

### 6. PostGIS Spatial Analytics
- **DBSCAN Clustering**: Spatially group nearby POIs into density-based clusters using `ST_ClusterDBSCAN`.
- **Nearest Facility Finder**: Click any map coordinate to locate and route to the nearest hotels, restaurants, temples, etc.
- **Density Zones**: Generate buffer rings around POIs to visualize high-concentration tourist areas.
- **Service Area Overlap**: Select a tourism spot to see which adjacent spots have overlapping service coverages.

### 7. Tourism Recommendation Engine
- Recommends similar places based on precomputed rating scores and PostGIS distance-based proximity fallbacks.

### 8. Secure User Authentication
- Complete Login and Registration flow seamlessly integrated into the SPA architecture.
- New users can register accounts which are securely hashed (`bcrypt`) and saved in the PostgreSQL `users` table.
- Forces authentication immediately upon app load, keeping tourism data and tools restricted to authorized users.

### 9. Distance Measuring Tool
- Interactive map widget using ArcGIS `DistanceMeasurement2D`.
- Allows users to accurately measure polyline distances (e.g. tracking trail lengths or route segments) dynamically.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**:
  - [ArcGIS Maps SDK for JavaScript v4](https://developers.arcgis.com/javascript/latest/) — Map viewer & coordinate logic
  - [Esri Calcite Design System](https://developers.arcgis.com/calcite-design-system/) — ArcGIS Pro-style UI layout & components
  - Vanilla HTML5 / JavaScript (ES6+) / CSS3
  - [Vite](https://vite.dev/) — Build tool and dev server
- **Backend**:
  - [FastAPI](https://fastapi.tiangolo.com/) — Web framework and API endpoints
  - [Uvicorn](https://www.uvicorn.org/) — ASGI web server
  - [Psycopg2](https://www.psycopg.org/) — PostgreSQL database adapter
- **Database**:
  - [PostgreSQL](https://www.postgresql.org/) with [PostGIS](https://postgis.net/) extension — Spatial database storage & geometry calculations

---

## 💻 Installation & Setup

### Prerequisites
- **PostgreSQL** (with PostGIS extension installed and running)
- **Node.js** (v18+)
- **Python** (3.8+)
- **OpenRouteService API Key** (A default key is embedded, but you can configure your own)

### 1. Database Setup
1. Create a PostgreSQL database named `web_gis`:
   ```sql
   CREATE DATABASE web_gis;
   ```
2. Enable the PostGIS extension:
   ```sql
   CREATE EXTENSION postgis;
   ```
3. Initialize the database schema and seed data by running the setup script:
   ```bash
   psql -U postgres -d web_gis -f database/init.sql
   ```

### 2. Backend Setup
1. Navigate to the root directory and create a Python virtual environment:
   ```bash
   python -m venv venv
   ```
2. Activate the virtual environment:
   - **Windows (CMD/PowerShell)**:
     ```powershell
     .\venv\Scripts\activate
     ```
   - **Linux/macOS**:
     ```bash
     source venv/bin/activate
     ```
3. Install Python dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
4. Start the FastAPI development server:
   ```bash
   python -m uvicorn backend.main:app --reload --port 8001
   ```
   The backend API will run on `http://localhost:8001`.

### 3. Frontend Setup
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Start the Vite dev server:
   ```bash
   npm run dev
   ```
   The frontend application will be hosted at `http://localhost:5173`.

---

## 🗄️ Database Schema Details

The seeded Postgres database includes the following key tables:
* `pois`: Tourist spots with descriptions, districts, ratings, and geometric `POINT` coordinates.
* `poi_categories`: Lookup table storing metadata like labels, HSL hex colors, and icon identifiers.
* `poi_recommendations`: Mapping similar spots with weighted score pairs.
* `province_layer`, `district_layer`, `gapanapa_layer`: Administrative boundaries containing GIS geometry polygons.
* `users`: Secure authentication table storing usernames and `bcrypt`-hashed passwords for application access.

---

## 📝 License
Distributed under the MIT License. See `LICENSE` for more information.
