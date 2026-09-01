"""Apply and record deliberate changes to the figures a source file holds.

Every change to a published number goes through this module, and every change
carries a reason. The site shows the list. A correction that no longer matches
its source raises an error rather than changing a number quietly, so a revised
file from the department cannot be rewritten by an old rule.
"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

DROP = "drop"
SET = "set"

class CorrectionMismatch(Exception):
    """A rule no longer describes the data it was written for."""

@dataclass(frozen=True)
class Correction:
    id: str
    snapshot: str
    precinct: str
    action: str
    observed: int
    reason: str
    value: int | None = None
    effect: str = ""

    def with_effect(self, effect: str) -> "Correction":
        return Correction(
            id=self.id,
            snapshot=self.snapshot,
            precinct=self.precinct,
            action=self.action,
            observed=self.observed,
            reason=self.reason,
            value=self.value,
            effect=effect,
        )

def load(path: Path) -> list[Correction]:
    if not Path(path).exists():
        return []
    data = tomllib.loads(Path(path).read_text())
    return [
        Correction(
            id=item["id"],
            snapshot=str(item["snapshot"]),
            precinct=str(item["precinct"]),
            action=item["action"],
            observed=int(item["observed"]),
            reason=" ".join(item["reason"].split()),
            value=item.get("value"),
        )
        for item in data.get("correction", [])
    ]

def apply(
    counts: dict[str, int], rules: list[Correction], snapshot: str
) -> tuple[dict[str, int], list[Correction]]:
    """Return corrected counts and the rules that changed something."""
    out = dict(counts)
    applied: list[Correction] = []

    for rule in rules:
        if rule.snapshot != snapshot:
            continue
        present = out.get(rule.precinct)
        if present is None:
            raise CorrectionMismatch(
                f"correction {rule.id!r} expects precinct {rule.precinct} "
                f"in snapshot {snapshot}, which does not hold it"
            )
        if present != rule.observed:
            raise CorrectionMismatch(
                f"correction {rule.id!r} expects {rule.observed} in precinct "
                f"{rule.precinct}, but the file now says {present}. "
                f"Read the new file before you change this rule."
            )
        if rule.action == DROP:
            del out[rule.precinct]
            applied.append(rule.with_effect(f"{present} ballots removed"))
        elif rule.action == SET:
            out[rule.precinct] = int(rule.value)
            applied.append(rule.with_effect(f"{present} -> {rule.value}"))
        else:
            raise CorrectionMismatch(f"correction {rule.id!r} has unknown action {rule.action!r}")

    return out, applied
