"""Tests for boundary preparation."""
from pipeline import boundaries as b
from pipeline.paths import REPO

SOURCE = REPO / "reference" / "boundaries" / "boston_precinct_boundaries.geojson"

def test_loads_every_precinct():
    fc = b.prepare(SOURCE)
    assert len(fc["features"]) == 275

def test_feature_ids_are_ward_and_precinct():
    fc = b.prepare(SOURCE)
    ids = {f["properties"]["id"] for f in fc["features"]}
    assert "0101" in ids and "2213" in ids

def test_carries_ward_and_precinct_numbers_for_labels():
    fc = b.prepare(SOURCE)
    one = next(f for f in fc["features"] if f["properties"]["id"] == "0806")
    assert one["properties"]["ward"] == 8
    assert one["properties"]["precinct"] == 6


def test_ward_eight_stops_at_precinct_six():
    """The city's own map is what proves the 12:00 file holds a phantom."""
    ids = {f["properties"]["id"] for f in b.prepare(SOURCE)["features"]}
    assert "0806" in ids
    assert "0807" not in ids

def test_rounding_keeps_shared_edges_shared():
    """Neighbouring precincts must not drift apart into visible slivers."""
    import collections
    import json

    raw = json.loads(SOURCE.read_text())
    fc = b.prepare(SOURCE)

    def shared(collection, key):
        counter = collections.Counter()
        for feature in collection["features"]:
            for ring in feature["geometry"]["coordinates"]:
                for point in ring:
                    counter[tuple(point)] += 1
        return sum(1 for n in counter.values() if n > 1)

    before, after = shared(raw, None), shared(fc, None)
    assert after >= before * 0.99

def test_drops_the_precision_the_map_cannot_show():
    fc = b.prepare(SOURCE)
    point = fc["features"][0]["geometry"]["coordinates"][0][0]
    assert len(str(point[0]).split(".")[-1]) <= 5

def test_mainland_bounds_exclude_the_harbor_islands():
    fc = b.prepare(SOURCE)
    west, south, east, north = b.bounds(fc, exclude={"0115"})
    assert east < -70.95, "harbor islands still stretching the default view"
    assert -71.2 < west < -71.0 and 42.2 < south < 42.3
