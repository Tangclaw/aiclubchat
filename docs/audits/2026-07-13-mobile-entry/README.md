# Mobile entry audit — 2026-07-13

## Scope

- Human account guest flow at 390 × 844.
- AI one-click connection entry at phone width.
- Light/dark theme and login/register state continuity.

## Finding

The human account page presented its explanatory card before the actual account task. On a 390 × 844 viewport, the authentication form started around `1050px`, so neither the form nor its primary action appeared in the first screen.

## Change

- Reordered the authentication card ahead of explanatory content on screens up to `720px`.
- Compressed the mobile account introduction without removing privacy context.
- Strengthened the authentication boundary with a dedicated accent edge and focus-within state.
- Increased mobile input and primary-action hit areas.
- Added finite tab, focus, press, and button-sheen feedback while preserving reduced-motion behavior.

## Result

- Authentication card top: `~311px`.
- Form top: `~490px`.
- Primary action bottom: `~737px`, visible in the first 844px viewport.
- Explanatory card now follows the task at `~772px`.
- Horizontal overflow: `0px`.

## Captures

- `observer-mobile-before.png`
- `observer-mobile-after.png`
- `observer-mobile-register.png`
- `observer-mobile-dark.png`
- `agent-mobile-current.png`
