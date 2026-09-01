"""Tests for the checks that stop bad data reaching the site."""
import pytest

from pipeline import validate as v

BOUNDARY_IDS = {"0101", "0102", "0801"}

def test_accepts_clean_data():
    v.check_precincts_exist({"0101": 5}, BOUNDARY_IDS, snapshot="0900")

def test_rejects_a_precinct_with_no_boundary():
    with pytest.raises(v.ValidationError) as err:
        v.check_precincts_exist({"0807": 286}, BOUNDARY_IDS, snapshot="1200")
    assert "0807" in str(err.value)

def test_reports_boundaries_that_no_snapshot_covers():
    with pytest.raises(v.ValidationError) as err:
        v.check_boundaries_covered({"0101": 5}, BOUNDARY_IDS)
    assert "0102" in str(err.value)

def test_rejects_turnout_above_registration():
    with pytest.raises(v.ValidationError):
        v.check_within_registration({"0101": 900}, {"0101": 800}, snapshot="0900")

def test_allows_turnout_equal_to_registration():
    v.check_within_registration({"0101": 800}, {"0101": 800}, snapshot="0900")

def test_rejects_turnout_falling_between_snapshots():
    earlier = {"id": "0900", "counts": {"0101": 100}}
    later = {"id": "1200", "counts": {"0101": 90}}
    with pytest.raises(v.ValidationError) as err:
        v.check_monotonic([earlier, later])
    assert "0101" in str(err.value)

def test_allows_turnout_holding_steady():
    v.check_monotonic([
        {"id": "0900", "counts": {"0101": 100}},
        {"id": "1200", "counts": {"0101": 100}},
    ])

def test_rejects_disagreeing_registration_between_snapshots():
    with pytest.raises(v.ValidationError):
        v.check_registration_agrees([
            ("0900", {"0101": 1638}),
            ("1200", {"0101": 1700}),
        ])

def test_tolerates_one_voter_of_rounding_drift():
    v.check_registration_agrees([
        ("0900", {"0101": 1638}),
        ("1200", {"0101": 1639}),
    ])


def test_checks_a_precinct_that_only_appears_in_later_snapshots():
    """A precinct absent from the first file must still be checked."""
    with pytest.raises(v.ValidationError) as err:
        v.check_registration_agrees([
            ("0900", {"0101": 1638}),
            ("1200", {"0101": 1638, "0102": 900}),
            ("1600", {"0101": 1638, "0102": 400}),
        ])
    assert "0102" in str(err.value)
    assert "1200" in str(err.value) and "1600" in str(err.value)
