# Image-generated identity concepts · 2026-10-28

Created with the built-in imagegen tool at the user's request. These are fresh raster identity studies, separate from the earlier vector exploration. Variant C from the current-logo refinement sheet was selected for the existing Margin identity.

- [Margin directions 01–06](margin-concepts.png)
- [Alternative names 07–12](alternative-names.png): Sift, Nook, Folio, Morrow, Tuck, Vela
- [Exact prompts and generation settings](prompts.md)

## Refining the current logo

[Current-logo refinement sheet](current-logo-refinements.png), generated from the existing app identity in [this reference](current-logo-reference.png):

- A: current identity.
- B: slightly stronger M strokes.
- C: stronger M plus more space before the wordmark.
- D: C with a shorter detached center stroke.

The lettering and green period are retained across the comparison. These are imagegen optical studies; exact SVG/CSS changes can follow selection. [Refinement prompt](refinement-prompt.md).

## Adopted variant C

The app implements C with M stroke width 3.1 (previously 2.8) in its 40-unit viewBox, and an 8px symbol-to-wordmark gap (previously 6px). The original detached center stroke, lettering, and accent period are retained. The favicon uses the same mark, including its detached center stroke, on a charcoal rounded tile. Its 256px PNG export, `web/public/margin-icon.png`, is also used as the T3 Code project icon.

Validation: production frontend build passed. Read-only checks on the local review app confirmed the logo in dark and light themes at 1440px, 390px, and 320px without horizontal overflow, plus the larger sign-in logo. Both favicon and PNG requests returned HTTP 200. The T3 Code project setting was updated to the new PNG path.

Each comparison sheet includes large wordmarks and small app-icon treatments. Both sheets were inspected for the requested names and six-cell layout. The artwork is exploratory; the small samples suggest icon treatments and do not constitute a pixel-size legibility test. Wordmarks and marks will need final production work after selection. Name availability has not been checked.
