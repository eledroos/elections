"""Tests for the documented-correction layer."""
import pytest

from pipeline import corrections as cx

SAMPLE = """
[[correction]]
id = "drop-one"
snapshot = "1200"
precinct = "0807"
action = "drop"
observed = 286
reason = "Ward 8 has six precincts."

[[correction]]
id = "set-one"
snapshot = "0900"
precinct = "0101"
action = "set"
observed = 119
value = 120
reason = "Department sent a revision."
"""

@pytest.fixture
def rules(tmp_path):
    path = tmp_path / "corrections.toml"
    path.write_text(SAMPLE)
    return cx.load(path)

def test_missing_file_yields_no_rules(tmp_path):
    assert cx.load(tmp_path / "absent.toml") == []

def test_drop_removes_the_precinct(rules):
    counts = {"0801": 286, "0807": 286}
    out, applied = cx.apply(counts, rules, snapshot="1200")
    assert "0807" not in out
    assert out["0801"] == 286
    assert [a.id for a in applied] == ["drop-one"]

def test_set_replaces_the_value(rules):
    counts = {"0101": 119}
    out, applied = cx.apply(counts, rules, snapshot="0900")
    assert out["0101"] == 120
    assert applied[0].effect == "119 -> 120"

def test_rules_only_touch_their_own_snapshot(rules):
    counts = {"0101": 119, "0807": 286}
    out, applied = cx.apply(counts, rules, snapshot="0900")
    assert out["0807"] == 286, "a 12:00 rule fired while reading 09:00"
    assert out["0101"] == 120
    assert [a.id for a in applied] == ["set-one"]

def test_observed_value_must_match_before_a_rule_applies(rules):
    # Guards against a correction silently rewriting a later, corrected file.
    counts = {"0807": 999}
    with pytest.raises(cx.CorrectionMismatch):
        cx.apply(counts, rules, snapshot="1200")

def test_dropping_an_absent_precinct_is_an_error(rules):
    with pytest.raises(cx.CorrectionMismatch):
        cx.apply({"0801": 286}, rules, snapshot="1200")
