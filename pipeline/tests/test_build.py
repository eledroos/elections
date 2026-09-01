"""Tests for the whole build, and for what it leaves behind."""
import json

import pytest

from pipeline import build
from pipeline.paths import ELECTIONS, SITE_DATA

ELECTION = "2026-09-01-ma-state-primary"


@pytest.fixture(scope="module")
def built():
    build.main()
    return json.loads((SITE_DATA / ELECTION / "turnout.json").read_text())


def test_writes_an_index_of_every_election(built):
    index = json.loads((SITE_DATA / "elections.json").read_text())
    ids = [entry["id"] for entry in index["elections"]]
    assert ELECTION in ids
    assert len(ids) == len([d for d in ELECTIONS.iterdir() if (d / "election.toml").exists()])


def test_totals_come_out_corrected(built):
    noon = [s for s in built["snapshots"] if s["id"] == "1200"][0]
    assert noon["total"] == 48366, "the phantom Ward 8 precinct is still counted"
    assert "0807" not in noon["counts"]
    assert sum(v for k, v in noon["counts"].items() if k.startswith("08")) == 842


def test_records_every_correction_it_applied(built):
    assert [c["id"] for c in built["corrections"]] == ["w08p07-1200-phantom-precinct"]
    assert built["corrections"][0]["effect"] == "286 ballots removed"


def test_registered_voters_reconcile(built):
    assert built["registeredTotal"] == 438070
    assert len(built["registered"]) == 274


def test_opening_view_leaves_out_the_harbor_islands(built):
    assert built["bounds"][2] < -70.95


def test_snapshots_come_out_in_time_order(built):
    times = [s["time"] for s in built["snapshots"]]
    assert times == sorted(times)


def test_removes_data_for_an_election_that_no_longer_exists(tmp_path):
    orphan = SITE_DATA / "0000-00-00-not-an-election"
    orphan.mkdir(parents=True, exist_ok=True)
    (orphan / "turnout.json").write_text("{}")

    build.main()

    assert not orphan.exists(), "stale data would still be published"
    assert (SITE_DATA / ELECTION / "turnout.json").exists()
