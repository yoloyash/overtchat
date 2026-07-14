# Motion Standard

Overtchat uses CSS-first motion. Reach for Tailwind 4 utilities, the app motion classes in `app/globals.css`, `tw-animate-css`, Base UI state attributes, and Next/React View Transitions. Do not add a runtime animation library for ordinary interface motion.

## Tone

Motion should feel like a quiet work app: fast, useful, and hard to notice unless it is missing. Animate to clarify state changes, preserve spatial context, or show progress. Do not animate streaming message text, typing output, long lists, or decorative loops.

## Tokens

Use the CSS variables instead of ad hoc durations/easing:

- `--motion-duration-instant`: `0ms`
- `--motion-duration-fast`: `120ms`
- `--motion-duration-base`: `180ms`
- `--motion-duration-slow`: `240ms`
- `--motion-duration-deliberate`: `320ms`
- `--motion-ease-standard`, `--motion-ease-enter`, `--motion-ease-exit`, `--motion-ease-emphasized`

Prefer the shared classes:

- `motion-colors` for hover/focus color changes
- `motion-opacity` for reveal/hide affordances
- `motion-transform` for small spatial changes
- `motion-surface` for popup/menu/dialog movement and fade
- `motion-overlay` for backdrops
- `motion-collapse` for grid-row/opacity disclosure panels
- `motion-disable` to opt a subtree out of nonessential motion

## Routes

Navigation should pass a transition type, either via `MotionLink` or `useMotionRouter`.

- `/chat/*`: `route-chat`
- `/projects/*`: `route-project`
- `/settings/*`: `route-settings`
- `/login`, `/signup`: `route-auth`
- `/`: `route-home`
- Same-pane or unknown navigation: `route-same-pane`

Route transitions are deliberately subtle: short crossfades and tiny axis shifts only. Avoid full-page slides, springy motion, or anything that competes with streaming chat.

## Reduced Motion

`prefers-reduced-motion: reduce` must disable nonessential transitions and infinite decorative animations. Progress indicators may still communicate loading, but shimmer, bounce, and transform-heavy movement should stop or become instant.

Any JavaScript-driven animation must check reduced motion and complete immediately when the user requests it.

## When Not To Animate

Do not animate:

- streamed assistant tokens or Markdown layout while tokens arrive
- text selection, cursor movement, or editable input height changes
- security/auth redirects
- destructive confirmation consequences after the user confirms
- table/list churn where many rows can change at once

Use static loading skeletons and stable dimensions before adding motion.
