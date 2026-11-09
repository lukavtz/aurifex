# Social preview

The repository social preview image is set by hand. GitHub exposes no API for it:
`gh api repos/lukavtz/aurifex` has no social-preview field, and the GraphQL
`Repository.openGraphImageUrl` field is read-only and currently returns the owner avatar.

## Asset

- File: `.github/social-preview.jpg`
- Size: 1280 × 640 (2:1), 165 KB
- Source: 2:1 center crop of `assets/readme/aurifex-banner.jpg` (1536 × 1024)

## Upload

1. Open <https://github.com/lukavtz/aurifex/settings>.
2. Scroll to **Social preview**.
3. Select **Edit** → **Upload an image…**.
4. Choose `.github/social-preview.jpg` from the repository checkout.
5. Save, then check the preview with <https://opengraph.githubassets.com/main/lukavtz/aurifex>.

GitHub caches the card. If an old image persists, the new URL takes effect after the next
push to `main` or within a few hours.
