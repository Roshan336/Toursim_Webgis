import json
import math
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


OPENROUTESERVICE_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car"


class OpenRouteServiceError(Exception):
    pass


class OpenRouteServiceConfigurationError(OpenRouteServiceError):
    pass


def get_openrouteservice_route(start_lon, start_lat, end_lon, end_lat):
    api_key = os.getenv("OPENROUTESERVICE_API_KEY")
    if not api_key:
        raise OpenRouteServiceConfigurationError("OPENROUTESERVICE_API_KEY is not configured.")

    query = urlencode(
        {
            "api_key": api_key,
            "start": f"{start_lon},{start_lat}",
            "end": f"{end_lon},{end_lat}",
        }
    )
    request = Request(f"{OPENROUTESERVICE_DIRECTIONS_URL}?{query}", method="GET")

    try:
        with urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise OpenRouteServiceError(f"openrouteservice returned HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise OpenRouteServiceError(f"openrouteservice request failed: {error.reason}") from error

    return openrouteservice_response_to_route(data)


def openrouteservice_response_to_route(data):
    features = data.get("features") or []
    if not features:
        raise OpenRouteServiceError("openrouteservice returned no routes.")

    feature = features[0]
    coordinates = (feature.get("geometry") or {}).get("coordinates") or []
    properties = feature.get("properties") or {}
    summary = properties.get("summary") or {}
    steps = []

    for segment in properties.get("segments") or []:
        steps.extend(segment.get("steps") or [])

    route_segments = []
    for index, step in enumerate(steps, start=1):
        step_coordinates = _step_coordinates(coordinates, step)
        start_location = _coordinate_to_location(step_coordinates[0]) if step_coordinates else {"lon": None, "lat": None}
        end_location = _coordinate_to_location(step_coordinates[-1]) if step_coordinates else {"lon": None, "lat": None}
        instruction = step.get("instruction") or step.get("name") or "Continue"

        route_segments.append(
            {
                "seq": index,
                "name": step.get("name") or instruction,
                "instruction": instruction,
                "maneuver": f"ORS_{step.get('type', '')}",
                "distance_meters": round(float(step.get("distance") or 0), 2),
                "duration_seconds": round(float(step.get("duration") or 0)),
                "start_location": start_location,
                "end_location": end_location,
                "bearing": _bearing_from_coordinates(step_coordinates),
                "geometry": {
                    "type": "LineString",
                    "coordinates": step_coordinates,
                },
            }
        )

    return {
        "status": "success",
        "provider": "openrouteservice",
        "total_distance_meters": round(float(summary.get("distance") or sum(s["distance_meters"] for s in route_segments)), 2),
        "duration_seconds": round(float(summary.get("duration") or sum(s["duration_seconds"] for s in route_segments))),
        "route_geometry": {
            "type": "LineString",
            "coordinates": coordinates,
        },
        "segments": route_segments,
    }


def _step_coordinates(route_coordinates, step):
    way_points = step.get("way_points") or []
    if len(way_points) != 2:
        return []

    start_index, end_index = way_points
    return route_coordinates[start_index : end_index + 1]


def _coordinate_to_location(coordinate):
    return {"lon": coordinate[0], "lat": coordinate[1]}


def _bearing_from_coordinates(coordinates):
    if len(coordinates) < 2:
        return 0

    start = coordinates[0]
    end = coordinates[-1]
    start_lon, start_lat = map(math.radians, start)
    end_lon, end_lat = map(math.radians, end)
    delta_lon = end_lon - start_lon
    x = math.sin(delta_lon) * math.cos(end_lat)
    y = math.cos(start_lat) * math.sin(end_lat) - math.sin(start_lat) * math.cos(end_lat) * math.cos(delta_lon)
    return round((math.degrees(math.atan2(x, y)) + 360) % 360, 2)
