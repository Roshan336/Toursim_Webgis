import os
import unittest
from unittest.mock import patch

from backend.openrouteservice import (
    OpenRouteServiceConfigurationError,
    get_openrouteservice_route,
    openrouteservice_response_to_route,
)


class OpenRouteServiceConversionTests(unittest.TestCase):
    def test_converts_directions_response_to_existing_route_shape(self):
        response = {
            "features": [
                {
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [
                            [8.681495, 49.41461],
                            [8.683, 49.416],
                            [8.687872, 49.420318],
                        ],
                    },
                    "properties": {
                        "summary": {"distance": 1420.5, "duration": 310.2},
                        "segments": [
                            {
                                "distance": 1420.5,
                                "duration": 310.2,
                                "steps": [
                                    {
                                        "distance": 450.0,
                                        "duration": 80.0,
                                        "type": 11,
                                        "instruction": "Head north on Berliner Strasse",
                                        "name": "Berliner Strasse",
                                        "way_points": [0, 1],
                                    },
                                    {
                                        "distance": 970.5,
                                        "duration": 230.2,
                                        "type": 1,
                                        "instruction": "Turn right onto Hauptstrasse",
                                        "name": "Hauptstrasse",
                                        "way_points": [1, 2],
                                    },
                                ],
                            }
                        ],
                    },
                }
            ]
        }

        route = openrouteservice_response_to_route(response)

        self.assertEqual(route["status"], "success")
        self.assertEqual(route["provider"], "openrouteservice")
        self.assertEqual(route["total_distance_meters"], 1420.5)
        self.assertEqual(route["duration_seconds"], 310)
        self.assertEqual(route["route_geometry"]["coordinates"][0], [8.681495, 49.41461])
        self.assertEqual(len(route["segments"]), 2)
        self.assertEqual(route["segments"][0]["instruction"], "Head north on Berliner Strasse")
        self.assertEqual(route["segments"][0]["start_location"], {"lon": 8.681495, "lat": 49.41461})
        self.assertEqual(route["segments"][1]["end_location"], {"lon": 8.687872, "lat": 49.420318})
        self.assertGreater(route["segments"][1]["bearing"], 0)

    def test_get_openrouteservice_route_requires_api_key(self):
        env = {key: value for key, value in os.environ.items() if key != "OPENROUTESERVICE_API_KEY"}

        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(OpenRouteServiceConfigurationError):
                get_openrouteservice_route(8.681495, 49.41461, 8.687872, 49.420318)


if __name__ == "__main__":
    unittest.main()
