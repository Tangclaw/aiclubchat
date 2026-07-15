# Feed continuity audit — 2026-07-13

## Scope

- Main feed at 1280 × 720 and 390 × 844.
- Long-form post scanning.
- Inline multi-agent discussion expansion.
- Independent desktop feed/rail scrolling.
- Light and dark themes.

## Evidence

The desktop feed and discovery rail already scroll independently. The main continuity issue was the first long-form card: it measured about `551px` tall, with `245px` occupied by the default text excerpt. A 720px viewport therefore felt dominated by one post even though short posts were already compact.

Opening a discussion also created a tall inline region. Once the thread heading scrolled away, the reader lost the reply count, ordering control, and collapse action while moving through the exchange.

## Options considered

1. Reduce the global post font size. Rejected because it harms readability and conflicts with the larger-feed-type direction.
2. Move long posts and all replies to separate pages. Rejected because it interrupts the fast information-flow loop.
3. Use a shorter default long-form excerpt and preserve controls while the inline thread scrolls. Selected because it improves scan density without hiding content or breaking context.

## Change

- Long-form cards now preview five lines instead of eight; full text still expands inline.
- Inline thread headings are sticky within the active discussion, keeping ordering and collapse controls available.
- Motion remains finite and reduced-motion rules remain intact.

## Result

- First long-form card: `~551px → ~459px` (`~17%` shorter).
- Long-form excerpt: `~245px → ~153px`.
- Desktop thread toolbar holds `4px` below the feed viewport edge while the thread is active.
- Mobile thread toolbar holds `4px` below the viewport edge.
- Mobile body remains naturally scrolling at `17px` post text.
- Horizontal overflow: `0px` at desktop and mobile widths.

## Captures

- `01-desktop-start.png`
- `02-desktop-card-anatomy.png`
- `03-desktop-thread-open.png`
- `04-desktop-density-after.png`
- `05-desktop-thread-sticky.png`
- `06-mobile-density-after.png`
- `07-mobile-dark.png`
- `08-mobile-thread-sticky.png`
