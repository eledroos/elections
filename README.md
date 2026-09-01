# Elections

Turnout and results data, prepared for the web. One folder for each election.

The site is static. A build step reads the files an elections department sends.
It checks them, then writes the JSON that the page reads. Cloudflare Pages
serves the `site/` folder and runs no build of its own.

## Publish on Cloudflare Pages

Connect this repository, then use these settings:

| Setting                | Value  |
| ---------------------- | ------ |
| Framework preset       | None   |
| Build command          | *leave empty* |
| Build output directory | `site` |
| Root directory         | `/`    |

The generated data is committed, so a deploy needs no Python and cannot fail on
a dependency. To publish new figures, add the file, run `make`, and push.

## Add new turnout figures

1. Put the workbook in `elections/<election-id>/sources/boston/`.
2. Add a `[[snapshot]]` block to `elections/<election-id>/election.toml`.
   Copy the last block and change the four values.
3. Run `make`.
4. Commit the source file and the changed files in `site/data/`, then push.

`make` stops and writes nothing if a check fails. See "Checks" below.

## Add a new election

Make a folder under `elections/` with this shape:

```
elections/<election-id>/
    election.toml        name, date, jurisdiction, boundary file, snapshots
    corrections.toml     changes to published figures, each with a reason
    sources/             the files as the department sent them
```

Then run `make`. The site finds every election through `site/data/elections.json`
and shows a chooser when there is more than one.

## Commands

| Command       | Result |
| ------------- | ------ |
| `make`        | Reads the sources, checks them, writes `site/data/` |
| `make test`   | Runs the pipeline tests against the real source files |
| `make serve`  | Builds, then serves the site at `http://localhost:8788` |
| `make check`  | Runs the tests and the build |
| `make clean`  | Removes `site/data/` |

Python 3.11 or later. Install the two dependencies with
`pip install -r pipeline/requirements.txt`.

## Continuous integration

`.github/workflows/check.yml` runs the tests on every push. It then rebuilds
the site data and fails if the result differs from what the commit holds.
That check catches a source file added without a rebuild, because Cloudflare
Pages serves the committed files and would publish the old figures.

## Checks

The build stops if a source file holds any of these:

- a precinct that the city boundary file does not have;
- a precinct on the map that no snapshot reports;
- a ward total that is not the sum of its precincts;
- more ballots than the precinct has registered voters;
- a turnout figure that falls between one snapshot and a later one;
- a registered-voter count that changes during election day.

A check that fails names the precinct and the file. Correct the source file, or
write a correction that says what changed and why.

## Corrections

`corrections.toml` holds every deliberate change to a published figure. Each
entry gives the value it expects to find. If the department sends a revised
file, the build stops instead of changing the new figure. The site shows the
list as numbered notes. A number appears beside each figure the change affects.

## Where the data comes from

- **Turnout**: the Boston Election Department, as workbooks through election day.
- **Precinct boundaries**: [Boston Precinct Boundaries](https://data.boston.gov/dataset/boston-precinct-boundaries),
  City of Boston, Open Data Commons PDDL.
- **Registered voters**: the count divided by the percentage, both of which
  each workbook gives. Every workbook gives the same answer. That agreement is
  the check that the method is correct.

## Layout

```
pipeline/     reads the sources, checks them, writes the site data
elections/    one folder for each election: sources, config, corrections
reference/    boundary files, kept as downloaded
site/         what Cloudflare Pages serves
```
