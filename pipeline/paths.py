"""Locations inside the repository."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ELECTIONS = REPO / "elections"
SITE_DATA = REPO / "site" / "data"
BOUNDARIES = REPO / "reference" / "boundaries"


def election_dir(election_id: str) -> Path:
    return ELECTIONS / election_id
