"""Prepare precinct outlines for the map.

The city publishes coordinates to fourteen decimal places, which is a fraction
of a millimetre. The map cannot show that. Rounding to five places keeps about
one metre of precision and makes the file small enough for a phone.

Rounding is safe here because neighbouring precincts share their vertices
exactly in the source. Identical numbers round identically, so shared edges
stay shared and no gaps open between precincts.
"""
from __future__ import annotations

import json
from pathlib import Path

PLACES = 5
HARBOR_ISLANDS = "0115"

def _round(node, places: int):
    if isinstance(node, list):
        return [_round(item, places) for item in node]
    return round(node, places)

def prepare(source: Path, places: int = PLACES) -> dict:
    """Return a small GeoJSON collection keyed by ward and precinct."""
    raw = json.loads(Path(source).read_text())
    features = []
    for feature in raw["features"]:
        properties = feature["properties"]
        ward = int(properties["Ward1"])
        precinct = int(properties["Precinct1"])
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": f"{ward:02d}{precinct:02d}",
                    "ward": ward,
                    "precinct": precinct,
                },
                "geometry": {
                    "type": feature["geometry"]["type"],
                    "coordinates": _round(feature["geometry"]["coordinates"], places),
                },
            }
        )
    features.sort(key=lambda f: f["properties"]["id"])
    return {"type": "FeatureCollection", "features": features}

def ids(collection: dict) -> set[str]:
    return {f["properties"]["id"] for f in collection["features"]}

def bounds(collection: dict, exclude: set[str] | None = None) -> list[float]:
    """Return west, south, east, north for the map's opening view.

    Precincts in ``exclude`` still draw, but do not stretch the view. The
    harbor islands sit far offshore and would otherwise push the city into a
    corner of the screen.
    """
    exclude = exclude or set()
    points = [
        point
        for feature in collection["features"]
        if feature["properties"]["id"] not in exclude
        for ring in feature["geometry"]["coordinates"]
        for point in ring
    ]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]
