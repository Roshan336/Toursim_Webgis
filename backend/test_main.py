import unittest
import asyncio
from unittest.mock import patch

from backend.main import app


def call_asgi_get(path, origin):
    messages = []
    sent_request = False
    path_only, _, query_string = path.partition("?")

    async def receive():
        nonlocal sent_request
        if not sent_request:
            sent_request = True
            return {"type": "http.request", "body": b"", "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path_only,
        "raw_path": path_only.encode("ascii"),
        "query_string": query_string.encode("ascii"),
        "headers": [
            (b"host", b"testserver"),
            (b"origin", origin.encode("ascii")),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "root_path": "",
    }

    asyncio.run(app(scope, receive, send))

    start = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(
        message.get("body", b"")
        for message in messages
        if message["type"] == "http.response.body"
    )
    headers = {
        key.decode("latin-1"): value.decode("latin-1")
        for key, value in start["headers"]
    }
    return start["status"], headers, body


class ApiResponseMiddlewareTests(unittest.TestCase):
    def test_get_pois_allows_vite_dev_origin_after_successful_handler(self):
        payload = {"type": "FeatureCollection", "features": []}

        with patch("backend.main.get_all_pois", return_value=payload):
            status, headers, body = call_asgi_get("/api/pois", "http://localhost:5174")

        self.assertEqual(status, 200)
        self.assertEqual(body, b'{"type":"FeatureCollection","features":[]}')
        self.assertEqual(
            headers["access-control-allow-origin"],
            "http://localhost:5174",
        )

    def test_route_uses_google_routes_provider_before_pgrouting(self):
        google_payload = {
            "status": "success",
            "provider": "google_routes",
            "total_distance_meters": 100,
            "duration_seconds": 30,
            "route_geometry": {"type": "LineString", "coordinates": [[85.3, 27.7], [85.31, 27.71]]},
            "segments": [],
        }

        with patch("backend.main.get_google_route", return_value=google_payload, create=True) as google_route:
            with patch("backend.main.get_route") as pgrouting_route:
                status, headers, body = call_asgi_get(
                    "/api/route?start_lon=85.3&start_lat=27.7&end_lon=85.31&end_lat=27.71",
                    "http://localhost:5174",
                )

        self.assertEqual(status, 200)
        self.assertIn(b'"provider":"google_routes"', body)
        google_route.assert_called_once_with(85.3, 27.7, 85.31, 27.71)
        pgrouting_route.assert_not_called()

    def test_route_uses_openrouteservice_when_configured(self):
        ors_payload = {
            "status": "success",
            "provider": "openrouteservice",
            "total_distance_meters": 100,
            "duration_seconds": 30,
            "route_geometry": {"type": "LineString", "coordinates": [[8.681495, 49.41461], [8.687872, 49.420318]]},
            "segments": [],
        }
        env = {
            "ROUTING_PROVIDER": "openrouteservice",
            "OPENROUTESERVICE_API_KEY": "test-key",
        }

        with patch.dict("os.environ", env, clear=True):
            with patch("backend.main.get_openrouteservice_route", return_value=ors_payload, create=True) as ors_route:
                with patch("backend.main.get_google_route") as google_route:
                    with patch("backend.main.get_route") as pgrouting_route:
                        status, headers, body = call_asgi_get(
                            "/api/route?start_lon=8.681495&start_lat=49.41461&end_lon=8.687872&end_lat=49.420318",
                            "http://localhost:5174",
                        )

        self.assertEqual(status, 200)
        self.assertIn(b'"provider":"openrouteservice"', body)
        ors_route.assert_called_once_with(8.681495, 49.41461, 8.687872, 49.420318)
        google_route.assert_not_called()
        pgrouting_route.assert_not_called()


if __name__ == "__main__":
    unittest.main()
