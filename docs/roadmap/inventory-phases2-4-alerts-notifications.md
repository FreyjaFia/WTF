### Phase 2 - Pack, Box, and Shared Stock Selling [Completed, 21 Oct 2026]

- Allow multiple products to deduct from the same inventory item.
- Support configurable deduct quantity per product sale.
- Example:
  - `1L Oat Milk` sells for `PHP150` and deducts `1`.
  - `Oat Milk Box of 6` sells for `PHP850` and deducts `6`.
- Validate stock availability using the total required quantity.
- Show stock impact before saving product inventory mappings.

What was left after Phase 1 and is now built: the stock impact preview. Sharing an item between products, the quantity per
sale and the check against the total required quantity already worked from Phase 1 (the deduction sums per item).

- **Preview.** The Manage Links dialog (item editor) shows under each linked product "1 sale takes 200 ml. In stock now:
  enough for 49 sales." and follows the quantity as it is edited. The product editor's Track inventory card shows the same
  for "deduct from an existing item" (and "the starting stock covers N sales" for an own item). When the stock covers no sale
  it says what will happen: a warn-only item goes below zero and warns, a blocking item refuses online sales of the product
  until stock is added.
- **Maths.** `salesCovered(balance, quantityPerSale)` is a whole number of sales and is zero for an empty or negative
  balance. It lives in `StockRules` (API) and `shared/calculations/stock-adjustment.ts` (Angular), with the shared cases
  `salesCovered` in `calculation-cases.json` run by both test projects.
- **Not changed.** Pack conversion when receiving stock (typing "2 cartons") stays with Phase 8; Stock In still takes the
  base unit.
- **Checked in the running app** (throwaway database): the Manage Links dialog for Oat Milk (9,800 ml, Latte at 200 ml) read
  "enough for 49 sales", then "enough for 1 sale" after changing the quantity to 6000; the product editor read
  "enough for 1 sale" at 6000 and the below-zero warning at 20000.

### Phase 3 - Consumables and Required Product Usage [Partially completed, 21 Oct 2026]

- Treat cups, lids, sleeves, milk, syrups, and other consumables as
  inventory items.
- Link products and required add-ons to consumables.
- Deduct consumables automatically when an order is completed.
- Support multiple required consumables per product or add-on selection.
- Example:
  - regular drink deducts `1 Regular Cup`
  - large drink deducts `1 Large Cup`
  - selected oat milk add-on deducts oat milk stock if configured

Built (21 Oct 2026):

- Consumables are plain items; linking them to products and add-ons, several links per product or add-on, and the deduction
  when an order completes all work (Phase 1). Size cups go on the Size add-ons when the sizes use different cups, or on the
  product when every size uses the same item; never both, or a cup is taken twice.
- **Stock coverage check** (`GET /api/items/coverage`, `ItemsRead`; the Inventory > Coverage tab). It lists every active
  product (add-ons excluded) as *Takes stock*, *Some options missing* or *Takes no stock*, so a drink with no cup linked is
  visible. The rule (`StockCoverageRules` in `WTF.Calculations`): a product is covered when it has an active link to an active
  item, or when every option of one required add-on group (Size, Flavor) has one; it is partial when a required group has
  some options linked and others not (the unlinked ones, for example "Size: Jumbo", would sell without taking stock); it
  takes no stock when nothing is linked anywhere. Optional add-on types (Topping, Extra, Sauce) are ignored. The list shows
  products that need attention first and links to the product editor ("Set up stock") for roles that can write products.

Not built, on purpose:

- **Nothing is enforced.** A product with no stock link still sells; the check only shows the gap. Refusing such a sale, or
  marking a product as "must take stock", is a decision for the owner (retail goods, services and untracked items exist).
- **Replace mode and size-aware amounts** (oat milk replacing dairy, a large drink using 1.5x the milk) belong to Phase 6
  (recipes); until then an add-on only adds.
- **No item types, and no "required items" list (decided 21 Oct 2026).** The check does not know what an item is and should
  not (no cup, lid or milk types). Letting the owner say "this drink must have a lid" was considered (a small table of
  required items per product, shown only in Coverage) and skipped: the Phase 6 recipe says which items a product uses, so a
  second list would only have to be merged into it later. Until recipes exist, Coverage shows products with no stock link
  and Size or Flavor options left unlinked, and nothing more.
- **Checked in the running app** (throwaway database): Latte with Regular linked and Jumbo not read "Some options missing,
  Size: Jumbo"; Water read "Takes no stock"; Mocha (both sizes linked) and Beans read "Takes stock" (counts 2, 1, 1). After
  linking Jumbo to a cup and refreshing, Latte left the list (counts 3, 0, 1).

### Phase 4 - Inventory Alerts and Notifications [Mostly completed, 21 Oct 2026]

- Notify assigned users or roles when inventory reaches warning or
  critical levels.
- Support per-inventory-item alert recipients or category-level defaults.
- Show warning and critical indicators in Management and POS where useful.
- Prevent duplicate alert noise by tracking last notification state.

Built (21 Oct 2026; script `tools/sql/20261022_add_stock_alerts.sql`, run it before deploying the API):

- **When an alert is sent.** After any change that lowers or moves a balance (a completed sale or a refund, a stock-in, an
  adjustment) and after an item's warning or critical level is edited, `IStockAlertService` looks at the item's level
  (`StockRules.StatusFor`). `Items.LastAlertStatus` remembers the level the last alert was sent for, and
  `StockAlertRules.Decide` (in `WTF.Calculations`) says: alert only when the item got *worse* than that (warning, then
  critical, then out of stock, each once); back to ok forgets it, so a later fall alerts again; a partial recovery is
  remembered without an alert. The state moves with one guarded `UPDATE`, so registers crossing a level together alert once
  (checked on a real SQL Server with ten at once). Existing items start at their current level, so nothing floods on the first
  run. An item that goes further below zero after an out-of-stock alert is not alerted again.
- **Who is told.** The item's named people if it has any (`ItemAlertRecipients`), otherwise every active Super Admin, Admin
  and Stock Manager. Named people can only be those who can read stock notifications (those three and Admin Viewer). Set from
  the item editor's *Stock Alerts* card (`PUT /api/items/{id}/alert-recipients`, `ItemsWrite`; empty goes back to the default;
  audited as `ItemAlertRecipientsUpdated`). Category-level defaults are not built: items have no category yet (Phase 8).
- **How it reaches them.** A saved list per person (`StockNotifications`: title, body, level, quantity, read time) plus a push
  (`PushTypes.StockAlert`, opens `/inventory/alerts`). `GET /api/stock-notifications` (paged, unread count) and
  `POST /api/stock-notifications/read` (some ids, or all), `StockMovementsRead`. A failed push never undoes the sale; the saved
  list is the record. Push is sent when the alert is saved, inside the sale's transaction, so a sale that rolls back after that
  point (rare) could leave one push without an alert.
- **Screens (replaced 21 Oct 2026, see "Needs Attention" below).** Inventory > Alerts (list, unread highlighted, open an alert to mark it read and go to the item, Mark All Read,
  Load More); the unread count on the Alerts tab and sidebar link, and on the Inventory entry when its group is closed (and on
  the Inventory item of the phone dock). The count sits on Alerts while the Inventory group is open and moves to Inventory
  when it is closed, in the wide and the narrow sidebar alike (a small number on the icon in the narrow one, "9+" above nine).
  It refreshes when the app opens, when a push arrives, and when the list is used.
- **Not built.** No indicators in the POS (decided: not now). Counts and lists now update live (see "Global Notifications (the bell)" below).
- **Checked in the running app** (throwaway database, built-in browser): selling past the warning, critical and empty levels
  gave one alert each (3 in total, a further sale while empty added none); the list, sidebar count, Inventory count and
  phone dock count matched; opening an alert marked it read; naming only one person in the item editor sent the next alert to
  that person and not to the admin. Push is not configured on this machine, so the push itself was checked only by unit tests.


**Needs Attention, live counts, and the Stock In and Coverage redesign (21 Oct 2026)**

- **Needs Attention replaces the Alerts tab** (`GET /api/items/attention`, `StockMovementsRead`; `/inventory/attention`, and `/inventory/alerts`
  redirects to it). An event list cannot feel urgent, because what stock people need is what is low *now*. It reads the items, not the saved
  alerts, so an alert that was read or cleared never hides an item that is still low. Worst first (out of stock or below zero, critical, low), three
  count tiles (out in red, critical in orange, low in amber, each a filter), and a card per item: the quantity big, a bar
  against the low level, "Enough for N more sales, used by M products" (or "cannot be made" when empty), the levels, and **Add Stock** with the
  item preselected. When nothing is low it says "All stocked up". The stock alert events still arrive in the bell and on the Notifications page.
- **The counts follow the shelf.** The Inventory entry, the Needs Attention link and tab, and the phone dock show the number of items that need
  attention (not unread alerts), red while anything is critical or out and amber when items are only low, and every screen updates by itself
  when stock changes (`StockAttentionService`, fed by `StockChanged`). `StockAlertService` announces every change, alert or not.
- **Stock In** is a full page, not a form in a box: "1. What arrived?" is a searchable grid of item tiles (a dot and a note for items that are out, critical or running low, those first), "2. How much?" has a big quantity box with presets (+100, +500, +1,000, +5,000 for ml and g, +1, +5, +10, +50 for pieces), and "3. Details" holds cost and note. A sticky summary on the right shows what is in stock now, what is being received and the new balance, with the Add Stock button; after saving the form clears for the next delivery and an "Added just now" list keeps the last five (it no longer jumps to the item).
- **Stock Coverage** shows how much of the menu takes stock as one bar and a percentage, "Needs setup" and "All products" pills with counts, a
  search box, a coloured edge per card and each missing option as a chip, with Set up stock as the main action for products that need it.


**Additions to stock alerts (planned 21 Oct 2026, built 21 Oct 2026; script `tools/sql/20261023_add_stock_alert_reminders.sql`, run it before deploying the API)**

Built: the daily reminder and the two level-change gaps. `StockReminderService` and `StockReminderScheduler`
(`Features/Inventory/StockAlertReminders.cs`), settings under `StockAlertReminders` (08:00 `Asia/Manila`, `DryRun` on in
`appsettings.json`, off in Production), `StockNotifications.ReminderCount` and `LastRemindedAt`. Only items that were
alerted (`LastAlertStatus` above ok) and are still low are reminded; an alert or reminder made today is not repeated the same
day; the row is lifted by one guarded `UPDATE`, so two runs in the same moment lift it once (real SQL test). A reminder reads
"Still low: Oat Milk ... Day 3." (day 1 is the first alert). Creating an item whose starting stock is already under a level
now alerts (an item created with nothing yet stays quiet), and so does restoring an item that fell while inactive. **Left out on
purpose:** snooze, escalation to Admins, skipping closed days and a `MaxDays` stop limit (none of these exists; reminders run daily until the item is back to ok). **Checked** by tests
(.NET suite, including real SQL Server) and in the running app on a throwaway database: an alert read yesterday came back
unread as "Still low: Oat Milk ... Day 2." with the count at 1, a stock manager with no earlier row got a first alert, an
item that is fine got nothing, and restarting the API the same day sent no second reminder. The monthly workbook scheduler
now runs on the same catch-up base (`DailyCatchUpScheduler`) as the other daily jobs, so a cold app catches it up too; its
steps and settings are unchanged.

1. **A daily reminder until the item is dealt with.** Before this, an alert was sent once, when the item got worse. If the person
   opens it and puts it off, nothing happens again. Instead, every day the item is still at a warning, critical or empty level,
   the people who should know are told again, until it is back to ok.
   - *"Dealt with" means the item is back to ok* (stock added or counted, or its levels changed so it is fine). Reading or
     opening an alert does **not** stop the reminders. The item being deactivated stops them.
   - **One row per item while it stays low, not a new row every day.** A reminder lifts the item's existing alert back to the
     top, unread again, with a count ("Still low: Oat Milk, 400 ml left (day 3)") and sends the push. A person who cleared it
     gets it back; the list does not fill with copies. When the item recovers the row stays as history and the next fall starts a
     new one. Needs `ReminderCount` and `LastRemindedAt` on the notification row (or the item).
   - **Runs once a day at a set shop time** (for example 08:00, `Asia/Manila`), using the same catch-up scheduler as the chat
     and image cleanups (`DailyCatchUpScheduler`), so a sleeping app sends the day's reminders when it wakes and never twice in
     a day (the last run is saved the same way). Settings in a `StockAlertReminders` section: `Enabled`, run time, time zone,
     and a dry run that only logs, on for the first run, like the other jobs.
   - Goes to the same people as the first alert (the item's named people, else the stock roles).
   - **Choices still open:** a snooze ("remind me in 1, 3 or 7 days") for a person who knows an order is coming, so the
     reminders do not become noise they learn to ignore; whether to add the Admins to the reminder after some days of silence
     (escalation); whether closed days are skipped; whether to stop after a number of days or go on until fixed (today it goes on until fixed).
2. **Alerts when the levels are changed.** Built: editing an item's warning or critical level checks it at once, so
   raising a level above the current balance alerts immediately; an item that gets worse alerts, one that only improves (critical
   back to warning) is remembered without an alert, and one that is fixed by the edit stops being tracked. The two gaps (creating
   an item already under its level, restoring a low item) are closed.

**Tests for these:** the reminder job sends once a day and not twice on a second run the same day; an item back to ok gets no
reminder and its episode ends; reading the alert does not stop the next day's reminder; a reminder bumps the existing row (unread
again, count up) instead of adding one; a recovered item that falls again starts a new row; named people only; the dry
run sends nothing; creating a low item and restoring a low item alert once; the real-SQL test that two runs in the same moment
send one reminder.

### Global Notifications (the bell) [Built, 21 Oct 2026]

**Built (21 Oct 2026; script `tools/sql/20261024_generalise_notifications.sql`, run it before deploying the API, then `tools/dbsync.bat`).**
The plan below was built as written, with these details:

- **One table, one producer.** `StockNotifications` became `Notifications` (`Kind`, `Severity`, `Path`, `SubjectId`, `Data` JSON; existing
  rows became `StockAlert` rows with their read state, and the old item, level and quantity columns moved into `SubjectId`, `Severity` and
  `Data`). `INotificationService` (`Features/Notifications`) saves a row per person, tells their open screens and sends the push (push type
  `notification`, with `kind`, `path` and `subjectId`). `NotifyAsync` saves and announces, `AnnounceAsync` only announces (used when a
  reminder lifts an existing row). `StockAlertService` and the reminder job call it and keep only the stock rules.
- **API.** `GET /api/notifications` (by kind, unread only, paged; returns the total unread and the unread per kind), `GET /api/notifications/counts`,
  `POST /api/notifications/read` (some ids, a kind, or all). Any signed-in person; a person only ever sees rows addressed to them. The
  `/api/stock-notifications` routes are gone.
- **Real time.** A new `NotificationHub` (`/hubs/notifications`, any signed-in person, no methods a client can call). Each person joins
  `user-{id}` and hears `NotificationsChanged` when a row is added, lifted or read (also on their other devices); people who can read stock also
  join `StockViewers` and hear `StockChanged` after every stock change. The app then asks the API again, so the count, the bell and the lists
  update without a refresh; a dropped connection reloads everything when it comes back, and the counts are also reloaded every minute.
- **App.** `app-notification-bell` beside the chat envelope (sidebar top row, phone and wide header): the unread count (99+), a panel with the
  latest ten (an icon and colour by severity, a Reminder pill, Mark all read, See all), and a Notifications page (`/notifications`) with a filter
  per kind, unread only, load more, and live reload. A new kind needs a label in `NOTIFICATION_KIND_LABELS` and an icon in
  `notification-display.ts`; nothing else.
- **Inventory Alerts became Needs Attention** (decided 21 Oct 2026): see Inventory Phase 4.
- **Not built:** per-person mute switches, deleting old read notifications, and a second kind (they wait until one is wanted).

One bell beside the chat envelope that collects every kind of notification for a person, so a new kind (stock alerts today,
others later) does not need its own badge, page and push wiring. The bell icon (`icon-notifications`) is already in the icon
sprite and unused; Inventory Alerts uses `icon-stock-alert` (cart with a warning mark) so the bell is free.

**What the person sees**

- A bell in the same place as the envelope (the top row of the sidebar, the top bar on a phone). Its badge is the unread count
  across all kinds ("9+" above nine).
- Tapping it opens a short panel (the latest ten, newest first, unread highlighted, an icon per kind, "Mark all read" and
  "See all"). "See all" opens a Notifications page with a filter per kind and paging. Opening one marks it read and goes to
  its screen.
- Chat messages stay in the envelope (they are conversations, not events); the bell is for events.
- **Inventory Alerts stays.** It becomes the stock-alert *view* of the same feed: `/inventory/alerts` lists only the stock
  alerts, and the Alerts tab, the sidebar link and the Inventory entry keep their own counts, which are the unread count of
  that one kind. So stock people still see "3 stock alerts" where they work, and the bell shows "3" plus whatever else is
  waiting. A stock alert read in either place is read in both (it is one row).

**Data and API (a generalisation of what Phase 4 built, not a second system)**

- Rename `StockNotifications` to `Notifications` and add: `Kind` (`StockAlert` for every existing row), `Severity`
  (Info, Warning, Critical), `Path` (where it opens, for example `/inventory/items/details/{id}`), `SubjectId` (the item, the
  order, the promotion), and `Data` (JSON for what only that kind needs: a stock alert keeps its level and quantity there).
  One migration script; existing rows become `StockAlert` with their item as the subject. Keep `ReadAt`; add an index on
  `(UserId, Kind, ReadAt)`.
- `GET /api/notifications` (filter by kind, paged, returns the total unread and the unread per kind), `POST
  /api/notifications/read` (some ids, a kind, or all). Any signed-in staff role may call them: a person only ever sees rows
  addressed to them, and each kind decides who is addressed. The `/api/stock-notifications` routes are removed once the app
  uses the new ones (no outside callers).
- One producer: `INotificationService.NotifyAsync(kind, userIds, title, body, path, subjectId, severity, data)` saves the rows
  and sends the push (the push `type` becomes `notification` with the same `path`; `stock-alert` is still understood for one
  release). `StockAlertService` keeps what is stock-specific (levels, the last-alerted state, recipients) and calls it.
- Per-kind rules stay with the kind: who is told, how not to repeat (stock alerts have `LastAlertStatus`; another kind needs
  its own), and the wording.

**Reminders and the bell.** A stock reminder lifts the item's existing row back to the top, unread, so the bell count and the
Inventory count go up again the same way a new alert would; the count of that kind and the bell total stay one number each.

**Kinds that could use it later (each is its own small change, none is planned yet)**

| Kind | Told | Today |
| --- | --- | --- |
| Stock alert | Stock roles, or the item's named people | Built (Phase 4) |
| Offline order held for review | Admins | A banner on the orders list |
| Online order waiting for approval | Cashiers and Admins | A banner and a push, no saved list |
| Promotion about to end or almost used up | Admins | Nothing |
| Item expiring soon, reorder list ready | Stock roles | Phase 8 would add them |
| Daily close not done | Admins | Nothing |

**Choices to make before building**

- **Panel or page only.** A panel (above) is quick to use on a phone; a page alone is less to build. Recommended: both.
- **Per-person switches.** Let each person mute a kind (a `NotificationPreferences` table, defaults by role). Recommended
  after the second kind exists, not before.
- **Keeping it small.** Delete read notifications after N days (for example 30) with the same daily catch-up job used for chat
  and images, and keep unread ones. Needs the number.
- **Online orders.** Whether the existing "awaiting approval" banner and push should also save a notification, or stay as they
  are (the banner already shows what is waiting).
- **When.** Build when a second kind is wanted; the first change (rename and generalise) is small and can be done then
  without touching how stock alerts work for the people using them.

**Tests and checks when built:** the migration keeps every existing stock alert and its read state; the bell count equals the
sum of the per-kind counts; reading a stock alert from the bell clears the Inventory counts and the other way round; a person
never sees another person's rows; the push carries the path; the existing Phase 4 specs and handler tests keep passing with the
new names; hand check on a throwaway database with a stock alert and a second kind side by side.

