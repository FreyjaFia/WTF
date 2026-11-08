## Drink Recipe Guide (barista guide) [Nice to have, planned]

A guide inside the POS that shows staff **how to make** each drink the shop's way, so a new barista can make a Spanish Latte
the same as the owner does. It is different from the inventory recipe (which says *what and how much is used* so stock and
cost work); the guide says *how to prepare it*. They share one source of truth for the ingredient list, so they cannot
disagree.

### What a guide holds (per product, and per size where it differs)

- **Ingredients and amounts**, read from the inventory recipe (Inventory Phase 6): item, quantity, unit. Amounts follow the
  chosen size and add-ons (Large, oat milk instead of dairy, extra shot), so the guide for "Large Oat Latte" is right.
  Until the inventory recipe exists, the guide has its own ingredient list, which is replaced by the shared one later (a
  migration step, not two lists forever).
- **Steps**: ordered, short text, optional photo or short video per step, a timer where it matters (shot time, steep time).
- **Standards**: cup and lid, glass or ice, target volume and temperature, shot time or yield, garnish, how it should look.
- **Notes and warnings**: common mistakes, "stir before serving", **allergens and dietary tags** (dairy, nuts, gluten,
  vegan), caffeine level.
- **Prepared items** (syrups, batches) get their own guide, linked from the drinks that use them ("Brown sugar syrup: see
  recipe").
- A **hero photo** of the finished drink (the product image can be reused).

### Where staff see it

- **Order editor and Orders list:** a "Recipe" button on a cart line or order line opens the guide for that exact item with
  its add-ons and size. Useful when the order is in front of the barista.
- **Product card:** a small book icon (or long press) on the POS menu opens the guide before ordering.
- **Search:** a "Recipes" page listing every drink with search, category filter and tags (hot, iced, blended), usable as a
  training reference.
- **Training mode (later):** a side-by-side quick check or quiz ("what goes in a Spanish Latte?"), and a "new/changed
  recipe" badge so staff notice a changed guide. Mark as read per user.
- **Kitchen ticket (with Printing):** an optional line with the key steps or a recipe code for a busy bar.
- **Not on the customer link** by default. A setting may show the ingredient and allergen list publicly, because customers
  care about allergens.

### Data and editing

- Tables: `RecipeGuides` (product or add-on, optional size, hero image, notes, standards, version, active) and
  `RecipeGuideSteps` (order, text, image, timer seconds). Soft delete and restore like the other management records.
- **Editing is Admin and above**; everyone who can take orders can read. Keep a version history (who changed what and when,
  the previous version kept) so a bad edit can be undone and so staff can see what changed. Audit `RecipeGuideUpdated`.
- Images and videos use the existing image storage (add the guide images to `ImageReferences.ReferencingEntities` so Stale
  Image Cleanup keeps them; its test fails otherwise). Keep videos short and small (compress, size cap), or link to a video
  instead of storing it.
- **Offline:** the guide is part of the POS catalog cache (Dexie `catalog`) with its images in the image cache, so it works
  without a connection like the rest of the catalog. Add the guides to `GET /api/sync/pos-catalog` or a lighter separate
  sync endpoint, refreshed with the periodic catalog refresh; keep the payload small (text and compressed photos only).
- **Multi-tenant and branches:** guides belong to the tenant and are shared by its branches; a branch may later have its own
  variation (a different machine, a different syrup brand).
- **Printing:** a printable recipe card (PDF) per drink or per category, for the bar wall.

### Phases

| Phase | Content |
| ----- | ------- |
| G1    | Guide per product: ingredients (own list), steps (text), standards, allergens; Recipe button in the editor; Recipes page; Admin editor; offline cache |
| G2    | Photos per step, hero image, timers, versions and "changed" badge, printable cards |
| G3    | Ingredients read from the inventory recipe and follow size/add-ons; training mode; optional public allergen info |

### Tests

Guide opens for the right product, size and add-ons; amounts follow the size; Cashier can read but not edit; Admin edit keeps
the old version; images survive Stale Image Cleanup; offline open from the cache; the editor refuses an empty step; specs
for the service, the editor and the Recipes page.

### Open questions

- Who writes the guides (the owner, head barista), and are step photos or videos realistic for them to produce?
- Should the guide be visible to every role including Cashier, or only to kitchen/bar staff?
- Is it also a training tool (quiz, sign-off), or only a reference?

---

