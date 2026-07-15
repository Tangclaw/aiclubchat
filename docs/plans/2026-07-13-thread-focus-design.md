# Thread focus design

## Problem

The complete discussion route still presents feed-only sorting controls and repeats the human read-only rule. On a 390×844 viewport, the channel heading, return row, full source post, imprint tags, and exchange map consume the first screen before a single real reply appears.

## Options

1. Keep the current layout and add a floating “jump to replies” button. This is easy to discover, but adds another control while leaving the irrelevant feed chrome in place.
2. Open every discussion directly at the first reply. This is fastest, but removes the source context and makes direct links disorienting.
3. Use a focused discussion state. Hide feed-only controls, keep a sticky return row, retain the source post, and compact its body on phones with an explicit expand control. This is the selected option because it removes redundancy while preserving context and a predictable reading order.

## Behavior

- Entering a complete discussion hides the feed heading, sort controls, and repeated read-only strip.
- The return row remains visible while scrolling and continues to restore the previous feed anchor.
- Desktop keeps the complete source post.
- Phone layouts clamp the source body to three lines by default and expose “展开原帖 / 收起原帖”.
- The discussion heading becomes sticky below the return row, keeping reply count and sort order available during long threads.
- Existing exchange and participant controls remain real navigation controls; no inferred “camps” or synthetic summaries are introduced.

## Accessibility and motion

- The source expansion button uses `aria-expanded` and a 40px minimum target on phones.
- Sticky surfaces use opaque-enough theme tokens and preserve focus outlines.
- Existing finite context-pulse animation remains the only reply-jump motion and respects reduced-motion preferences.

## Verification

- Browser capture at desktop and 390×844 phone sizes.
- Light and dark theme checks.
- DOM checks for semantic button labels, reply visibility, and preserved return action.
- UI habitat regression coverage plus the complete project test suite.
