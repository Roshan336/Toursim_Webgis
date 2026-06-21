"""
overpass_fetch.py — Live OSM Tourism Data for Kathmandu Valley
Queries the free Overpass API to fetch real-time tourism data from
OpenStreetMap for Kathmandu, Lalitpur (Patan), and Bhaktapur districts.
"""

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlencode

OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"

# Bounding boxes for each district [south, west, north, east]
DISTRICT_BOUNDS = {
    "kathmandu": (27.65, 85.27, 27.81, 85.40),
    "lalitpur":  (27.62, 85.29, 27.71, 85.35),
    "bhaktapur": (27.63, 85.38, 27.72, 85.47),
    "all":       (27.59, 85.22, 27.83, 85.52),
}

# Category mapping from OSM tags → our app categories
OSM_CATEGORY_MAP = {
    # temples / religious
    "place_of_worship": "temple",
    "temple":           "temple",
    "monastery":        "temple",
    "shrine":           "temple",
    # heritage
    "archaeological_site": "heritage",
    "ruins":               "heritage",
    "monument":            "heritage",
    "memorial":            "heritage",
    # attractions / tourism
    "attraction":      "attraction",
    "museum":          "attraction",
    "gallery":         "attraction",
    "viewpoint":       "attraction",
    "artwork":         "attraction",
    "information":     "attraction",
    "theme_park":      "attraction",
    "zoo":             "park",
    # accommodation
    "hotel":      "hotel",
    "hostel":     "hotel",
    "guest_house":"hotel",
    "motel":      "hotel",
    # food
    "restaurant": "restaurant",
    "cafe":       "restaurant",
    "fast_food":  "restaurant",
    "food_court": "restaurant",
    # green spaces
    "park":       "park",
    "garden":     "park",
    "nature_reserve": "park",
    "forest":     "park",
    # shopping
    "shop":           "shopping",
    "marketplace":    "shopping",
    "mall":           "shopping",
    "department_store":"shopping",
    "supermarket":    "shopping",
    # adventure / outdoor
    "sports_centre":  "adventure",
    "climbing":       "adventure",
    "pitch":          "adventure",
    "stadium":        "adventure",
    "marina":         "adventure",
}

# District name detection by bounding box
DISTRICT_LAT_LON_RANGES = {
    "bhaktapur": {"lon_min": 85.38, "lon_max": 85.50},
    "lalitpur":  {"lat_max": 27.70, "lon_min": 85.30, "lon_max": 85.38},
}


def _build_overpass_query(bounds: tuple) -> str:
    """Build Overpass QL query for tourism nodes inside bounds."""
    south, west, north, east = bounds
    bb = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:30];
(
  node["tourism"]({bb});
  node["historic"]["historic"!="no"]({bb});
  node["amenity"="place_of_worship"]({bb});
  node["leisure"="park"]({bb});
  node["leisure"="garden"]({bb});
  node["tourism"="hotel"]({bb});
  node["tourism"="hostel"]({bb});
  node["tourism"="guest_house"]({bb});
  node["amenity"="restaurant"]["name"]({bb});
  node["amenity"="cafe"]["name"]({bb});
  node["shop"]["name"]({bb});
  node["amenity"="marketplace"]["name"]({bb});
  node["leisure"="sports_centre"]["name"]({bb});
);
out body;
"""


def _detect_district(lat: float, lon: float) -> str:
    """Detect district based on coordinate ranges."""
    if lon >= 85.38:
        return "bhaktapur"
    if lat < 27.70 and 85.30 <= lon < 85.38:
        return "lalitpur"
    return "kathmandu"


def _get_category(tags: dict) -> str:
    """Determine our app category from OSM tags."""
    tourism  = tags.get("tourism", "")
    historic = tags.get("historic", "")
    amenity  = tags.get("amenity", "")
    leisure  = tags.get("leisure", "")

    for key in [tourism, historic, amenity, leisure]:
        if key in OSM_CATEGORY_MAP:
            return OSM_CATEGORY_MAP[key]

    # Fallback: religious = temple, historic catchall
    if amenity == "place_of_worship":
        return "temple"
    if historic:
        return "heritage"
    if leisure in ("sports_centre", "pitch", "stadium"):
        return "adventure"
    if amenity in ("marketplace",) or tags.get("shop"):
        return "shopping"
    if tourism:
        return "attraction"

    return "attraction"


def _format_name(tags: dict) -> str | None:
    """Prefer English name, fallback to local name."""
    return (
        tags.get("name:en")
        or tags.get("name")
        or tags.get("name:ne")
        or None
    )


def _normalize_node(node: dict) -> dict | None:
    """Convert an Overpass node to our GeoJSON feature format."""
    tags = node.get("tags", {})
    name = _format_name(tags)
    if not name:
        return None  # skip unnamed nodes

    lat = node.get("lat")
    lon = node.get("lon")
    if lat is None or lon is None:
        return None

    category = _get_category(tags)
    district  = _detect_district(float(lat), float(lon))

    description_parts = []
    if tags.get("description"):
        description_parts.append(tags["description"])
    if tags.get("heritage"):
        description_parts.append(f"Heritage: {tags['heritage']}")
    if tags.get("religion"):
        description_parts.append(f"Religion: {tags['religion'].title()}")
    if tags.get("denomination"):
        description_parts.append(f"Denomination: {tags['denomination'].title()}")
    if tags.get("opening_hours"):
        description_parts.append(f"Hours: {tags['opening_hours']}")

    description = " | ".join(description_parts) if description_parts else None

    website = tags.get("website") or tags.get("url") or tags.get("contact:website")
    image_url = tags.get("image") or tags.get("wikimedia_commons")

    address_parts = [
        tags.get("addr:street"),
        tags.get("addr:city"),
    ]
    address = ", ".join(p for p in address_parts if p) or tags.get("addr:full") or None

    return {
        "type": "Feature",
        "id":   f"osm_{node['id']}",
        "geometry": {
            "type":        "Point",
            "coordinates": [float(lon), float(lat)],
        },
        "properties": {
            "id":          f"osm_{node['id']}",
            "name":        name,
            "category":    category,
            "district":    district,
            "description": description,
            "rating":      None,
            "image_url":   image_url,
            "address":     address,
            "website":     website,
            "source":      "openstreetmap",
            "osm_id":      node["id"],
            "tags":        tags,
        },
    }


def fetch_kathmandu_pois(district: str = "all") -> dict:
    """
    Fetch live tourism POIs from Overpass API for Kathmandu Valley.

    Args:
        district: One of 'kathmandu', 'lalitpur', 'bhaktapur', 'all'

    Returns:
        GeoJSON FeatureCollection dict
    """
    district = district.lower().strip()
    if district not in DISTRICT_BOUNDS:
        district = "all"

    bounds = DISTRICT_BOUNDS[district]
    query  = _build_overpass_query(bounds)

    data = urlencode({"data": query}).encode("utf-8")
    request = Request(OVERPASS_API_URL, data=data, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("User-Agent", "TourGIS-KathmanduValley/1.0")

    try:
        with urlopen(request, timeout=35) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        raise RuntimeError(f"Overpass API HTTP {err.code}: {err.read().decode()}") from err
    except URLError as err:
        raise RuntimeError(f"Overpass API connection failed: {err.reason}") from err

    elements = raw.get("elements", [])
    features = []
    seen_names: set[str] = set()

    for node in elements:
        feature = _normalize_node(node)
        if feature is None:
            continue
        # De-duplicate by name + approximate coordinates
        name = feature["properties"]["name"]
        coords = feature["geometry"]["coordinates"]
        key = f"{name}_{round(coords[0], 3)}_{round(coords[1], 3)}"
        if key in seen_names:
            continue
        seen_names.add(key)
        features.append(feature)

    # Sort: heritage first, then temples, then the rest
    category_order = {"heritage": 0, "temple": 1, "attraction": 2,
                      "park": 3, "hotel": 4, "restaurant": 5, "shopping": 6, "adventure": 7}
    features.sort(key=lambda f: category_order.get(f["properties"]["category"], 9))

    return {
        "type":     "FeatureCollection",
        "district": district,
        "count":    len(features),
        "source":   "openstreetmap_overpass",
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "features": features,
    }
