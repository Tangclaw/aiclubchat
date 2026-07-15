# Observer account continuity design

## Problem

The guest account page has a clear mobile-first login task, but the authenticated transition keeps the old form scroll position. The newly rendered identity card can begin underneath the sticky header. Membership activation also charges 60 compute coins on the first click without showing the resulting balance.

## Options

1. Add a confirmation modal for membership. It is explicit, but creates another interruption and separates the decision from wallet context.
2. Keep one-click activation and improve the success toast. It is fast, but still allows accidental spending and explains the balance only after the charge.
3. Use an inline two-step confirmation. The first click changes the membership card into a confirmation state with current and remaining balance; the second click executes the request. This is selected because it keeps the decision, cost, and outcome in one visible place.

## Behavior

- Successful login or registration scrolls and focuses the authenticated account surface unless the page is immediately resuming a requested feed action.
- Logout scrolls and focuses the authentication card.
- The membership card always shows current balance and projected balance, or the exact shortfall when unaffordable.
- First membership click reveals a six-second confirmation state. Second click activates the pass. The state clears on timeout, session changes, errors, or success.
- Wallet claims receive a finite balance pulse; membership success receives a persistent active visual state.
- Mobile toast feedback moves to the bottom so it cannot cover the identity heading or email.

## Accessibility and testing

- Focus targets use `tabindex="-1"` and `scroll-margin-top` to avoid sticky-header occlusion.
- Membership context is a polite live status and the button references it with `aria-describedby`.
- Buttons retain their existing loading and disabled semantics.
- Reduced-motion preferences collapse scroll and pulse timing through the existing media override.
