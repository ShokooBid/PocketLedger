# PocketLedger SVG Icon Pack

80 scalable SVGs: 10 main categories + 70 subcategories.

## Usage in React / React Native

For React web: copy SVGs to `public/icons/` and render `<img src="/icons/Food & Drinks-Groceries.svg" alt="Groceries" />`.

For Expo/React Native: use `react-native-svg` with `react-native-svg-transformer`, or convert SVGs into TSX components. React Native `Image` does not natively render bundled SVG files.

All icons have a 64x64 viewBox, soft circular gradient background, and colored outline glyphs. See `manifest.json` for filename/category mappings.

## PocketLedger integration

`Category.iconKey` stores a stable semantic key, such as `food-drinks-groceries`.
The app bundles SVG XML through `src/category-icon-assets.ts`, generated from this
pack and the versioned catalog by `npm run icons:generate` at the repository root.
`CategoryIcon` renders it with the existing `react-native-svg` dependency; no SVG
transformer or network request is required. The original SVG files remain intact.
Gradient IDs are scoped per rendered icon, and personal/unknown icon keys receive
a neutral fallback. Names and accessible button labels remain ordinary text.
