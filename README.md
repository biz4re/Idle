# Idle

A fully open-source, macOS-first Chromium browser foundation, built with Electron, React, strict TypeScript, Vite, Tailwind CSS v4, and Zustand. Version 0.1.0.

## Development

Install Node.js 22.12+ (22 LTS) or Node.js 24+ and pnpm 10. The repository pins pnpm through `packageManager`. If using Corepack, run `corepack enable` and `corepack prepare pnpm@10.34.9 --activate` first.

```sh
pnpm install
pnpm dev
```

One command starts the renderer development server and Electron. React changes hot reload; main and preload changes restart/reload Electron through electron-vite. Close the app and stop the terminal command to end development.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`build` typechecks and compiles all three processes into `out/`. `start` opens that production build. These scripts do not create a signed macOS bundle or installer. Development also runs on Windows and Linux; macOS has an inset native title bar and the usual dock activation/window lifecycle.

On Windows, `pnpm package:win` builds an unsigned, unpacked application in a new `release/` directory using the installed Electron runtime. It does not create an installer or change the executable's embedded Electron icon.

Application icon assets are in `resources/`: PNG for the Electron window, ICO for Windows packaging, and ICNS for macOS packaging. A future installer or app-bundle configuration must explicitly use the platform icon file; the development build does not create a desktop shortcut or macOS app bundle.

## Layout

- `src/main/`: Electron lifecycle, window security, and IPC handlers.
- `src/preload/`: sandbox-compatible bridge exposing only `window.idle.getAppInfo()`.
- `src/shared/ipc.ts`: IPC channel and shared API types.
- `src/renderer/`: React UI, Tailwind styles, and a small Zustand sidebar store.
- `electron.vite.config.ts`: a single build/development configuration.

The renderer has context isolation and sandboxing enabled, Node integration disabled, and a Content Security Policy. Main validates IPC senders, denies permissions, and blocks popups, navigation, and webviews. The development CSP allows the local Vite WebSocket and inline styles for hot reload/Tailwind. No raw Electron API crosses the preload bridge. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

Workspaces, their tabs, order, pinned state and active selections are saved continuously in a versioned SQLite database in the application data directory. A bounded URL-only back/forward stack is restored when a tab loads; form and scroll state are not saved. Background tabs load when selected; recently closed tabs can be reopened. Save a tab for Later from the toolbar or its context menu; saved pages, completion state and optional notes are stored in their Workspace. Deleting a Workspace also deletes its Later items and Workspace-specific Favourites. Global Favourites remain available across Workspaces. The saved-page search finds Favourites and Later items by title or URL, and Later notes. If the session database cannot be opened, Idle uses temporary in-memory storage and logs the error. Profiles use separate persistent Chromium partitions and separate session databases. Workspaces within the same Profile share cookies and website data; switching Profiles closes and restores the browser window. Session cookies follow Chromium expiration rules. Deleting a Profile clears its Chromium browsing data and its session database after confirmation. The address bar accepts HTTP(S) URLs and search terms. Remote pages must be placed in separate sandboxed contents without the application preload; do not navigate this privileged UI to external sites.

## Browsing

Drag tabs vertically to reorder them within their pinned or unpinned group, or drag a tab to a Workspace target to move it. The tab context menu also offers Move to Workspace. Right-click a tab for Move Up/Down, or focus a tab and press Alt+Shift+Up/Down. Use Cmd+L/T/W/R/F, Cmd+Shift+T, Cmd+[/], Cmd+Plus/Minus/0, and Cmd+1–9 on macOS; use Ctrl equivalents on Windows and Linux. Ctrl+Tab and Ctrl+Shift+Tab cycle tabs. Number 9 selects the last tab. The native menus list these commands. Right-click a link to open it in a tab; middle-click and modifier-click are handled by Chromium. Downloads prompt for a save location and appear in the toolbar download list. File inputs use the native file chooser. Recently closed tabs can be reopened from the sidebar; the History section stores the most recently visited URLs per Workspace.

Website permission requests for HTTPS top-level pages ask before allowing clipboard access, location, notifications, camera/microphone or fullscreen. Unsupported permissions are denied. External `mailto:` and `tel:` links ask before launching another application; other external protocols are blocked. Workspaces within a Profile share the same web session. Downloads are shown for the current app run.

## Contributing

Make the smallest maintainable change, preserve existing behavior, and justify new dependencies. Run available typechecks, tests, and builds; report changed files, results, and limitations. Run the session migration and persistence test, typecheck, production build, and a desktop smoke check.

## License

[Apache-2.0](LICENSE).
