# Hose logo assets

Approved direction: the middle layered GPU/model core from `hose-icon-directions.png`.

- `hose-logo-master.png`: transparent, full-resolution raster master, generated with the built-in image tool from the approved reference.
- `png/`: transparent PNG exports at 16, 32, 64, 128, 256, 512 and 1024 pixels.
- `../../src-tauri/icons/`: desktop bundle icons, including macOS ICNS and Windows ICO.
- `../../public/hose-logo.png`: 128-pixel image for the setup screen and sidebar.
- `../../public/favicon.png`: 32-pixel browser icon.

Use the complete icon as supplied; preserve its aspect ratio and transparent padding. Earlier concepts remain here for reference. The master is raster artwork, not SVG.

## Regenerate

```sh
npx tauri icon assets/branding/hose-logo-master.png -o /tmp/hose-generated-icons
cp /tmp/hose-generated-icons/*.png /tmp/hose-generated-icons/*.icns /tmp/hose-generated-icons/*.ico src-tauri/icons/
npx tauri icon assets/branding/hose-logo-master.png -o assets/branding/png -p 16 -p 32 -p 64 -p 128 -p 256 -p 512 -p 1024
cp assets/branding/png/128x128.png public/hose-logo.png
cp assets/branding/png/32x32.png public/favicon.png
```

Mobile icon sets produced in the temporary directory are unused by this desktop project.

## Master extraction prompt

Edit this reference board: extract ONLY THE MIDDLE APP ICON as one standalone square master asset. Preserve its selected design faithfully: dark forest-green rounded square tile, stacked softly bevelled GPU/model wafers in isometric view, pale sage top wafer, ivory flowing S-shaped channel, dark green lower wafers. Preserve original proportions, lighting, orientation, colors and surface finish. Do not redesign or introduce details. Remove the left and right icons and all the off-white presentation background. Center the complete middle rounded square icon on an actual transparent square canvas, filling 90% of its width and height, equal margins on four sides. All space outside the rounded tile including corners must be transparent. Keep only very subtle tight contact shading within the tile; no outside shadow. Render at highest clean resolution, crisp edges, no text, no additional icons. This is the final production logo master for the Hose macOS application.
