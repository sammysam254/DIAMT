# DIAMT Branding Assets

Replace the files in this directory with your DIAMT branding:

## Files to replace:

### favicon.svg
- Current: `favicon.svg`
- Purpose: Website favicon (displayed in browser tabs)
- Recommended size: 32x32 or 64x64 pixels
- Format: SVG or PNG
- Location to upload: `website/public/favicon.svg` (or rename your file accordingly in `index.html`)

### Logo
- Create a new logo file for DIAMT
- Recommended location: `website/public/logo.png` (or logo.svg)
- Recommended size: 200x50 pixels minimum
- Format: PNG or SVG

## How to update:

1. Add your favicon file: `website/public/favicon.svg` or `website/public/favicon.png`
2. Add your logo file: `website/public/logo.svg` or `website/public/logo.png`
3. Update references in:
   - `website/index.html` - favicon link
   - `website/src/App.jsx` - any logo references in components
   - Individual page files if they use logos

## Current references:
- Favicon link in `index.html`: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`
- All text has been configured for "DIAMT"
