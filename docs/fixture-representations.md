# Catalogue fixtures and shared placement

The 2D Furniture tab and 3D Add elements panel use the same catalogue-backed editor
and project room obstacles. Dimensions remain millimetres; render meshes and plan
symbols do not participate in fit calculations.

The idempotent database migration adds six shower, seven basin and four toilet
subcategories, each containing an editable Default. Existing manufacturer products
remain separate records under category/subcategory; user-edited defaults are not reset.

`representation_key` selects the parametric mesh and bundled catalogue preview.
`plan_symbol_url` selects a bundled architectural-style SVG; optional
`plan_symbol_data_url` stores an individual manufacturer's PNG/JPEG/WebP plan image.
The catalogue editor supports uploading these images (500 KB maximum). Product
photos and STL models remain supported independently. Placed items retain their
dimensions and representation metadata when the catalogue is subsequently edited.

Default symbols and previews are original schematic artwork, not certified supplier
drawings. Generic symbols represent the nominal footprint and rotate with placement.
Manufacturer drawings must match the product's orientation and footprint before use.

Taxonomy and drawing conventions consulted:

- https://experience.kohler.com/en/inspiration/buying-guides/bathroom-sinks-buying-guide
- https://reveal.kohler.com/en/articles/step-by-step-designing-your-shower-enclosure
- https://csassets.duravit.com/3/1/Duravit_PIDS_3104972.pdf

Checks: `uv run pytest`, `pnpm test:geometry`, `pnpm lint`, TypeScript and production
build; browser checks cover 2D addition, live dimension edits in both directions,
wall alignment and the shared three-level catalogue selector.
