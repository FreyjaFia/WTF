# Buttons

Button looks and behavior are defined once, in the "Buttons" section of
`src/wtf-pos/src/styles.css`. Templates pick a **role** (and a **size** when the
button has a fixed height); colors, hover, press, focus and disabled states come
from the role, so every button of the same kind behaves the same.

A test (`src/app/shared/button-conventions.spec.ts`) fails if a template uses
daisyUI `btn` classes, hand-builds a green/red button, omits `type`, or has an
icon-only button without an accessible name.

## Roles

| Class | Use it for | Look |
| --- | --- | --- |
| `app-btn-primary` | The main action: Save, Add, Update, Apply, Checkout, Confirm | Solid green, shadow |
| `app-btn-secondary` | Neutral bordered actions: Cancel, Clear, Filters, Export, Reset, Keep Order | White, gray border |
| `app-btn-accent-outline` | Bordered action in the brand color: Manage Links, Manage Add-ons, Restore | White, green border |
| `app-btn-ghost` | Low emphasis: Back, Close, Done, Collapse | Gray text, gray hover |
| `app-btn-subtle` | Full-width expanders: Show all, Show less | Light gray background |
| `app-btn-ghost-warning` | Warning-toned: Sync offline orders | Amber text, amber hover |
| `app-btn-outline-warning` | Bordered caution action on a finished record: Override Order | White, amber border |
| `app-btn-outline-danger` | Bordered destructive: Delete, Refund, Void, Discard, Delete image, clear the cart | White, red border |
| `app-btn-overlay` | Round close button over an image: remove image | Dark circle |
| `app-btn-danger` | Solid destructive confirm (used by `app-confirm-dialog`) | Solid red |
| `app-btn-dark` | The login submit only | Solid black |
| `app-btn-link` | Text link that triggers an action: View all, Reset | Green text, bold |
| `app-btn-icon`, `app-btn-icon-danger` | Icon-only buttons (always add `aria-label`) | Round, gray icon |

Always combine a role with the base: `class="app-btn app-btn-primary app-btn-sm"`.

Other shared classes: `app-menu-item`, `app-menu-item-danger`, `app-menu-item-success`
(rows inside dropdown action menus) and `app-stepper-btn`, `app-stepper-btn-primary`
(round +/- quantity buttons).

## Sizes

| Class | Height | Notes |
| --- | --- | --- |
| `app-btn-xs` | 24px | Compact inline actions |
| `app-btn-sm` | 32px | Page and toolbar actions |
| `app-btn-md` | 40px | Forms and dialogs |
| `app-btn-lg` | 48px | The one big call to action (Checkout) |

Buttons without a size class (back arrows, icon buttons, text actions) keep their
own padding utilities.

## Behavior every button gets

- Pointer cursor when enabled, `not-allowed` when disabled (global rule, because
  Tailwind v4 no longer gives buttons a pointer cursor).
- One green keyboard focus ring (`:focus-visible`).
- Press feedback (`active:scale-95`), turned off while disabled.
- A disabled look from the role (gray for solid roles, faded for the rest).

## Rules of thumb

- One primary button per area. Pair it with a secondary button for Cancel, and use ghost for low-emphasis actions like Back.
- Destructive actions are red; restore and confirm are green.
- Dialog actions come from `app-confirm-dialog`, not hand-written buttons.
- Icon-only buttons need an `aria-label`.
- Give every `<button>` a `type` (`button`, or `submit` inside a form).
- A control that is genuinely different (floating cart bar, quick-pay button) can
  opt out with `data-custom-button`; sortable table headers, tabs, navigation rows
  and selection cards keep their own styling but still get the global cursor,
  focus and disabled behavior.
