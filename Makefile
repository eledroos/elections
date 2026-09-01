# Build the site data from the source files, then check and serve it.
.PHONY: all ingest test serve clean check

PY := python3
PORT ?= 8788

all: ingest

## ingest: read elections/*/sources, check them, write site/data
ingest:
	@$(PY) -m pipeline.build

## test: run the pipeline tests against the real source files
test:
	@$(PY) -m pytest pipeline/tests -q

## check: everything CI would run
check: test ingest

## serve: preview the site at http://localhost:8788
serve: ingest
	@echo "Serving site/ on http://localhost:$(PORT)  (ctrl-c to stop)"
	@cd site && $(PY) -m http.server $(PORT)

## clean: remove generated site data
clean:
	@rm -rf site/data
	@echo "removed site/data — run make ingest to rebuild"
