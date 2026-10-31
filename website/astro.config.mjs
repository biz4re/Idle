// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages base path handling:
// - Defaults to '/' for root / custom domains.
// - Supports ASTRO_BASE env var (e.g. '/<repo>' in GitHub Actions).
// - Supports ASTRO_SITE env var (e.g. 'https://<user>.github.io' or custom domain).
const site = (process.env.ASTRO_SITE || 'https://idlebrowser.com').trim();
const base = (process.env.ASTRO_BASE || '/').trim();

export default defineConfig({
  output: 'static',
  site,
  base,
  image: {
    service: passthroughImageService(),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
