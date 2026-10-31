# Known issues for the 0.1.0 developer preview

## Security and privacy

- Workspaces in the same Profile share cookies, authentication, cache, and permissions. Different Profiles use separate persistent Chromium partitions; session cookies follow Chromium expiration rules.
- History, tabs, Later notes, and Favourites are stored unencrypted in the application data directory. There is no private browsing mode, history-clearing interface, or user-controlled retention policy.
- Favicon URLs are loaded by the application interface, including HTTP favicons. This can reveal the user's IP address to the favicon host and is not a hardened image proxy.
- HTTP websites are supported and are not confidential or authenticated. External application handoff is limited to confirmed `mailto:` and `tel:` links; other protocols are blocked. Website permission requests are restricted to the active HTTPS top-level page, and unsupported permissions are denied. Some sites may not work under these restrictions.
- Permission checks are denied by default and prompts are granted only for the current request; browser and OS permission behavior varies. Screen capture, device chooser APIs, and permission persistence are not implemented. Permission, external-link, popup, and download flows still need an independent security review and real-site testing.
- The renderer's CSP allows inline styles and local development WebSocket connections. The development server and its dependencies are intended for local development, not exposure to an untrusted network.
- Electron is pinned by the lockfile, but Idle does not yet provide signed installers, a release process, automatic updates, or a mechanism to deliver Chromium security fixes. Public builds require a maintenance and update plan. As of 30 October 2026 the lockfile resolves Electron 45.2.0, a supported stable release, and `pnpm audit` reported no known advisories; this is a point-in-time check, not a security certification.

## Reliability and compatibility

- This is a developer preview, not an independently audited browser. Automated tests exercise SQLite migrations, transactional Later saves, tab session data, Workspace and Favourite persistence, search, input validation, and a forced termination after a committed database write. They do not exercise full Electron tab lifecycle, webpage isolation, permissions, downloads, uploads, popup gestures, or UI restart flows end to end.
- macOS-specific titlebar, permissions, shortcuts, and window lifecycle have not been verified on a Mac in this workspace. Windows desktop launch has been smoke-tested in an earlier iteration; current multi-site interactions and Profile login isolation have not been exhaustively tested.
- If the database cannot be opened, Idle starts with temporary in-memory storage and displays a warning. The original database is left untouched; changes made in the temporary session will not survive a restart. A failed write also displays a warning. There is no recovery UI, automatic backup, or merge of temporary changes.
- SQLite uses WAL and synchronous commits, but sudden power loss, filesystem failure, disk exhaustion, and concurrent external modification can still cause data loss. Session data stores tab URLs, selection, and a bounded URL-only navigation stack, not form contents, full Chromium page state, or downloads. Background views are retained in memory while switching Workspaces; popup creation and direct new-tab actions are limited, but there is no general tab suspension or memory budget.
- Downloads use the native save dialog and show progress during the current run, but have no resume, cancellation control, malware scanning, or persistent download history. File upload uses Chromium/Electron's native chooser and has not been verified against representative sites.
- Some `window.open` flows, cross-origin authentication popups, embedded frames, clipboard operations, and common-site permission patterns can fail. The current policy denies external protocols other than `mailto:` and `tel:` and blocks non-web frame navigation except `about:blank`, `about:srcdoc`, `blob:` and `data:`.
- Back/forward URL history is restored on restart when it contains at most 100 HTTP(S) entries; Chromium form values and scroll state are not stored. The History list is limited to the latest 200 unique URL/Workspace pairs. Recently closed tabs restore URL and pin state, not their previous page history.

- Electron’s macOS `swipe` event supports the older three-finger gesture only under compatible system trackpad settings; two-finger interactive back/forward swipes are not implemented. macOS gestures and native menu shortcuts require testing on real macOS hardware.


## Window chrome verification

The integrated window chrome still needs interactive verification on Windows for native caption buttons, Snap Layouts, dragging, maximized and mixed-DPI behavior. On macOS, verify inset traffic lights, system menus, dragging and fullscreen transitions on hardware.

Native glass: macOS vibrancy, inactive appearance, fullscreen and reduced-transparency changes require verification on macOS hardware. Windows light mode, reduced transparency, high contrast, Snap Layouts and mixed-DPI behavior still need interactive coverage. Mica on Windows 11 22H2 or later is wallpaper-tinted, rather than a live blur of windows behind Idle.

- Webpage corners use Electron View’s native clipping. Electron still routes clicks in the small clipped corner cutouts to the webpage view; macOS clipping, fullscreen and high-DPI behavior remain unverified.

Split View is incomplete: divider resizing, pane drag-and-drop, swapping, maximize/restore, pane-specific empty states, minimum dimensions for nested panes and split shortcuts are not yet implemented. Split lifecycle and live-webpage interaction have not been verified end-to-end on Windows or macOS.

Per-pane navigation has been smoke-tested with two panes on Windows. Three- and four-pane layouts, narrow sizes, split drag-and-drop, fullscreen, mixed DPI and macOS remain unverified end-to-end; the existing Split View limitations still apply.
