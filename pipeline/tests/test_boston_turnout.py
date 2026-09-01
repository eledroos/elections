"""Tests for the Boston ward-and-precinct workbook parser.

These run against the real files in elections/, not fixtures, so a change in
the format the elections department sends will fail here first.
"""
import math
import pytest

from pipeline import boston_turnout as bt
from pipeline.paths import election_dir

SOURCES = election_dir("2026-09-01-ma-state-primary") / "sources" / "boston"
NINE = SOURCES / "900 turnout for September 1, 2026.xlsx"
TWELVE = SOURCES / "1200 turnout for September 1, 2026.xlsx"

@pytest.fixture(scope="module")
def nine():
    return bt.parse_workbook(NINE, counts_sheet=0, percent_sheet=1)

@pytest.fixture(scope="module")
def twelve():
    return bt.parse_workbook(TWELVE, counts_sheet=0, percent_sheet=1)

def test_parses_every_precinct(nine):
    assert len(nine.counts) == 275

def test_keys_are_zero_padded_ward_precinct(nine):
    assert "0101" in nine.counts
    assert "2213" in nine.counts
    assert all(len(k) == 4 and k.isdigit() for k in nine.counts)

def test_reads_known_counts(nine, twelve):
    assert nine.counts["0101"] == 119
    assert nine.counts["2006"] == 357
    assert twelve.counts["0101"] == 148
    assert twelve.counts["1823"] == 112

def test_ward_totals_reconcile_with_precinct_sums(nine, twelve):
    for parsed in (nine, twelve):
        for ward, stated in parsed.stated_ward_totals.items():
            summed = sum(v for k, v in parsed.counts.items() if int(k[:2]) == ward)
            assert summed == stated, f"ward {ward}"

def test_citywide_total_matches_file(nine, twelve):
    assert nine.stated_citywide == 33495
    assert twelve.stated_citywide == 48652

def test_registration_derives_from_count_over_percent(nine):
    # 119 ballots at 7.264957...% is 1638 registered voters.
    assert bt.derive_registration(nine)["0101"] == 1638

def test_registration_agrees_between_snapshots(nine, twelve):
    a, b = bt.derive_registration(nine), bt.derive_registration(twelve)
    shared = set(a) & set(b)
    assert len(shared) > 250
    for key in shared:
        assert abs(a[key] - b[key]) <= 1, key

def test_precinct_without_registered_voters_derives_nothing(nine):
    # Ward 1 Precinct 15 covers the harbor islands and records no voters.
    assert nine.counts["0115"] == 0
    assert "0115" not in bt.derive_registration(nine)

def test_percent_cells_holding_spreadsheet_errors_are_ignored(twelve):
    assert twelve.percents.get("0115") is None

def test_twelve_oclock_file_contains_the_phantom_precinct(twelve):
    # Ward 8 has six precincts. This proves the parser reports what the file
    # says, and leaves the judgement to corrections.
    assert twelve.counts["0807"] == 286
