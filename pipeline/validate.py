"""Checks that stop wrong figures reaching the site.

Every check raises on failure. The build stops. Nothing publishes until a
person reads the message and decides what to do, either by fixing the source
file or by writing a correction that says what changed and why.
"""
from __future__ import annotations

REGISTRATION_TOLERANCE = 1

class ValidationError(Exception):
    """A source file holds something the site must not publish."""

def check_ward_totals(counts: dict[str, int], stated: dict[int, int], snapshot: str) -> None:
    """The sum of a ward's precincts must equal the total the file states."""
    for ward, total in stated.items():
        summed = sum(v for k, v in counts.items() if int(k[:2]) == ward)
        if summed != total:
            raise ValidationError(
                f"snapshot {snapshot}: ward {ward} precincts add to {summed}, "
                f"but the file states {total}"
            )

def check_precincts_exist(counts: dict[str, int], boundary_ids: set[str], snapshot: str) -> None:
    """Every precinct in the file must exist on the city's own map."""
    unknown = sorted(set(counts) - set(boundary_ids))
    if unknown:
        raise ValidationError(
            f"snapshot {snapshot}: precinct(s) {', '.join(unknown)} are not in the "
            f"boundary file. Either the boundaries are out of date, or the source "
            f"file holds an error. Write a correction to publish anyway."
        )

def check_boundaries_covered(counts: dict[str, int], boundary_ids: set[str]) -> None:
    """Every precinct on the map must appear in the figures."""
    missing = sorted(set(boundary_ids) - set(counts))
    if missing:
        raise ValidationError(
            f"precinct(s) {', '.join(missing)} exist on the map but no snapshot "
            f"reports them"
        )

def check_within_registration(
    counts: dict[str, int], registered: dict[str, int], snapshot: str
) -> None:
    """A precinct cannot cast more ballots than it has registered voters."""
    for identifier, count in counts.items():
        total = registered.get(identifier)
        if total is not None and count > total:
            raise ValidationError(
                f"snapshot {snapshot}: precinct {identifier} reports {count} "
                f"ballots from {total} registered voters"
            )

def check_monotonic(snapshots: list[dict]) -> None:
    """Turnout can only rise as the day goes on."""
    for earlier, later in zip(snapshots, snapshots[1:]):
        for identifier, count in later["counts"].items():
            before = earlier["counts"].get(identifier)
            if before is not None and count < before:
                raise ValidationError(
                    f"precinct {identifier} falls from {before} ballots at "
                    f"{earlier['id']} to {count} at {later['id']}"
                )

def check_registration_agrees(derived: list[tuple[str, dict[str, int]]]) -> None:
    """Registered voters must not move between snapshots of one election day."""
    if len(derived) < 2:
        return
    first_id, first = derived[0]
    for snapshot_id, other in derived[1:]:
        for identifier in set(first) & set(other):
            if abs(first[identifier] - other[identifier]) > REGISTRATION_TOLERANCE:
                raise ValidationError(
                    f"precinct {identifier} has {first[identifier]} registered "
                    f"voters at {first_id} but {other[identifier]} at {snapshot_id}"
                )
