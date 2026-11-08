## Dynamic Catalog Management Feature [Built, 6 Nov 2026; browser run and production check still to do]

**Built (6 Nov 2026; script `tools/sql/20261109_add_dynamic_catalog_columns.sql`, run it before deploying the API, then `tools/dbsync.bat`; already run on the local `WTF` database).** The three enums are gone. Categories, sub-categories and add-on types are rows the owner edits, and an add-on type carries its own selection rules, so a new type such as Temperature needs no code.

- **Schema.** `ProductCategories`, `ProductSubCategories` and `AddOnType` gain `SortOrder`, `IsActive` and audit columns; sub-categories gain `CategoryId` (FK to the parent category); add-on types gain `IsRequired`, `MinSelect`, `MaxSelect`. The script is safe on data that already exists: a column is added only when missing and its derived values are written in the same step, so a re-run changes nothing and never overwrites an owner's later edits; the parent category of each sub-category is the one most of its products already use (ties go to the lower id, an unused sub-category stays without a parent); Size and Flavor become required pick-one, Sauce at most one, matched by id **and** name so a renamed or different row is left alone; each table is its own transaction.
- **Rules.** `minimum = isRequired ? max(minSelect, 1) : minSelect`, `maximum = maxSelect > 0 ? maxSelect : unlimited`, pick-one means `maxSelect == 1`. They live in `WTF.Calculations/Orders/AddOnSelectionRules` (API; orders create and update through `AddOnTypeRuleCheck`, and promotion saves through `PromotionAddOnRules`) and in `shared/calculations/addon-selection.ts` (Angular). Both run the same shared cases in `calculation-cases.json`. Messages read "A size selection is required and must be exactly one." The old `PickOneAddOnRule` is removed.
- **API.** `GET /api/catalog` (`ProductsRead`; categories with their sub-categories and product counts, the unassigned sub-categories, add-on types with rules and counts), `POST/PUT /api/catalog/{categories|subcategories|addon-types}` and `PUT .../{id}/active` (`ProductsWrite`, audited as `CatalogCategorySaved`, `CatalogSubCategorySaved`, `CatalogAddOnTypeSaved`). Names are trimmed, 1 to 50 characters and unique; a sub-category needs an existing category; min above max is refused. **Turning off is refused** while active products still use a category or sub-category, while add-ons are still linked to a type, and always for Size (ingredient amounts depend on it). The lists also ride along in the POS catalog (`GET /api/sync/pos-catalog`) and the public catalog, so the register and the customer link need no extra call and work offline from the Dexie cache.
- **App.** `CatalogLookupService` (the one place names and rules are read; falls back to the last synced lists offline) and `CatalogSetupService`; every component that had an enum (product editor, lists, details, order editor, add-on selector, bundle selector, swappers, reports, public order page and picker) now reads the lookups. Management > **Catalog** (`/management/catalog`, read for `ProductsRead`, write for `ProductsWrite`): three lists (Categories, Sub-categories, Add-on Types) with add, edit, turn off and restore, the parent category picker, the required / minimum / maximum rule editor and product counts.
- **Fixed ids the app still knows** (`SYSTEM_CATALOG_IDS` and `SystemAddOnTypes`): Size 1, Extra 4 (the default type of a link), sub-category 4 Retail and category 4 Other (add-on products). Everything else comes from the lists.
- **Checking production first.** `tools/diagnostics/check_dynamic_catalog_before_migration.sql` is read only and written against the v1.19.0 schema (where those three tables have only `Id` and `Name`; the migration needs none of the later scripts). It shows the shape found, each sub-category's derived parent (with MIXED and "no products" notes), the rules each add-on type will get (including types that exist only in production), duplicate or blank names, and the latest scripts recorded. Run it, read it, then run the migration. It lives outside `tools/sql` because CI runs every script there on a tag build.
- **After migrating production:** Coffee, Non-Coffee and Snacks may all derive to Food if their products sit there; correct the parent on the Catalog page.
- **Tests.** .NET 2,903 passing (handlers, rules, the policy and route snapshots, the real SQL Server tests updated for the new columns); Angular 3,960 passing (`catalog.spec.ts`, both services, the rewritten add-on, bundle and public picker specs); `src/wtf-e2e/tests/management/catalog.spec.ts` for the API rules, a custom required pick-one type enforced on orders, and the screen.
- **Not built.** Drag-and-drop reordering (sort order is typed), a product count that opens the product list filtered, and the Temperature type itself (see "Temperature (Hot / Iced) as an add-on type"; its prerequisite is now met).

Original plan (kept for the endpoint and screen sketches; where it differs from the above, the above wins):

Currently, product categories (`ProductCategory`), subcategories
(`ProductSubCategory`), and add-on types (`AddOnType`) are referenced
by integer IDs that map to hardcoded enums (`ProductCategoryEnum`,
`ProductSubCategoryEnum`, `AddOnTypeEnum`). Adding a new category or
add-on type requires a code change, database insert, and redeployment.

This feature makes them fully dynamic - managed through the UI with no
code changes needed.

### Database Changes

**`ProductCategory` table** - add columns:

| Column       | Type         | Description                           |
| ------------ | ------------ | ------------------------------------- |
| `SortOrder`  | `int`        | Display order in POS (lower = first)  |
| `IsActive`   | `bit`        | Soft delete - hide without removing   |
| `CreatedAt`  | `datetime2`  | Audit timestamp                       |
| `CreatedBy`  | `GUID` (FK)  | Who created it                        |
| `UpdatedAt`  | `datetime2?` | Last update timestamp                 |
| `UpdatedBy`  | `GUID?` (FK) | Who last updated it                   |

**`ProductSubCategory` table** - same new columns as above, plus:

| Column       | Type         | Description                           |
| ------------ | ------------ | ------------------------------------- |
| `CategoryId` | `int` (FK)   | Link subcategory to parent category   |

Currently subcategories are independent of categories. Adding
`CategoryId` creates a proper hierarchy: Category -> Subcategory ->
Product.

**`AddOnType` table** - add columns:

| Column       | Type          | Description                          |
| ------------ | ------------- | ------------------------------------ |
| `IsRequired` | `bit`         | Must the customer pick at least one? |
| `MinSelect`  | `int`         | Minimum selections (0 = optional)    |
| `MaxSelect`  | `int`         | Maximum selections (0 = unlimited)   |
| `SortOrder`  | `int`         | Display order in the add-on selector |
| `IsActive`   | `bit`         | Soft delete                          |
| `CreatedAt`  | `datetime2`   | Audit timestamp                      |
| `CreatedBy`  | `GUID` (FK)   | Who created it                       |
| `UpdatedAt`  | `datetime2?`  | Last update timestamp                |
| `UpdatedBy`  | `GUID?` (FK)  | Who last updated it                  |

### Remove Hardcoded Enums

- Delete `ProductCategoryEnum`, `ProductSubCategoryEnum`,
  `AddOnTypeEnum` from the codebase
- Replace all enum references with dynamic lookups (the entities
  themselves become the source of truth)
- Update `PosCatalogDto` sync endpoint to include the full
  `AddOnType` records (with rules) so the POS can enforce them offline

### API Endpoints

**Categories** - `/api/categories`

| Method | Route              | Description                        |
| ------ | ------------------ | ---------------------------------- |
| GET    | `/api/categories`  | List all (with subcategories)      |
| POST   | `/api/categories`  | Create new category                |
| PUT    | `/api/categories/{id}` | Update name, sort order        |
| DELETE | `/api/categories/{id}` | Soft delete (set `IsActive=false`) |
| PUT    | `/api/categories/reorder` | Batch update sort orders    |

**Subcategories** - `/api/categories/{categoryId}/subcategories`

| Method | Route                                          | Description        |
| ------ | ---------------------------------------------- | ------------------ |
| GET    | `/api/categories/{categoryId}/subcategories`   | List for category  |
| POST   | `/api/categories/{categoryId}/subcategories`   | Create             |
| PUT    | `/api/subcategories/{id}`                      | Update             |
| DELETE | `/api/subcategories/{id}`                      | Soft delete        |
| PUT    | `/api/subcategories/reorder`                   | Batch sort orders  |

**Add-On Types** - `/api/addon-types`

| Method | Route                | Description                        |
| ------ | -------------------- | ---------------------------------- |
| GET    | `/api/addon-types`   | List all (with rules)              |
| POST   | `/api/addon-types`   | Create with name + rules           |
| PUT    | `/api/addon-types/{id}` | Update name, rules, sort order  |
| DELETE | `/api/addon-types/{id}` | Soft delete                     |
| PUT    | `/api/addon-types/reorder` | Batch sort orders            |

### Frontend - Management UI

New routes under `/management/catalog/`:

**Categories page** (`/management/catalog/categories`):
- List all categories with their subcategories in a tree view
- Inline edit category/subcategory names
- Drag-and-drop or up/down arrows to reorder
- Toggle active/inactive with a switch
- "Add Category" and "Add Subcategory" buttons
- Delete confirmation modal - warn if products exist under it
- When deactivating, show count of affected products

**Add-On Types page** (`/management/catalog/addon-types`):
- List all add-on types with their current rules displayed
- Edit form per add-on type:
  - Name (text input)
  - Required toggle (yes/no)
  - Selection mode: Single / Multiple
  - Min selections (number, 0 = optional)
  - Max selections (number, 0 = unlimited)
- Reorder via drag-and-drop or arrows
- Show count of products using each add-on type

### Frontend - POS Enforcement

Update the order editor's add-on selector to enforce the dynamic rules:

- Read `AddOnType.IsRequired`, `MinSelect`, `MaxSelect` from the
  cached catalog (synced via `PosCatalogDto`)
- **Required types:** Show a visual indicator (red asterisk) and
  prevent order submission until selection is made
- **Min/Max:** Show counter (e.g., "Select 2-4") and disable the
  "Save" button until valid
- **Single select:** Radio-button style selection
- **Multi select:** Checkbox style selection
- Show validation errors inline (e.g., "Size is required",
  "Select at least 2 toppings")

### Migration Strategy

1. Run EF Core migration to add new columns with defaults
   (`SortOrder=0`, `IsActive=true`, `IsRequired=false`,
   `MinSelect=0`, `MaxSelect=0`)
2. Populate `SubCategory.CategoryId` based on current usage patterns
3. Replace enum references in handlers/DTOs with entity lookups
4. Deploy API changes
5. Deploy frontend management UI
6. Update POS catalog sync to include add-on type rules
7. Update POS add-on selector to enforce rules





