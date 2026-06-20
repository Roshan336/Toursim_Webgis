import json
import math
import os
import re
from html import unescape
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
ROUTES_FIELD_MASK = ",".join(
    [
        "routes.distanceMeters",
        "routes.duration",
        "routes.polyline.encodedPolyline",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.duration",
        "routes.legs.steps.polyline.encodedPolyline",
        "routes.legs.steps.startLocation",
        "routes.legs.steps.endLocation",
        "routes.legs.steps.navigationInstruction",
    ]
)


class GoogleRouteError(Exception):
    pass


class GoogleRouteConfigurationError(GoogleRouteError):
    pass


def decode_polyline(encoded):
    index = 0
    lat = 0
    lon = 0
    coordinates = []

    while index < len(encoded):
        lat_delta, index = _decode_polyline_value(encoded, index)
        lon_delta, index = _decode_polyline_value(encoded, index)
        lat += lat_delta
        lon += lon_delta
        coordinates.append([round(lon / 100000.0, 6), round(lat / 100000.0, 6)])

    return coordinates


def get_google_route(start_lon, start_lat, end_lon, end_lat, travel_mode="DRIVE"):
    api_key = os.getenv("GOOGLE_MAPS_API_KEY")
    if not api_key:
        raise GoogleRouteConfigurationError("GOOGLE_MAPS_API_KEY is not configured.")

    payload = {
        "origin": _waypoint(start_lon, start_lat),
        "destination": _waypoint(end_lon, end_lat),
        "travelMode": travel_mode,
        "polylineQuality": "HIGH_QUALITY",
        "polylineEncoding": "ENCODED_POLYLINE",
        "computeAlternativeRoutes": False,
    }
    request = Request(
        ROUTES_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": ROUTES_FIELD_MASK,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise GoogleRouteError(f"Google Routes API returned HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise GoogleRouteError(f"Google Routes API request failed: {error.reason}") from error

    return google_routes_response_to_route(data)


def google_routes_response_to_route(data):
    routes = data.get("routes") or []
    if not routes:
        raise GoogleRouteError("Google Routes API returned no routes.")

    route = routes[0]
    steps = []
    for leg in route.get("legs") or []:
        steps.extend(leg.get("steps") or [])

    segments = []
    for index, step in enumerate(steps, start=1):
        coordinates = decode_polyline((step.get("polyline") or {}).get("encodedPolyline", ""))
        start_location = _lat_lng_to_lon_lat(step.get("startLocation"))
        end_location = _lat_lng_to_lon_lat(step.get("endLocation"))
        instruction = _strip_html((step.get("navigationInstruction") or {}).get("instructions"))
        maneuver = (step.get("navigationInstruction") or {}).get("maneuver", "")

        segments.append(
            {
                "seq": index,
                "name": instruction or "Continue",
                "instruction": instruction or "Continue",
                "maneuver": maneuver,
                "distance_meters": round(float(step.get("distanceMeters") or 0), 2),
                "duration_seconds": _duration_to_seconds(step.get("duration")),
                "start_location": start_location,
                "end_location": end_location,
                "bearing": _bearing_from_coordinates(coordinates, start_location, end_location),
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
            }
        )

    encoded_route_polyline = (route.get("polyline") or {}).get("encodedPolyline", "")
    route_coordinates = decode_polyline(encoded_route_polyline) if encoded_route_polyline else _merge_segment_coordinates(segments)

    return {
        "status": "success",
        "provider": "google_routes",
        "total_distance_meters": round(float(route.get("distanceMeters") or sum(s["distance_meters"] for s in segments)), 2),
        "duration_seconds": _duration_to_seconds(route.get("duration")),
        "route_geometry": {
            "type": "LineString",
            "coordinates": route_coordinates,
        },
        "segments": segments,
    }


def _decode_polyline_value(encoded, index):
    result = 0
    shift = 0

    while True:
        byte = ord(encoded[index]) - 63
        index += 1
        result |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            break

    value = ~(result >> 1) if result & 1 else result >> 1
    return value, index


def _waypoint(lon, lat):
    return {
        "location": {
            "latLng": {
                "latitude": lat,
                "longitude": lon,
            }
        }
    }


def _lat_lng_to_lon_lat(location):
    lat_lng = (location or {}).get("latLng") or {}
    return {
        "lon": lat_lng.get("longitude"),
        "lat": lat_lng.get("latitude"),
    }


def _strip_html(value):
    if not value:
        return ""
    return unescape(re.sub(r"<[^>]+>", "", value)).strip()


def _duration_to_seconds(value):
    if not value:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    match = re.fullmatch(r"(\d+(?:\.\d+)?)s", value)
    return int(float(match.group(1))) if match else 0


def _bearing_from_coordinates(coordinates, start_location, end_location):
    if len(coordinates) >= 2:
        start = coordinates[0]
        end = coordinates[-1]
    elif start_location.get("lon") is not None and end_location.get("lon") is not None:
        start = [start_location["lon"], start_location["lat"]]
        end = [end_location["lon"], end_location["lat"]]
    else:
        return 0

    start_lon, start_lat = map(math.radians, start)
    end_lon, end_lat = map(math.radians, end)
    delta_lon = end_lon - start_lon
    x = math.sin(delta_lon) * math.cos(end_lat)
    y = math.cos(start_lat) * math.sin(end_lat) - math.sin(start_lat) * math.cos(end_lat) * math.cos(delta_lon)
    return round((math.degrees(math.atan2(x, y)) + 360) % 360, 2)


def _merge_segment_coordinates(segments):
    merged = []
    for segment in segments:
        for coordinate in segment["geometry"]["coordinates"]:
            if not merged or merged[-1] != coordinate:
                merged.append(coordinate)
    return merged
