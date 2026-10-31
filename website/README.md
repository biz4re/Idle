# Idle Browser — Public Landing Page

This directory contains the public marketing and documentation landing page for **Idle**, built with Astro, Tailwind CSS v4, and strict TypeScript.

## Stack

- **Framework:** [Astro](https://astro.build) (static output)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com) via `@tailwindcss/vite`
- **Language:** TypeScript (strict mode)
- **Deployment:** GitHub Pages via GitHub Actions (`.github/workflows/deploy-website.yml`)

## Local Development

```sh
cd website
pnpm install
pnpm dev
```

To run a production build and typecheck:

```sh
cd website
pnpm build
```

To preview the production build locally:

```sh
cd website
pnpm preview
```

## GitHub Pages Deployment

The website is deployed automatically via GitHub Actions whenever changes are pushed to `main` (or `master`) affecting `website/**` or `.github/workflows/deploy-website.yml`, or via manual workflow dispatch.

### Required GitHub Repository Settings

1. In your GitHub repository, navigate to **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, select **GitHub Actions**.
3. Ensure GitHub Actions has permission to deploy Pages:
   - **Settings** → **Actions** → **General** → **Workflow permissions**: select **Read and write permissions** (or ensure `pages: write` and `id-token: write` are permitted, which the workflow explicitly requests).

### Base Path & Custom Domain Handling

- **Repository URLs (`https://<username>.github.io/<repo>/`):** The workflow uses `actions/configure-pages` to automatically inject the repository sub-path into `ASTRO_BASE` and origin into `ASTRO_SITE` during the build. All internal assets and links use Astro's `import.meta.env.BASE_URL`.
- **Custom Domains (e.g. `https://idlebrowser.com`):** If a custom domain is configured in GitHub Pages settings, `actions/configure-pages` automatically evaluates the base path as `/`. No hardcoded paths exist in the site codebase.
- **Manual override:** When running manual dispatch in GitHub Actions, you can optionally provide a custom `base_path` input.

## Feature Accuracy Policy

To uphold product trust:
- **Verified features advertised:** Vertical tabs with drag-and-drop reordering, collapsible color-coded tab groups, context-isolated Workspaces, Profiles with separate Chromium persistent partitions and SQLite databases, Later reading list with custom notes, Favourites, instant saved-page search, macOS vibrancy / Windows 11 Mica materials, and sandboxed security boundaries.
- **Features strictly excluded:** Unimplemented and planned features such as AI capabilities and "Blips" are completely excluded.
- **Download honesty:** No fake download buttons are displayed. Because signed release installers are currently in development, the page explicitly communicates Developer Preview status and links to the open-source repository for building from source.

