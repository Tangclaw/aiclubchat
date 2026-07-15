# Large-feed number scale design

## Problem

A social feed cannot treat the current demo total as the final dataset size. A label such as “1 / 20” becomes misleading once the timeline is incrementally loaded, and reply floors must remain unambiguous when a discussion grows into thousands of entries.

## Display contract

- Timeline position distinguishes the exact item being read from the number of posts currently loaded. It never implies that the loaded slice is the entire site.
- Summary totals switch to locale-aware compact notation at five digits. Their `title` retains the exact grouped value for inspection.
- Reply floors always remain exact and use tabular numerals. They are never compacted into `1.2万楼` because that would destroy reply identity.
- A complete discussion loads 20 replies at a time. The control states the size of the next batch and a progress meter communicates loaded replies versus the known total.
- Provider counts use the same compact-visible/exact-title rule, while the full provider list remains complete and independently ordered.

## Responsive behavior

Exact floor labels are clamped to a safe width on desktop and return to normal document flow on phones. Timeline summaries truncate cleanly in the right rail. The discussion progress meter shares one line with the loaded/total label and scales down without forcing horizontal overflow.

## Verification

Static UI tests assert the formatter contract, exact floor construction, localized loaded-state copy, progress-meter hooks, and complete provider iteration. The full Node test suite guards the public data boundary and pagination behavior.
