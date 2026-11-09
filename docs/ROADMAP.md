# WTF POS - Feature Roadmap

This is the index. Each feature's full design, decisions and status live in its own file under `docs/roadmap/`.
Open only the file for the feature you are working on; do not load them all. When a feature's status or design changes,
update its file and the status in the table below.

| Feature | Status | File |
| ------- | ------ | ---- |
| Offline (phases 1-7) | Phases 1-6 completed, 7 planned (judge at sale time, stock, limits) | [offline](roadmap/offline.md) |
| Inventory (phases 1-9, notifications, polish pass) | Phases 1-5, 7 (slices 1-2) and 9 built; 6 slices 1-3 and 5 built; 8 built on branch `inventory-phase-8`, not merged (suppliers, receiving, par levels and reorder list, purchase orders; expiry, returns, barcode scanning and units still to plan); production polish pass planned | [inventory](roadmap/inventory.md) (overview, polish pass; phases in [1](roadmap/inventory-phase1-stock.md), [2-4](roadmap/inventory-phases2-4-alerts-notifications.md), [5-9](roadmap/inventory-phases5-9-costing-profit.md)) |
| Drink Recipe Guide | Nice to have, planned | [drink-recipe-guide](roadmap/drink-recipe-guide.md) |
| Auto-Update | Completed | [auto-update](roadmap/auto-update.md) |
| Audit Log | Completed | [audit-log](roadmap/audit-log.md) |
| Sales Reporting (phases 1-4) | Implemented, checked | [sales-reporting](roadmap/sales-reporting.md) |
| Multiple Branches, Branding, Multi-tenant | Planned, design decided | [multiple-branches-and-tenants](roadmap/multiple-branches-and-tenants.md) |
| Role-Based Access Control | In progress (phases 1 and 2 built on branches, not merged) | [role-based-access](roadmap/role-based-access.md) |
| Block features by subscription plan | Planned, plan written, decisions open | [block-features-by-plan](roadmap/block-features-by-plan.md) |
| Senior Citizen / PWD discount | Planned, confirm the rules first | [senior-pwd-discount](roadmap/senior-pwd-discount.md) |
| Cashless Payments | Planned, needs research | [cashless-payments](roadmap/cashless-payments.md) |
| Receipt and Kitchen Printing | Planned | [receipt-and-kitchen-printing](roadmap/receipt-and-kitchen-printing.md) |
| Temperature (Hot / Iced) add-on type | Planned (its prerequisite, the dynamic catalog, is built) | [temperature-addon](roadmap/temperature-addon.md) |
| Setup lists (units and similar) | Setup page built; units and other lists planned | [setup-lists](roadmap/setup-lists.md) |
| Dynamic Catalog Management | Built 6 Nov 2026; browser run and production check to do | [dynamic-catalog](roadmap/dynamic-catalog.md) |
| Promotions / Bundles | Phase 1 completed; ideas for later | [promotions](roadmap/promotions.md) |
| Automated Testing Plan | Mostly completed | [automated-testing](roadmap/automated-testing.md) |
| Customer Ordering Links | Completed | [customer-ordering-links](roadmap/customer-ordering-links.md) (design; [build history](roadmap/customer-ordering-links-build-history.md)) |
| Button States and Text Audit | Partly done | [button-audit](roadmap/button-audit.md) |
| Completed Order Override | Implemented | [order-override](roadmap/order-override.md) |
| Image Storage CORS | Completed | [image-storage-cors](roadmap/image-storage-cors.md) |
| Stale Image Cleanup | Completed | [stale-image-cleanup](roadmap/stale-image-cleanup.md) |
| Chat Images and Message Expiry | Completed | [chat-images-and-expiry](roadmap/chat-images-and-expiry.md) |

Keywords to find the right file: stock, waste, costing, recipes, counts, variance, profit, expenses, notifications, bell,
roles, permissions -> role-based-access; branches -> inventory or multiple-branches-and-tenants; promotions, coupons, bundles -> promotions; offline sync, review
-> offline; reports, dashboard -> sales-reporting; customer link, chat -> customer-ordering-links, chat-images-and-expiry;
add-on types, categories -> dynamic-catalog; browser or unit tests -> automated-testing.
