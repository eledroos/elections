"""Turn source files into the data the site reads.

Run `make` to use this. It reads every election under elections/, checks each
one, applies the corrections, and writes site/data/. It writes nothing if any
check fails.
"""
from __future__ import annotations

import json
import sys
import tomllib
from pathlib import Path

from pipeline import boston_turnout as bt
from pipeline import boundaries as geo
from pipeline import corrections as cx
from pipeline import validate as v
from pipeline.paths import ELECTIONS, REPO, SITE_DATA

def _write_json(path: Path, payload) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text)
    return len(text.encode())

def build_election(directory: Path) -> dict:
    config = tomllib.loads((directory / "election.toml").read_text())
    election_id = config["id"]
    sources = directory / "sources"

    collection = geo.prepare(REPO / config["boundaries"]["file"])
    boundary_ids = geo.ids(collection)

    rules = cx.load(directory / "corrections.toml")
    snapshots: list[dict] = []
    registration_by_snapshot: list[tuple[str, dict[str, int]]] = []
    applied_all: list[cx.Correction] = []

    for entry in config["snapshot"]:
        parsed = bt.parse_workbook(
            sources / entry["file"],
            counts_sheet=entry.get("counts_sheet", 0),
            percent_sheet=entry.get("percent_sheet", 1),
        )
        # Check the file against itself before changing anything.
        v.check_ward_totals(parsed.counts, parsed.stated_ward_totals, entry["id"])

        counts, applied = cx.apply(parsed.counts, rules, snapshot=entry["id"])
        applied_all.extend(applied)

        v.check_precincts_exist(counts, boundary_ids, entry["id"])
        registered = {k: n for k, n in bt.derive_registration(parsed).items() if k in counts}
        v.check_within_registration(counts, registered, entry["id"])
        registration_by_snapshot.append((entry["id"], registered))

        snapshots.append(
            {
                "id": entry["id"],
                "label": entry["label"],
                "time": entry["time"],
                "source": Path(entry["file"]).name,
                "counts": counts,
                "total": sum(counts.values()),
            }
        )

    v.check_registration_agrees(registration_by_snapshot)
    v.check_monotonic(snapshots)

    registered: dict[str, int] = {}
    for _, found in registration_by_snapshot:
        registered.update(found)

    latest = snapshots[-1]["counts"] if snapshots else {}
    v.check_boundaries_covered({**{k: 0 for k in registered}, **latest}, boundary_ids)

    payload = {
        "id": election_id,
        "name": config["name"],
        "date": config["date"],
        "jurisdiction": config["jurisdiction"],
        "timezone": config["timezone"],
        "source": config["source"],
        "boundaries": {
            k: config["boundaries"][k]
            for k in ("title", "publisher", "url", "license", "retrieved")
        },
        "registered": registered,
        "registeredTotal": sum(registered.values()),
        "bounds": geo.bounds(collection, exclude={geo.HARBOR_ISLANDS}),
        "snapshots": snapshots,
        "corrections": [
            {
                "id": c.id,
                "snapshot": c.snapshot,
                "precinct": c.precinct,
                "action": c.action,
                "observed": c.observed,
                "value": c.value,
                "effect": c.effect,
                "reason": c.reason,
            }
            for c in applied_all
        ],
    }

    out = SITE_DATA / election_id
    turnout_bytes = _write_json(out / "turnout.json", payload)
    geo_bytes = _write_json(out / "precincts.geojson", collection)

    return {
        "id": election_id,
        "name": config["name"],
        "date": config["date"],
        "jurisdiction": config["jurisdiction"],
        "snapshots": len(snapshots),
        "latest": snapshots[-1]["label"] if snapshots else None,
        "_bytes": turnout_bytes + geo_bytes,
        "_precincts": len(boundary_ids),
        "_corrections": len(applied_all),
    }

def main() -> int:
    directories = sorted(d for d in ELECTIONS.iterdir() if (d / "election.toml").exists())
    if not directories:
        print("no elections found under elections/", file=sys.stderr)
        return 1

    index = []
    for directory in directories:
        try:
            summary = build_election(directory)
        except (v.ValidationError, cx.CorrectionMismatch) as error:
            print(f"\n  STOPPED on {directory.name}\n  {error}\n", file=sys.stderr)
            return 1
        print(
            f"  {summary['id']}: {summary['_precincts']} precincts, "
            f"{summary['snapshots']} snapshots, {summary['_corrections']} corrections, "
            f"{summary['_bytes'] / 1024:.0f} KB"
        )
        index.append({k: val for k, val in summary.items() if not k.startswith("_")})

    index.sort(key=lambda e: e["date"], reverse=True)
    _write_json(SITE_DATA / "elections.json", {"elections": index})
    print(f"  wrote site/data/elections.json ({len(index)} election(s))")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
