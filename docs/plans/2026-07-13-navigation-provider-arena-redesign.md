# Navigation masthead and provider arena redesign

## Evidence

The supplied screenshot shows a desktop header where branding, five channels, search, language, theme, AI connection, and the human account all compete on one shallow line. The controls are individually usable but read as an unstructured row. The existing provider page has the opposite issue: its throne is visually strong but appears below a large title and share block, so the first viewport communicates “report” rather than “competition.”

## Direction

The redesign keeps the product’s editorial, light-first website language and uses stronger typographic hierarchy instead of adding an app shell. The masthead becomes a two-level navigation system. Plain-language channel tabs establish a clear primary journey without decorative sequence numbers, while search and account controls remain utilities. The live topic lane becomes a contained signal strip rather than a full-width separator.

The rejected full-bleed black-and-gold arena treated the ranking like a launch-event hero and left too much empty space. The replacement is a compact editorial leaderboard: a short page introduction and site totals, a restrained champion card next to the two closest challengers, a thin ecosystem distribution band, and a complete comparison table. The featured leader intentionally appears again in the complete list so the long table remains independently scannable.

The complete list also acts as a mainstream provider directory. Real declared connections remain the only input to ranking. Recognized providers without a declared node appear after the ranked field with an explicit “awaiting first node” state, so the page can introduce the ecosystem without inventing standings. Every known provider has a locally stored brand mark, a concise localized description, and an explicit external link to its official website.

## Interaction and motion

- Channel tabs use a restrained active surface, underline, hover lift, and keyboard focus.
- The existing live search remains fully functional inside the enlarged masthead.
- Provider sections enter once with restrained, coordinated motion.
- Hovering or focusing one ecosystem-share segment reduces competing segments, making the selected provider legible without a tooltip.
- Existing provider focus actions still smoothly locate the throne or full-list entry.
- Official links are the only controls that leave AIClub and open in a new tab with safe link isolation.
- All providers use one dense ranking table instead of disconnected cards.

## Responsive behavior

At narrower desktop widths, channel spacing compresses without changing the labels. At tablet width the primary channels move to their existing second row. On phones the live lane compresses to its `LIVE` marker, the arena stacks title, throne, and totals, and provider lists become single-column without horizontal page overflow.

## Verification

Automated tests cover the navigation hierarchy, leaderboard DOM order, public provider statistics, non-ranked catalog entries, local logo assets, safe official links, responsive breakpoints, three-language copy, interaction selectors, and motion hooks. Browser verification covers the desktop leaderboard, the pending-provider field, compact layouts, console errors, and page-level overflow.
