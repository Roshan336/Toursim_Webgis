import os
import unittest
from unittest.mock import patch

from backend.google_routes import (
    GoogleRouteConfigurationError,
    decode_polyline,
    google_routes_response_to_route,
    get_google_route,
)


class GoogleRoutesConversionTests(unittest.TestCase):
    def test_decode_polyline_returns_lon_lat_pairs(self):
        self.assertEqual(
            decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"),
            [
                [-120.2, 38.5],
                [-120.95, 40.7],
                [-126.453, 43.252],
            ],
        )

    def test_converts_compute_routes_response_to_existing_route_shape(self):
        response = {
            "routes": [
                {
                    "distanceMeters": 120,
                    "duration": "45s",
                    "polyline": {"encodedPolyline": "??_pR_pR"},
                    "legs": [
                        {
                            "steps": [
                                {
                                    "distanceMeters": 50,
                                    "duration": "20s",
                                    "polyline": {"encodedPolyline": "??_ibE_ibE"},
                                    "startLocation": {"latLng": {"latitude": 0, "longitude": 0}},
                                    "endLocation": {"latLng": {"latitude": 0.01, "longitude": 0.01}},
                                    "navigationInstruction": {
                                        "maneuver": "TURN_LEFT",
                                        "instructions": "Turn left onto Main Street",
                                    },
                                },
                                {
                                    "distanceMeters": 70,
                                    "duration": "25s",
                                    "polyline": {"encodedPolyline": "_ibE_ibE_ibE_ibE"},
                                    "startLocation": {"latLng": {"latitude": 0.01, "longitude": 0.01}},
                                    "endLocation": {"latLng": {"latitude": 0.02, "longitude": 0.02}},
                                    "navigationInstruction": {
                                        "maneuver": "STRAIGHT",
                                        "instructions": "Continue on Main Street",
                                    },
                                },
                            ]
                        }
                    ],
                }
            ]
        }

        route = google_routes_response_to_route(response)

        self.assertEqual(route["status"], "success")
        self.assertEqual(route["provider"], "google_routes")
        self.assertEqual(route["total_distance_meters"], 120)
        self.assertEqual(route["duration_seconds"], 45)
        self.assertEqual(len(route["segments"]), 2)
        self.assertEqual(route["segments"][0]["instruction"], "Turn left onto Main Street")
        self.assertEqual(route["segments"][0]["maneuver"], "TURN_LEFT")
        self.assertEqual(route["segments"][0]["geometry"]["type"], "LineString")
        self.assertEqual(route["segments"][0]["start_location"], {"lon": 0, "lat": 0})
        self.assertEqual(route["segments"][1]["end_location"], {"lon": 0.02, "lat": 0.02})
        self.assertGreater(route["segments"][0]["bearing"], 0)
        self.assertEqual(route["route_geometry"]["type"], "LineString")

    def test_get_google_route_requires_api_key(self):
        env = {key: value for key, value in os.environ.items() if key != "GOOGLE_MAPS_API_KEY"}

        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(GoogleRouteConfigurationError):
                get_google_route(85.3, 27.7, 85.31, 27.71)


if __name__ == "__main__":
    unittest.main()
