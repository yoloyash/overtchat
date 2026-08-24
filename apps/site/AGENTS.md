# Marketing site guidance

This workspace produces the fully static `overtchat.com` project site, release
log, and public installer files. `next build` writes the export to `apps/site/out`;
there is no production Next.js server.

The releases page reads GitHub during the build. Set `GITHUB_TOKEN` locally to
avoid unauthenticated API rate limits.

## Architecture

- `app/page.tsx` is the marketing homepage. `lib/home-sections.ts` defines its
  section IDs and ordering for both the page and `components/SectionRail.tsx`.
- `app/releases/page.tsx` renders the build-time release log.
  `lib/releases.server.ts` fetches GitHub Releases, while `lib/releases.ts`
  validates, classifies, and orders the returned data.
- `lib/site.ts` owns base-path and origin handling. `lib/metadata.ts` uses it
  for canonical, Open Graph, and other absolute page URLs.
- `public/` contains files copied directly into the export, including the
  installer, release manifest, redirects, and response headers.
- `app/layout.tsx` and `components/ThemeProvider.tsx` own fonts and theme
  hydration. Shared theme tokens come from `@overtchat/shared/theme.css`.

## Static export constraints

Every route must remain build-time renderable. Do not add server actions,
runtime API routes, ISR, or runtime-only environment dependencies.

Next.js applies `basePath` to its own `Link` components. Use normal root-relative
route hrefs there; use `sitePath()` for emitted asset or manifest paths and
`absoluteSiteUrl()` when a complete URL is required.

A failed GitHub request or a feed with no stable web/mobile releases must fail
the build. Release Markdown is external content: keep raw HTML disabled,
preserve `target="_blank"` and `rel="noopener noreferrer"` on external links,
and keep headings below the page-level heading.

Run the site tests, typecheck, and static build before finishing. Release-data,
installer, or redirect changes require their focused tests as well.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
