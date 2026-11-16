using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Inventory.Counts;
using WTF.Api.Features.Inventory.Purchasing;
using WTF.Api.Features.Inventory.Waste;
using WTF.Api.Features.Orders.Enums;
using WTF.Api.Features.Platform;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Api.Features.Subscriptions;
using WTF.Api.Features.Users.Enums;
using WTF.Calculations.Orders;
using WTF.Calculations.Sales;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

// Demo data for the STAGING database only. Run by the "Build and Deploy" workflow after the SQL scripts.
//
//   STAGING_SQL        connection string of the staging database (required)
//   STAGING_PASSWORD   password for every demo account (required, at least 12 characters, never stored in the repo)
//
// Safe to run again and again: a row is added only when it does not exist yet, found by its name or code (orders and
// expenses by a "[staging seed]" note). Existing rows and passwords are never changed or deleted. The only edits to
// existing rows are on the shop settings, where empty fields are filled and Senior/PWD is switched on.

const string PlatformUsername = "platformadmin";
const string OwnerUsername = "admin";
const string Marker = "[staging seed] ";
var starterTenantId = new Guid("00000000-0000-0000-0000-0000000000a2");

var connectionString = Environment.GetEnvironmentVariable("STAGING_SQL");
var password = Environment.GetEnvironmentVariable("STAGING_PASSWORD");
if (string.IsNullOrWhiteSpace(connectionString) || string.IsNullOrEmpty(password) || password.Length < 12)
{
    Console.Error.WriteLine("Set STAGING_SQL and STAGING_PASSWORD (at least 12 characters).");
    return 1;
}

var options = new DbContextOptionsBuilder<WTFDbContext>().UseSqlServer(connectionString).Options;
var hash = BCrypt.Net.BCrypt.HashPassword(password);
var added = new List<string>();
var now = DateTime.UtcNow;
var shopId = TenantDefaults.DefaultTenantId;

await using (var probe = new SeedContext(options, shopId))
{
    if (!await probe.Tenants.AnyAsync(t => t.Id == shopId))
    {
        Console.Error.WriteLine("The default shop does not exist. Apply the SQL scripts in tools/sql first.");
        return 1;
    }
}

await SeedPlatformAsync();
await SeedMainShopAsync();
await SeedStarterShopAsync();

Console.WriteLine(added.Count == 0 ? "Nothing to add, staging already has the demo data." : $"Added {added.Count} things:\n  " + string.Join("\n  ", added));
return 0;

async Task SeedPlatformAsync()
{
    await using var db = new SeedContext(options, shopId);
    if (!await db.PlatformAdmins.AnyAsync(p => p.Username == PlatformUsername))
    {
        db.PlatformAdmins.Add(new PlatformAdmin { Username = PlatformUsername, PasswordHash = hash, IsActive = true, CreatedAt = now });
        await db.SaveChangesAsync();
        added.Add($"platform admin {PlatformUsername}");
    }
}

async Task SeedMainShopAsync()
{
    await using var db = new SeedContext(options, shopId);

    var topPlan = await db.Plans.OrderByDescending(p => p.SortOrder).FirstOrDefaultAsync(p => p.IsActive);
    if (topPlan is not null && !await db.TenantSubscriptions.AnyAsync(s => s.TenantId == shopId))
    {
        db.TenantSubscriptions.Add(NewSubscription(shopId, topPlan.Id, 12));
        await db.SaveChangesAsync();
        added.Add($"subscription on the {topPlan.Name} plan");
    }

    var settings = await db.TenantSettings.FirstOrDefaultAsync(s => s.TenantId == shopId);
    if (settings is not null)
    {
        var filled = !settings.SeniorPwdEnabled;
        settings.SeniorPwdEnabled = true;
        settings.Address = Fill(settings.Address, "1 Coffee Street, Makati City", ref filled);
        settings.Phone = Fill(settings.Phone, "02 8123 4567", ref filled);
        settings.ReceiptHeader = Fill(settings.ReceiptHeader, "Thank you for visiting!", ref filled);
        settings.ReceiptFooter = Fill(settings.ReceiptFooter, "This is not an official receipt.", ref filled);
        if (filled)
        {
            await db.SaveChangesAsync();
            added.Add("shop settings (Senior/PWD on, receipt text)");
        }
    }

    // Accounts: one per role, same password
    var accounts = new (string Username, string First, UserRoleEnum Role)[]
    {
        (OwnerUsername, "Admin", UserRoleEnum.Owner),
        ("manager", "Manager", UserRoleEnum.Admin),
        ("cashier", "Cashier", UserRoleEnum.Cashier),
        ("viewer", "Viewer", UserRoleEnum.AdminViewer),
        ("stockmgr", "Stock", UserRoleEnum.StockManager),
        ("itemmgr", "Item", UserRoleEnum.ItemManager),
    };

    foreach (var (username, first, role) in accounts)
    {
        if (await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Username == username))
        {
            continue;
        }

        db.Users.Add(NewUser(username, first, role, shopId));
        added.Add($"user {username} ({role})");
    }

    await db.SaveChangesAsync();

    var owner = await db.Users.IgnoreQueryFilters().FirstAsync(u => u.Username == OwnerUsername);
    var cashier = await db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Username == "cashier") ?? owner;
    var manager = await db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Username == "manager") ?? owner;

    // Categories and add-on types have ids chosen by the app, unique across all shops
    var categories = await EnsureCategoriesAsync(db, shopId);
    var addOnTypes = await EnsureAddOnTypesAsync(db, shopId);
    await EnsureWasteReasonsAsync(db, shopId);
    await db.SaveChangesAsync();

    var coffeeSub = await EnsureSubCategoryAsync(db, shopId, "Coffee", categories["Drink"]);
    var nonCoffeeSub = await EnsureSubCategoryAsync(db, shopId, "NonCoffee", categories["Drink"]);
    await db.SaveChangesAsync();

    // Menu
    var menu = new (string Code, string Name, decimal Price, string Category, int? Sub, bool SeniorPwd)[]
    {
        ("STG-ESP", "Espresso", 90m, "Drink", coffeeSub, true),
        ("STG-LAT", "Latte", 140m, "Drink", coffeeSub, true),
        ("STG-CAP", "Cappuccino", 140m, "Drink", coffeeSub, true),
        ("STG-ICE", "Iced Americano", 120m, "Drink", coffeeSub, true),
        ("STG-MAT", "Matcha Latte", 160m, "Drink", nonCoffeeSub, true),
        ("STG-CRO", "Croissant", 95m, "Food", null, true),
        ("STG-SND", "Ham and Cheese Sandwich", 180m, "Food", null, true),
        ("STG-CAK", "Chocolate Cake Slice", 150m, "Dessert", null, true),
        ("STG-BEA", "Coffee Beans 250g", 480m, "Other", null, false),
    };
    var products = new Dictionary<string, Product>();
    foreach (var (code, name, price, category, sub, seniorPwd) in menu)
    {
        products[name] = await EnsureProductAsync(db, shopId, owner.Id, code, name, price, categories[category], sub, seniorPwd, false);
    }

    // Add-ons are products flagged as add-ons, linked to the drinks through ProductAddOns
    var addOns = new (string Type, string Code, string Name, decimal Price, bool IsDefault)[]
    {
        ("Size", "STG-AO-MED", "Medium", 0m, true),
        ("Size", "STG-AO-LRG", "Large", 30m, false),
        ("Temperature", "STG-AO-HOT", "Hot", 0m, true),
        ("Temperature", "STG-AO-ICD", "Iced", 10m, false),
        ("Flavor", "STG-AO-VAN", "Vanilla", 25m, false),
        ("Flavor", "STG-AO-CAR", "Caramel", 25m, false),
        ("Flavor", "STG-AO-HAZ", "Hazelnut", 25m, false),
        ("Topping", "STG-AO-WHP", "Whipped Cream", 20m, false),
        ("Extra", "STG-AO-SHT", "Extra Shot", 35m, false),
        ("Extra", "STG-AO-OAT", "Oat Milk", 40m, false),
    };
    var addOnProducts = new Dictionary<string, Product>();
    foreach (var (type, code, name, price, _) in addOns)
    {
        addOnProducts[name] = await EnsureProductAsync(db, shopId, owner.Id, code, name, price, categories["Other"], null, false, true);
    }

    var drinksAddOns = new Dictionary<string, string[]>
    {
        ["Espresso"] = ["Size", "Extra"],
        ["Latte"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Cappuccino"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Iced Americano"] = ["Size", "Extra", "Temperature"],
        ["Matcha Latte"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
    };
    foreach (var (drink, types) in drinksAddOns)
    {
        foreach (var (type, _, name, _, isDefault) in addOns.Where(a => types.Contains(a.Type)))
        {
            var drinkId = products[drink].Id;
            var addOnId = addOnProducts[name].Id;
            if (!await db.ProductAddOns.IgnoreQueryFilters().AnyAsync(p => p.ProductId == drinkId && p.AddOnId == addOnId))
            {
                db.ProductAddOns.Add(new ProductAddOn
                {
                    ProductId = drinkId,
                    AddOnId = addOnId,
                    AddOnTypeId = addOnTypes[type],
                    IsActive = true,
                    IsDefault = isDefault,
                    TenantId = shopId,
                });
            }
        }
    }

    await db.SaveChangesAsync();

    // Suppliers and stock items
    var beansSupplier = await EnsureSupplierAsync(db, shopId, owner.Id, "Bean Brothers Trading", "Rico Bean", "09175550101", 3);
    var dairySupplier = await EnsureSupplierAsync(db, shopId, owner.Id, "Metro Dairy Supply", "Lina Gatas", "09175550102", 1);
    await db.SaveChangesAsync();

    // Quantity at the start; thresholds make one item fine, one low and one near critical
    var itemRows = new (string Name, string Unit, decimal Start, decimal Warning, decimal Critical, decimal Cost, Supplier Supplier, string Pack, decimal PackUnits, decimal PackPrice)[]
    {
        ("Espresso Beans", "g", 4000m, 1000m, 300m, 0.9m, beansSupplier, "1 kg bag", 1000m, 900m),
        ("Fresh Milk", "ml", 800m, 1000m, 300m, 0.085m, dairySupplier, "1 L carton", 1000m, 85m),
        ("Matcha Powder", "g", 100m, 300m, 150m, 3.5m, beansSupplier, "100 g tin", 100m, 350m),
    };
    var items = new Dictionary<string, Item>();
    foreach (var (name, unit, start, warning, critical, cost, supplier, pack, packUnits, packPrice) in itemRows)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Name == name);
        if (item is null)
        {
            item = new Item
            {
                Id = Guid.NewGuid(),
                Name = name,
                UnitName = unit,
                CurrentQuantity = 0m,
                WarningQuantity = warning,
                CriticalQuantity = critical,
                CostPrice = cost,
                AverageCost = cost,
                YieldPercent = 100m,
                IsActive = true,
                CreatedAt = now,
                CreatedBy = owner.Id,
                TenantId = shopId,
            };
            db.Items.Add(item);
            Move(db, item, StockMovementTypes.AddStock, start, owner.Id, shopId, null, null, "Opening stock", cost);
            db.ItemSuppliers.Add(new ItemSupplier
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                SupplierId = supplier.Id,
                PackName = pack,
                UnitsPerPack = packUnits,
                PackPrice = packPrice,
                IsPreferred = true,
                CreatedAt = now,
                CreatedBy = owner.Id,
                TenantId = shopId,
            });
            added.Add($"stock item {name}");
        }

        items[name] = item;
    }

    await db.SaveChangesAsync();

    // Recipes: what one sale takes out of stock
    var recipes = new (string Product, string Item, decimal Quantity)[]
    {
        ("Espresso", "Espresso Beans", 18m),
        ("Latte", "Espresso Beans", 18m),
        ("Latte", "Fresh Milk", 200m),
        ("Cappuccino", "Espresso Beans", 18m),
        ("Cappuccino", "Fresh Milk", 150m),
        ("Iced Americano", "Espresso Beans", 18m),
        ("Matcha Latte", "Matcha Powder", 5m),
        ("Matcha Latte", "Fresh Milk", 200m),
    };
    foreach (var (product, item, quantity) in recipes)
    {
        var productId = products[product].Id;
        var itemId = items[item].Id;
        if (!await db.ProductItemLinks.AnyAsync(l => l.ProductId == productId && l.ItemId == itemId))
        {
            db.ProductItemLinks.Add(new ProductItemLink
            {
                Id = Guid.NewGuid(),
                ProductId = productId,
                ItemId = itemId,
                QuantityPerSale = quantity,
                IsActive = true,
                CreatedAt = now,
                CreatedBy = owner.Id,
                TenantId = shopId,
            });
            added.Add($"recipe {product} uses {item}");
        }
    }

    await db.SaveChangesAsync();

    // Stock history: a receipt, two waste entries, two purchase orders and an open count
    if (!await db.StockReceipts.AnyAsync(r => r.Note != null && r.Note.StartsWith(Marker)))
    {
        var receipt = new StockReceipt
        {
            Id = Guid.NewGuid(),
            SupplierId = beansSupplier.Id,
            ReceivedOn = DateOnly.FromDateTime(now.AddDays(-2)),
            InvoiceNumber = "BB-2026-0412",
            InvoiceTotal = 1250m,
            Note = Marker + "weekly delivery",
            CreatedAt = now.AddDays(-2),
            CreatedBy = manager.Id,
            TenantId = shopId,
        };
        db.StockReceipts.Add(receipt);
        foreach (var (itemName, packs, packUnits, packPrice) in new[] { ("Espresso Beans", 1m, 1000m, 900m), ("Matcha Powder", 1m, 100m, 350m) })
        {
            var item = items[itemName];
            var quantity = packs * packUnits;
            var movement = Move(db, item, StockMovementTypes.AddStock, quantity, manager.Id, shopId, StockMovementTypes.StockReceiptReference, receipt.Id, "Received", packPrice / packUnits);
            db.StockReceiptLines.Add(new StockReceiptLine
            {
                Id = Guid.NewGuid(),
                ReceiptId = receipt.Id,
                ItemId = item.Id,
                PackName = itemName == "Matcha Powder" ? "100 g tin" : "1 kg bag",
                Packs = packs,
                UnitsPerPack = packUnits,
                PackPrice = packPrice,
                Quantity = quantity,
                UnitCost = packPrice / packUnits,
                MovementId = movement.Id,
                TenantId = shopId,
            });
        }

        added.Add("stock receipt");
    }

    var reasons = await db.WasteReasons.ToListAsync();
    if (!await db.StockWastes.AnyAsync(w => w.Notes != null && w.Notes.StartsWith(Marker)))
    {
        foreach (var (itemName, quantity, reasonName, status, review) in new[]
                 {
                     ("Fresh Milk", 100m, "Spilled or dropped", StockWasteStatuses.Recorded, false),
                     ("Matcha Powder", 20m, "Expired or spoiled", StockWasteStatuses.PendingReview, true),
                 })
        {
            var reason = reasons.FirstOrDefault(r => r.Name == reasonName);
            if (reason is null)
            {
                continue;
            }

            var item = items[itemName];
            var movement = Move(db, item, StockMovementTypes.Waste, -quantity, cashier.Id, shopId, StockMovementTypes.StockWasteReference, null, "Waste", item.CostPrice);
            db.StockWastes.Add(new StockWaste
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                StockMovementId = movement.Id,
                Quantity = quantity,
                WasteReasonId = reason.Id,
                ReasonName = reason.Name,
                Notes = Marker + reasonName,
                Status = status,
                RequiresReview = review,
                CreatedAt = now.AddDays(-1),
                CreatedBy = cashier.Id,
                TenantId = shopId,
            });
        }

        added.Add("2 waste entries (one waiting for review)");
    }

    if (!await db.PurchaseOrders.AnyAsync(p => p.Note != null && p.Note.StartsWith(Marker)))
    {
        var nextPo = (await db.PurchaseOrders.IgnoreQueryFilters().Where(p => p.TenantId == shopId).MaxAsync(p => (int?)p.PoNumber) ?? 0) + 1;
        foreach (var (supplier, status, itemName, packs, note) in new[]
                 {
                     (dairySupplier, PurchaseOrderStatuses.Sent, "Fresh Milk", 10m, "milk restock (sent)"),
                     (beansSupplier, PurchaseOrderStatuses.Draft, "Espresso Beans", 5m, "beans (draft)"),
                 })
        {
            var item = items[itemName];
            var poId = Guid.NewGuid();
            db.PurchaseOrders.Add(new PurchaseOrder
            {
                Id = poId,
                TenantId = shopId,
                PoNumber = nextPo++,
                SupplierId = supplier.Id,
                Status = status,
                ExpectedOn = DateOnly.FromDateTime(now.AddDays(3)),
                Note = Marker + note,
                CreatedAt = now.AddDays(-1),
                CreatedBy = manager.Id,
                SentAt = status == PurchaseOrderStatuses.Sent ? now.AddDays(-1) : null,
                SentBy = status == PurchaseOrderStatuses.Sent ? manager.Id : null,
            });
            db.PurchaseOrderLines.Add(new PurchaseOrderLine
            {
                Id = Guid.NewGuid(),
                TenantId = shopId,
                PurchaseOrderId = poId,
                ItemId = item.Id,
                PackName = itemName == "Fresh Milk" ? "1 L carton" : "1 kg bag",
                UnitsPerPack = itemName == "Fresh Milk" ? 1000m : 1000m,
                PackPrice = itemName == "Fresh Milk" ? 85m : 900m,
                PacksOrdered = packs,
                PacksReceived = 0m,
            });
        }

        added.Add("2 purchase orders (sent and draft)");
    }

    if (!await db.StockCounts.AnyAsync(c => c.Name.StartsWith(Marker)))
    {
        var count = new StockCount
        {
            Id = Guid.NewGuid(),
            Name = Marker + "weekly count",
            Status = StockCountStatuses.Open,
            IsBlind = false,
            CreatedAt = now.AddHours(-3),
            CreatedBy = manager.Id,
            TenantId = shopId,
        };
        db.StockCounts.Add(count);
        var counted = true;
        foreach (var item in items.Values)
        {
            db.StockCountLines.Add(new StockCountLine
            {
                Id = Guid.NewGuid(),
                CountId = count.Id,
                ItemId = item.Id,
                ExpectedQuantity = item.CurrentQuantity,
                CountedQuantity = counted ? item.CurrentQuantity - 25m : null,
                CountedAt = counted ? now.AddHours(-2) : null,
                CountedBy = counted ? manager.Id : null,
                TenantId = shopId,
            });
            counted = false;
        }

        added.Add("open stock count");
    }

    await db.SaveChangesAsync();

    // Promotions, one of each type
    await EnsurePromotionAsync(db, "Latte Happy Price", PromotionTypeIds.DiscountedProduct, owner.Id, promo =>
        db.DiscountedProductPromotions.Add(new DiscountedProductPromotion
        {
            Id = Guid.NewGuid(),
            PromotionId = promo.Id,
            ProductId = products["Latte"].Id,
            FixedPrice = 120m,
            TenantId = shopId,
        }));
    await EnsurePromotionAsync(db, "Coffee and Croissant Bundle", PromotionTypeIds.FixedBundle, owner.Id, promo =>
    {
        db.FixedBundlePromotions.Add(new FixedBundlePromotion { PromotionId = promo.Id, BundlePrice = 200m, TenantId = shopId });
        foreach (var name in new[] { "Latte", "Croissant" })
        {
            db.FixedBundlePromotionItems.Add(new FixedBundlePromotionItem
            {
                Id = Guid.NewGuid(),
                FixedBundlePromotionId = promo.Id,
                ProductId = products[name].Id,
                Quantity = 1,
                TenantId = shopId,
            });
        }
    });
    await EnsurePromotionAsync(db, "Any 2 Bites for 200", PromotionTypeIds.MixMatch, owner.Id, promo =>
    {
        db.MixMatchPromotions.Add(new MixMatchPromotion { PromotionId = promo.Id, RequiredQuantity = 2, BundlePrice = 200m, TenantId = shopId });
        foreach (var name in new[] { "Croissant", "Chocolate Cake Slice", "Ham and Cheese Sandwich" })
        {
            db.MixMatchPromotionProducts.Add(new MixMatchPromotionProduct
            {
                Id = Guid.NewGuid(),
                MixMatchPromotionId = promo.Id,
                ProductId = products[name].Id,
                TenantId = shopId,
            });
        }
    });
    await db.SaveChangesAsync();

    // Customers
    var customerRows = new (string First, string? Last, string? Address, string? Phone, bool Link)[]
    {
        ("Maria", "Santos", "12 Rizal Street, Barangay Poblacion, Makati City", "09171234567", true),
        ("Juan", "Dela Cruz", "45 Mabini Avenue, Quezon City", "09181234567", false),
        ("Ana", null, null, null, false),
    };
    var customers = new Dictionary<string, Customer>();
    foreach (var (first, last, address, phone, link) in customerRows)
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.FirstName == first && c.LastName == last);
        if (customer is null)
        {
            customer = new Customer
            {
                Id = Guid.NewGuid(),
                FirstName = first,
                LastName = last,
                Address = address,
                ContactNumber = phone,
                AllowOrderingLink = link,
                IsActive = true,
                CreatedAt = now,
                CreatedBy = owner.Id,
                TenantId = shopId,
            };
            db.Customers.Add(customer);
            added.Add($"customer {first} {last}".TrimEnd());
        }

        customers[first] = customer;
    }

    // Expenses over the last weeks, in the shop's time zone
    var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila")));
    var expenses = new (byte Category, decimal Amount, string Note, int DaysAgo)[]
    {
        (ExpenseCategories.Rent, 15000m, "Monthly rent", 14),
        (ExpenseCategories.Utilities, 3200m, "Electricity and water", 10),
        (ExpenseCategories.Supplies, 1800m, "Cups, lids and napkins", 6),
        (ExpenseCategories.Marketing, 2500m, "Flyers and social media boost", 5),
        (ExpenseCategories.Delivery, 450m, "Courier for a catering order", 3),
        (ExpenseCategories.Other, 600m, "Repair of the grinder", 1),
    };
    foreach (var (category, amount, note, daysAgo) in expenses)
    {
        var text = Marker + note;
        if (await db.Expenses.AnyAsync(e => e.Note == text))
        {
            continue;
        }

        db.Expenses.Add(new Expense
        {
            Id = Guid.NewGuid(),
            ExpenseDate = today.AddDays(-daysAgo),
            Category = category,
            Amount = amount,
            Note = text,
            IsActive = true,
            CreatedAt = now,
            CreatedBy = manager.Id,
            TenantId = shopId,
        });
        added.Add($"expense {note}");
    }

    await db.SaveChangesAsync();

    // Orders in each state. Totals come from the lines (and WTF.Calculations for Senior/PWD), the same way the app works them out.
    if (!await db.Orders.AnyAsync(o => o.Note != null && o.Note.StartsWith(Marker)))
    {
        var vatRegistered = settings?.VatRegistered ?? false;
        var specs = new List<OrderSpec>
        {
            new("cash sale, 3 days ago", OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -72, [new("Latte", 2, ["Large", "Vanilla"]), new("Croissant", 1, [])]),
            new("gcash sale, 2 days ago", OrderStatusEnum.Completed, PaymentMethodEnum.GCash, "Maria", -48, [new("Cappuccino", 1, ["Medium"]), new("Chocolate Cake Slice", 1, [])]),
            new("cash sale with tips", OrderStatusEnum.Completed, PaymentMethodEnum.Cash, "Juan", -30, [new("Matcha Latte", 1, ["Large", "Iced", "Oat Milk"])], Tips: 20m),
            new("promo price on Latte", OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -24, [new("Latte", 1, ["Medium"], PromoPrice: 120m, PromoLabel: "Latte Happy Price")]),
            new("senior citizen discount", OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -12, [new("Iced Americano", 1, ["Medium"]), new("Croissant", 2, [])], Senior: SeniorPwdKind.Senior),
            new("pwd discount", OrderStatusEnum.Completed, PaymentMethodEnum.GCash, "Ana", -6, [new("Espresso", 2, ["Extra Shot"])], Senior: SeniorPwdKind.Pwd),
            new("held order (pending)", OrderStatusEnum.Pending, null, "Maria", -1, [new("Latte", 1, ["Hot"]), new("Ham and Cheese Sandwich", 1, [])]),
            new("cancelled order", OrderStatusEnum.Cancelled, null, null, -20, [new("Espresso", 1, [])]),
            new("refunded order", OrderStatusEnum.Refunded, PaymentMethodEnum.Cash, null, -36, [new("Croissant", 3, [])]),
            new("customer link order waiting approval", OrderStatusEnum.PendingApproval, null, "Maria", -2, [new("Cappuccino", 2, ["Large", "Caramel"])], FromLink: true),
        };

        var statusIds = await db.Statuses.Select(s => s.Id).ToListAsync();
        foreach (var spec in specs.Where(s => statusIds.Contains((int)s.Status)).OrderBy(s => s.HoursAgo))
        {
            AddOrder(db, spec, products, addOnProducts, customers, spec.FromLink ? owner : cashier, shopId, now, vatRegistered);
            await db.SaveChangesAsync();
        }

        await db.SaveChangesAsync();
        added.Add($"{specs.Count} orders (completed, held, cancelled, refunded, senior, PWD, customer link)");
    }

    await db.SaveChangesAsync();
}

async Task SeedStarterShopAsync()
{
    await using var db = new SeedContext(options, starterTenantId);
    if (await db.Tenants.AnyAsync(t => t.Id == starterTenantId))
    {
        return;
    }

    var starter = await db.Plans.FirstOrDefaultAsync(p => p.Code == "starter");
    if (starter is null)
    {
        added.Add("(second shop skipped: there is no Starter plan)");
        return;
    }

    db.Tenants.Add(new Tenant { Id = starterTenantId, Name = "Starter Demo Cafe", Slug = "starter-demo", Status = TenantStatus.Active, CreatedAt = now });
    await db.SaveChangesAsync();

    db.TenantSubscriptions.Add(NewSubscription(starterTenantId, starter.Id, 1));
    await db.SaveChangesAsync();

    await BrandDefaults.SaveAsync(db, starterTenantId, BrandDefaults.For("Starter Demo Cafe"), CancellationToken.None);

    var ownerUser = NewUser("starterowner", "Starter", UserRoleEnum.Owner, starterTenantId);
    var linkUser = NewUser("starter-link", "Customer", UserRoleEnum.Cashier, starterTenantId);
    linkUser.IsActive = false;
    linkUser.LastName = "Link";
    db.Users.Add(ownerUser);
    db.Users.Add(linkUser);
    await db.SaveChangesAsync();

    await using (var transaction = await db.Database.BeginTransactionAsync())
    {
        await TenantCatalogTemplate.CopyAsync(db, starterTenantId, ownerUser.Id, CancellationToken.None);
        await transaction.CommitAsync();
    }

    var drinkCategory = await db.ProductCategories.FirstOrDefaultAsync(c => c.Name == "Drink");
    if (drinkCategory is not null)
    {
        await EnsureProductAsync(db, starterTenantId, ownerUser.Id, "STG2-ESP", "Espresso", 90m, drinkCategory.Id, null, true, false);
        await EnsureProductAsync(db, starterTenantId, ownerUser.Id, "STG2-LAT", "Latte", 140m, drinkCategory.Id, null, true, false);
    }

    db.Customers.Add(new Customer
    {
        Id = Guid.NewGuid(),
        FirstName = "Pedro",
        LastName = "Reyes",
        Address = "7 Bonifacio Street, Pasig City",
        IsActive = true,
        CreatedAt = now,
        CreatedBy = ownerUser.Id,
        TenantId = starterTenantId,
    });

    db.TenantInvoices.Add(new TenantInvoice
    {
        Id = Guid.NewGuid(),
        TenantId = starterTenantId,
        PlanId = starter.Id,
        PeriodStart = now,
        PeriodEnd = now.AddMonths(1),
        Months = 1,
        Amount = starter.MonthlyPrice,
        Status = SubscriptionNames.InvoiceOpen,
        DueDate = now.AddDays(7),
        Notes = Marker + "first month",
        CreatedAt = now,
    });
    await db.SaveChangesAsync();
    added.Add("second shop 'Starter Demo Cafe' on the Starter plan (owner starterowner, small menu, open invoice)");
}

TenantSubscription NewSubscription(Guid tenantId, int planId, int months) => new()
{
    TenantId = tenantId,
    PlanId = planId,
    CurrentPeriodStart = now,
    CurrentPeriodEnd = now.AddMonths(months),
    GraceDays = 7,
    UpdatedAt = now,
};

User NewUser(string username, string firstName, UserRoleEnum role, Guid tenantId)
{
    var id = Guid.NewGuid();
    return new User
    {
        Id = id,
        Username = username,
        PasswordHash = hash,
        FirstName = firstName,
        LastName = "Staging",
        IsActive = true,
        RoleId = (int)role,
        CreatedAt = now,
        CreatedBy = id,
        TenantId = tenantId,
    };
}

static string? Fill(string? current, string value, ref bool changed)
{
    if (!string.IsNullOrWhiteSpace(current))
    {
        return current;
    }

    changed = true;
    return value;
}

async Task<Dictionary<string, int>> EnsureCategoriesAsync(WTFDbContext db, Guid tenantId)
{
    var result = new Dictionary<string, int>();
    var nextId = (await db.ProductCategories.IgnoreQueryFilters().MaxAsync(c => (int?)c.Id) ?? 0) + 1;
    foreach (var (name, sort) in new[] { ("Drink", 1), ("Food", 2), ("Dessert", 3), ("Other", 4) })
    {
        var category = await db.ProductCategories.FirstOrDefaultAsync(c => c.Name == name);
        if (category is null)
        {
            category = new ProductCategory { Id = nextId++, Name = name, SortOrder = sort, IsActive = true, CreatedAt = now, TenantId = tenantId };
            db.ProductCategories.Add(category);
            added.Add($"category {name}");
        }

        result[name] = category.Id;
    }

    return result;
}

async Task<int> EnsureSubCategoryAsync(WTFDbContext db, Guid tenantId, string name, int categoryId)
{
    var sub = await db.ProductSubCategories.FirstOrDefaultAsync(s => s.Name == name);
    if (sub is null)
    {
        var nextId = (await db.ProductSubCategories.IgnoreQueryFilters().MaxAsync(s => (int?)s.Id) ?? 0) + 1;
        sub = new ProductSubCategory { Id = nextId, Name = name, SortOrder = nextId, IsActive = true, CategoryId = categoryId, CreatedAt = now, TenantId = tenantId };
        db.ProductSubCategories.Add(sub);
        await db.SaveChangesAsync();
        added.Add($"subcategory {name}");
    }

    return sub.Id;
}

async Task<Dictionary<string, int>> EnsureAddOnTypesAsync(WTFDbContext db, Guid tenantId)
{
    var result = new Dictionary<string, int>();
    var nextId = (await db.AddOnTypes.IgnoreQueryFilters().MaxAsync(t => (int?)t.Id) ?? 0) + 1;
    var types = new (string Name, string? Key, bool Required, int Max, int Sort)[]
    {
        ("Size", "size", true, 1, 1),
        ("Temperature", null, true, 1, 0),
        ("Flavor", null, false, 1, 2),
        ("Topping", null, false, 3, 4),
        ("Extra", "extra", false, 3, 5),
    };
    foreach (var (name, key, required, max, sort) in types)
    {
        var type = await db.AddOnTypes.FirstOrDefaultAsync(t => t.Name == name);
        if (type is null)
        {
            type = new AddOnType
            {
                Id = nextId++,
                Name = name,
                SystemKey = key,
                IsRequired = required,
                MinSelect = required ? 1 : 0,
                MaxSelect = max,
                SortOrder = sort,
                IsActive = true,
                CreatedAt = now,
                TenantId = tenantId,
            };
            db.AddOnTypes.Add(type);
            added.Add($"add-on type {name}");
        }

        result[name] = type.Id;
    }

    return result;
}

async Task EnsureWasteReasonsAsync(WTFDbContext db, Guid tenantId)
{
    var reasons = new (string Name, bool RequiresNote, int SortOrder, bool IsSystem)[]
    {
        ("Expired or spoiled", false, 10, false),
        ("Spilled or dropped", false, 20, false),
        ("Wrong order or remade", false, 30, false),
        ("Quality failed", false, 40, false),
        ("Staff meal", false, 50, false),
        ("Sample or tasting", false, 60, false),
        ("Breakage", false, 70, false),
        ("Other", true, 1000, true),
    };
    foreach (var (name, requiresNote, sortOrder, isSystem) in reasons)
    {
        if (!await db.WasteReasons.AnyAsync(r => r.Name == name))
        {
            db.WasteReasons.Add(new WasteReason { Name = name, RequiresNote = requiresNote, SortOrder = sortOrder, IsSystem = isSystem, IsActive = true, CreatedAt = now, TenantId = tenantId });
            added.Add($"waste reason {name}");
        }
    }
}

async Task<Product> EnsureProductAsync(WTFDbContext db, Guid tenantId, Guid createdBy, string code, string name, decimal price, int categoryId, int? subCategoryId, bool seniorPwd, bool isAddOn)
{
    var product = await db.Products.FirstOrDefaultAsync(p => p.Code == code);
    if (product is null)
    {
        product = new Product
        {
            Id = Guid.NewGuid(),
            Code = code,
            Name = name,
            Price = price,
            CategoryId = categoryId,
            SubCategoryId = subCategoryId,
            IsAddOn = isAddOn,
            IsActive = true,
            IsSeniorPwdEligible = seniorPwd,
            CreatedAt = now,
            CreatedBy = createdBy,
            TenantId = tenantId,
        };
        db.Products.Add(product);
        added.Add(isAddOn ? $"add-on {name}" : $"product {name}");
    }

    return product;
}

async Task<Supplier> EnsureSupplierAsync(WTFDbContext db, Guid tenantId, Guid createdBy, string name, string contact, string phone, int leadDays)
{
    var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Name == name);
    if (supplier is null)
    {
        supplier = new Supplier
        {
            Id = Guid.NewGuid(),
            Name = name,
            ContactName = contact,
            Phone = phone,
            LeadTimeDays = leadDays,
            PaymentTerms = "Cash on delivery",
            IsActive = true,
            CreatedAt = now,
            CreatedBy = createdBy,
            TenantId = tenantId,
        };
        db.Suppliers.Add(supplier);
        added.Add($"supplier {name}");
    }

    return supplier;
}

async Task EnsurePromotionAsync(WTFDbContext db, string name, int typeId, Guid createdBy, Action<Promotion> addDetails)
{
    if (await db.Promotions.AnyAsync(p => p.Name == name))
    {
        return;
    }

    var promotion = new Promotion
    {
        Id = Guid.NewGuid(),
        Name = name,
        TypeId = typeId,
        IsActive = true,
        StartDate = now.Date.AddDays(-7),
        EndDate = now.Date.AddDays(60),
        CreatedAt = now,
        CreatedBy = createdBy,
        TenantId = shopId,
    };
    db.Promotions.Add(promotion);
    await db.SaveChangesAsync();
    addDetails(promotion);
    added.Add($"promotion {name}");
}

// One stock change: moves the item's quantity and writes the matching history row
static StockMovement Move(WTFDbContext db, Item item, string type, decimal delta, Guid userId, Guid tenantId, string? referenceType, Guid? referenceId, string notes, decimal? unitCost)
{
    var before = item.CurrentQuantity;
    item.CurrentQuantity = before + delta;
    var movement = new StockMovement
    {
        Id = Guid.NewGuid(),
        ItemId = item.Id,
        MovementType = type,
        QuantityDelta = delta,
        QuantityBefore = before,
        QuantityAfter = item.CurrentQuantity,
        UnitCost = unitCost,
        ReferenceType = referenceType,
        ReferenceId = referenceId,
        Notes = notes,
        CreatedAt = DateTime.UtcNow,
        CreatedBy = userId,
        TenantId = tenantId,
    };
    db.StockMovements.Add(movement);
    return movement;
}

static void AddOrder(WTFDbContext db, OrderSpec spec, Dictionary<string, Product> products, Dictionary<string, Product> addOns, Dictionary<string, Customer> customers, User creator, Guid tenantId, DateTime now, bool vatRegistered)
{
    var orderId = Guid.NewGuid();
    var createdAt = now.AddHours(spec.HoursAgo);
    var customer = spec.Customer is null ? null : customers[spec.Customer];
    var sortOrder = 0;
    var gross = 0m;
    var seniorDiscount = 0m;
    var seniorRows = new List<(OrderItem Item, SeniorPwdAmounts Amounts)>();

    foreach (var line in spec.Lines)
    {
        var product = products[line.Product];
        var unitPrice = line.PromoPrice ?? product.Price;
        var lineId = Guid.NewGuid();
        var lineItem = new OrderItem
        {
            Id = lineId,
            OrderId = orderId,
            ProductId = product.Id,
            Quantity = line.Quantity,
            Price = unitPrice,
            OriginalPrice = line.PromoPrice is null ? null : product.Price,
            PromoLabel = line.PromoLabel,
            SortOrder = sortOrder++,
            TenantId = tenantId,
        };
        db.OrderItems.Add(lineItem);

        var addOnTotal = 0m;
        foreach (var addOnName in line.AddOns)
        {
            var addOn = addOns[addOnName];
            db.OrderItems.Add(new OrderItem
            {
                Id = Guid.NewGuid(),
                OrderId = orderId,
                ProductId = addOn.Id,
                Quantity = 1,
                Price = addOn.Price,
                ParentOrderItemId = lineId,
                SortOrder = sortOrder++,
                TenantId = tenantId,
            });
            addOnTotal += addOn.Price;
        }

        gross += (unitPrice + addOnTotal) * line.Quantity;
        if (spec.Senior is not null && product.IsSeniorPwdEligible)
        {
            var amounts = SeniorPwdRules.ForLine(unitPrice, addOnTotal, line.Quantity, vatRegistered);
            seniorRows.Add((lineItem, amounts));
            seniorDiscount += amounts.Discount;
        }
    }

    var net = gross - seniorDiscount;
    var paid = spec.Payment is not null && spec.Status is OrderStatusEnum.Completed or OrderStatusEnum.Refunded;

    if (spec.Senior is { } kind && seniorRows.Count > 0)
    {
        var discountId = Guid.NewGuid();
        db.OrderSeniorPwdDiscounts.Add(new OrderSeniorPwdDiscount
        {
            Id = discountId,
            OrderId = orderId,
            Type = (byte)kind,
            IdNumber = kind == SeniorPwdKind.Senior ? "SC-0001234" : "PWD-0005678",
            CustomerName = kind == SeniorPwdKind.Senior ? "Lola Remedios" : "Ana Villanueva",
            CoveredAmount = seniorRows.Sum(r => r.Amounts.Covered),
            VatExemptAmount = seniorRows.Sum(r => r.Amounts.VatExempt),
            DiscountAmount = seniorDiscount,
            RecordedBy = creator.Id,
            CreatedAt = createdAt,
            TenantId = tenantId,
        });
        foreach (var (item, amounts) in seniorRows)
        {
            item.SeniorPwdDiscountId = discountId;
            item.SeniorPwdVatExempt = amounts.VatExempt;
            item.SeniorPwdDiscount = amounts.Discount;
        }
    }

    var received = paid && spec.Payment == PaymentMethodEnum.Cash ? Math.Ceiling((net + (spec.Tips ?? 0m)) / 100m) * 100m : (decimal?)null;
    db.Orders.Add(new Order
    {
        Id = orderId,
        CustomerId = customer?.Id,
        CreatedAt = createdAt,
        CreatedBy = creator.Id,
        StatusId = (int)spec.Status,
        PaymentMethodId = paid ? (int?)spec.Payment : null,
        AmountReceived = paid ? (received ?? net + (spec.Tips ?? 0m)) : null,
        ChangeAmount = received is null ? null : received - net - (spec.Tips ?? 0m),
        Tips = spec.Tips,
        Note = Marker + spec.Label,
        Source = (byte)(spec.FromLink ? OrderSourceEnum.CustomerLink : OrderSourceEnum.Pos),
        FulfillmentType = spec.FromLink ? (byte)FulfillmentTypeEnum.Delivery : null,
        DeliveryAddress = spec.FromLink ? customer?.Address : null,
        ContactNumber = spec.FromLink ? customer?.ContactNumber : null,
        CustomerAddress = customer?.Address,
        AcceptedAt = paid ? createdAt : null,
        ReadyAt = paid ? createdAt.AddMinutes(8) : null,
        TenantId = tenantId,
    });
}

internal enum SeniorPwdKind : byte
{
    Senior = 1,
    Pwd = 2,
}

internal sealed record OrderLineSpec(string Product, int Quantity, string[] AddOns, decimal? PromoPrice = null, string? PromoLabel = null);

internal sealed record OrderSpec(
    string Label,
    OrderStatusEnum Status,
    PaymentMethodEnum? Payment,
    string? Customer,
    int HoursAgo,
    OrderLineSpec[] Lines,
    decimal? Tips = null,
    SeniorPwdKind? Senior = null,
    bool FromLink = false);

internal sealed class SeedContext : WTFDbContext
{
    public SeedContext(DbContextOptions<WTFDbContext> options, Guid tenantId)
        : base(options, new SeedTenant(tenantId))
    {
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        // The provider is already configured through the options.
    }
}

internal sealed class SeedTenant(Guid tenantId) : ICurrentTenant, ITenantSwitch
{
    private Guid _tenantId = tenantId;

    public bool FilterEnabled => true;

    public Guid? TenantId => _tenantId;

    public Guid? StampTenantId => _tenantId;

    public void Use(Guid tenantId)
    {
        _tenantId = tenantId;
    }
}
