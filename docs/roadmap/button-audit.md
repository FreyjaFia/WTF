## Button States & Text Audit [Partly done]

A cleanup pass over every button in the app, following `docs/BUTTONS.md` and the
`button-conventions.spec.ts` rules. To be reviewed before work starts.

**First pass (18 Oct 2026):** a script scanned every template. Every save, delete, restore, download, sync and generate button already has a disabled state and a spinner, directly or through `app-confirm-dialog`'s busy state; loading texts follow one pattern (Saving..., Deleting..., Restoring..., Downloading...); the only dialogs without a busy state are the synchronous ones (discard, leave, log out). No layout wrapping or overflow was found in the browser sweep. Still open: editor pages can be opened by URL for inactive records (no route guard yet), and "Updating Order..." vs "Saving Order..." vs "Processing Order..." could be unified.

### Audit checklist

- **Right button for the job:** primary / secondary / ghost / danger / restore applied to the
  correct actions (e.g. login, cancel, clear, delete, restore, "Later" on the update banner).
- **Busy states:** every save / update / delete / restore / download / refresh button shows a
  spinner, is disabled while running, and cannot be double-submitted.
- **API-call feedback:** every API call shows its in-progress text (Saving..., Loading...,
  Updating..., Deleting...) and then updates to the result (success alert, error alert, reset
  label); no stuck or missing loading text, including offline and failed calls.
- **Button text:** consistent wording per state (e.g. Save / Saving..., Update / Updating...,
  Delete / Deleting..., Download Excel / Downloading...), no stray spaces or punctuation.
- **Loading vs empty vs error states:** spinners, empty-state text and error alerts match
  across list, details and editor pages.
- **Edit / read-only rules:** edit actions hidden or disabled on inactive (soft-deleted)
  records; Add Stock hidden on inactive items; route guard for edit URLs of inactive records.
- **Layout:** toolbars follow one pattern (Filters + Refresh row, downloads row) and labels
  never wrap (see shared `.app-btn` rules); check phone width and the Android build.
- **Disabled / hover / pressed / focus / cursor** states are consistent, including the 3-dot
  menus and dialog buttons.
- **Tests & docs:** extend `button-conventions.spec.ts` where a rule can be enforced, and
  update `docs/BUTTONS.md`.

---

