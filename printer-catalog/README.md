# Printer catalog

PrintHub ships a generated offline catalog so self-hosted installations never depend on third-party services at runtime.

## Sources

- OrcaSlicer supplies filament printer models, usable build dimensions, and available cover images.
- UVtools supplies resin printer models and usable build dimensions.

Source repositories and pinned revisions live in `sources.json`. Brand normalization, exclusions, and corrections live in `overrides.json` so upstream data remains reproducible while local curation stays explicit.

## Synchronizing

Run `pnpm catalog:sync` to regenerate from the pinned revisions. Run `pnpm catalog:update` to advance both sources to their latest configured branches and regenerate the catalog.

The generated catalog is committed at `catalog.generated.json`. Redistributable cover images are committed under `public/printer-presets/`. The application reads only these local files.

`pnpm catalog:check` validates the committed snapshot without network access and runs as part of `pnpm check`.
