using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Branches;
using WTF.Api.Features.Branches.Enums;
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
using WTF.Calculations.Kitchen;
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
await SeedStarterBulkAsync();

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
        var filled = !settings.SeniorPwdEnabled || !settings.KitchenBoardEnabled;
        settings.SeniorPwdEnabled = true;
        settings.KitchenBoardEnabled = true;
        settings.Address = Fill(settings.Address, "1 Coffee Street, Makati City", ref filled);
        settings.Phone = Fill(settings.Phone, "02 8123 4567", ref filled);
        settings.ReceiptHeader = Fill(settings.ReceiptHeader, "Thank you for visiting!", ref filled);
        settings.ReceiptFooter = Fill(settings.ReceiptFooter, "This is not an official receipt.", ref filled);
        if (filled)
        {
            await db.SaveChangesAsync();
            added.Add("shop settings (Senior/PWD and kitchen board on, receipt text)");
        }
    }

    await EnsureBranchesAsync(db, shopId, new (string Name, string Code, string? Address, string? Phone, bool IsMain)[]
    {
        ("Makati", "MKT", "1 Coffee Street, Makati City", "02 8123 4567", true),
        ("BGC", "BGC", "26th Street corner 7th Avenue, Bonifacio Global City, Taguig", "02 8555 0192", false),
        ("Quezon City", "QC", "45 Tomas Morato Avenue, Quezon City", "02 8921 7733", false),
    });

    // Accounts: one per role, same password
    var accounts = new (string Username, string First, string Last, UserRoleEnum Role)[]
    {
        (OwnerUsername, "Alain", "Elemia", UserRoleEnum.Owner),
        ("manager", "Liza", "Ramos", UserRoleEnum.Admin),
        ("cashier", "Joy", "Bautista", UserRoleEnum.Cashier),
        ("viewer", "Ben", "Aquino", UserRoleEnum.AdminViewer),
        ("stockmgr", "Nora", "Villanueva", UserRoleEnum.StockManager),
        ("itemmgr", "Paolo", "Cruz", UserRoleEnum.ItemManager),
        ("kitchen", "Rico", "Mendoza", UserRoleEnum.Kitchen),
    };

    foreach (var (username, first, last, role) in accounts)
    {
        if (await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Username == username))
        {
            continue;
        }

        db.Users.Add(NewUser(username, first, last, role, shopId));
        added.Add($"user {username} ({role})");
    }

    await db.SaveChangesAsync();
    await AssignBranchesAsync(db, shopId);

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
        ("COF-101", "Espresso", 90m, "Drink", coffeeSub, true),
        ("COF-102", "Latte", 140m, "Drink", coffeeSub, true),
        ("COF-103", "Cappuccino", 140m, "Drink", coffeeSub, true),
        ("COF-104", "Iced Americano", 120m, "Drink", coffeeSub, true),
        ("TEA-201", "Matcha Latte", 160m, "Drink", nonCoffeeSub, true),
        ("BAK-301", "Croissant", 95m, "Food", null, true),
        ("FOD-401", "Ham and Cheese Sandwich", 180m, "Food", null, true),
        ("DES-501", "Chocolate Cake Slice", 150m, "Dessert", null, true),
        ("RTL-601", "Coffee Beans 250g", 480m, "Other", null, false),
        ("COF-105", "Flat White", 150m, "Drink", coffeeSub, true),
        ("COF-106", "Americano", 110m, "Drink", coffeeSub, true),
        ("COF-107", "Mocha", 160m, "Drink", coffeeSub, true),
        ("COF-108", "Caramel Macchiato", 170m, "Drink", coffeeSub, true),
        ("COF-109", "Spanish Latte", 165m, "Drink", coffeeSub, true),
        ("COF-110", "Iced Latte", 145m, "Drink", coffeeSub, true),
        ("COF-111", "Cold Brew", 130m, "Drink", coffeeSub, true),
        ("COF-112", "Affogato", 155m, "Dessert", null, true),
        ("COF-113", "Doppio", 110m, "Drink", coffeeSub, true),
        ("TEA-202", "Chai Latte", 150m, "Drink", nonCoffeeSub, true),
        ("TEA-203", "Earl Grey Tea", 100m, "Drink", nonCoffeeSub, true),
        ("TEA-204", "Iced Lemon Tea", 95m, "Drink", nonCoffeeSub, true),
        ("TEA-205", "Hot Chocolate", 130m, "Drink", nonCoffeeSub, true),
        ("TEA-206", "Strawberry Milk", 135m, "Drink", nonCoffeeSub, true),
        ("TEA-207", "Mango Smoothie", 160m, "Drink", nonCoffeeSub, true),
        ("BAK-302", "Blueberry Muffin", 85m, "Food", null, true),
        ("BAK-303", "Cinnamon Roll", 110m, "Food", null, true),
        ("BAK-304", "Banana Bread Slice", 90m, "Food", null, true),
        ("FOD-402", "Tuna Melt Sandwich", 185m, "Food", null, true),
        ("FOD-403", "Chicken Pesto Panini", 210m, "Food", null, true),
        ("FOD-404", "Egg and Bacon Bagel", 175m, "Food", null, true),
        ("FOD-405", "Garlic Rice with Tapa", 220m, "Food", null, true),
        ("FOD-406", "Pasta Aglio e Olio", 195m, "Food", null, true),
        ("DES-502", "Basque Cheesecake Slice", 175m, "Dessert", null, true),
        ("DES-503", "Tiramisu Cup", 160m, "Dessert", null, true),
        ("DES-504", "Leche Flan", 110m, "Dessert", null, true),
        ("DES-505", "Brownie", 95m, "Dessert", null, true),
        ("RTL-602", "Cold Brew Bottle 1L", 380m, "Other", null, false),
        ("RTL-603", "Tumbler 16oz", 650m, "Other", null, false),
    };
    var products = new Dictionary<string, Product>();
    foreach (var (code, name, price, category, sub, seniorPwd) in menu)
    {
        products[name] = await EnsureProductAsync(db, shopId, owner.Id, code, name, price, categories[category], sub, seniorPwd, false);
    }

    // Add-ons are products flagged as add-ons, linked to the drinks through ProductAddOns
    var addOns = new (string Type, string Code, string Name, decimal Price, bool IsDefault)[]
    {
        ("Size", "ADD-001", "Medium", 0m, true),
        ("Size", "ADD-002", "Large", 30m, false),
        ("Temperature", "ADD-003", "Hot", 0m, true),
        ("Temperature", "ADD-004", "Iced", 10m, false),
        ("Flavor", "ADD-005", "Vanilla", 25m, false),
        ("Flavor", "ADD-006", "Caramel", 25m, false),
        ("Flavor", "ADD-007", "Hazelnut", 25m, false),
        ("Topping", "ADD-008", "Whipped Cream", 20m, false),
        ("Extra", "ADD-009", "Extra Shot", 35m, false),
        ("Extra", "ADD-010", "Oat Milk", 40m, false),
    };
    var addOnProducts = new Dictionary<string, Product>();
    foreach (var (type, code, name, price, _) in addOns)
    {
        addOnProducts[name] = await EnsureProductAsync(db, shopId, owner.Id, code, name, price, categories["Other"], null, false, true);
    }

    // Some branches charge their own price for a few items (BGC a little more, Quezon City a little less on bakery); the rest keep the shop price
    var branchPrices = new (string Branch, string Product, decimal Price)[]
    {
        ("BGC", "Latte", 150m),
        ("BGC", "Cappuccino", 150m),
        ("BGC", "Spanish Latte", 175m),
        ("BGC", "Iced Latte", 155m),
        ("BGC", "Matcha Latte", 170m),
        ("BGC", "Chai Latte", 160m),
        ("BGC", "Mango Smoothie", 170m),
        ("BGC", "Chicken Pesto Panini", 225m),
        ("BGC", "Basque Cheesecake Slice", 185m),
        ("BGC", "Large", 35m),
        ("BGC", "Extra Shot", 40m),
        ("BGC", "Oat Milk", 45m),
        ("QC", "Blueberry Muffin", 80m),
        ("QC", "Brownie", 90m),
        ("QC", "Mango Smoothie", 155m),
    };
    if (!await db.ProductBranchPrices.IgnoreQueryFilters().AnyAsync(p => p.TenantId == shopId))
    {
        var branchIdByCode = await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == shopId).ToDictionaryAsync(b => b.Code, b => b.Id);
        foreach (var (branchCode, productName, price) in branchPrices)
        {
            var priced = products.GetValueOrDefault(productName) ?? addOnProducts.GetValueOrDefault(productName);
            if (priced is null || !branchIdByCode.TryGetValue(branchCode, out var priceBranchId))
            {
                continue;
            }

            db.ProductBranchPrices.Add(new ProductBranchPrice
            {
                Id = Guid.NewGuid(),
                TenantId = shopId,
                ProductId = priced.Id,
                BranchId = priceBranchId,
                Price = price,
                CreatedAt = now.AddDays(-45),
                CreatedBy = owner.Id,
            });
        }

        added.Add("branch prices (BGC and Quezon City)");
    }

    var drinksAddOns = new Dictionary<string, string[]>
    {
        ["Espresso"] = ["Size", "Extra"],
        ["Latte"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Cappuccino"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Iced Americano"] = ["Size", "Extra", "Temperature"],
        ["Matcha Latte"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Flat White"] = ["Size", "Temperature", "Flavor", "Extra"],
        ["Americano"] = ["Size", "Extra", "Temperature"],
        ["Mocha"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Caramel Macchiato"] = ["Size", "Temperature", "Flavor", "Topping", "Extra"],
        ["Spanish Latte"] = ["Size", "Temperature", "Flavor", "Extra"],
        ["Iced Latte"] = ["Size", "Flavor", "Extra"],
        ["Cold Brew"] = ["Size", "Flavor", "Extra"],
        ["Doppio"] = ["Extra"],
        ["Chai Latte"] = ["Size", "Temperature", "Extra"],
        ["Earl Grey Tea"] = ["Size", "Temperature"],
        ["Iced Lemon Tea"] = ["Size"],
        ["Hot Chocolate"] = ["Size", "Topping", "Extra"],
        ["Strawberry Milk"] = ["Size", "Topping"],
        ["Mango Smoothie"] = ["Size", "Topping"],
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

    var otherBranches = await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == shopId && !b.IsMain).OrderBy(b => b.Name).ToListAsync();
    var mainBranchId = await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == shopId && b.IsMain).Select(b => b.Id).FirstAsync();
    if (otherBranches.Count == 2 && !await db.ItemBranchStocks.IgnoreQueryFilters().AnyAsync(s => s.TenantId == shopId && s.BranchId != mainBranchId))
    {
        var bgc = otherBranches.First(b => b.Code == "BGC");
        var quezonCity = otherBranches.First(b => b.Code == "QC");
        var otherStart = new (string Name, decimal Bgc, decimal Qc)[]
        {
            ("Espresso Beans", 2500m, 900m),
            ("Fresh Milk", 1500m, 420m),
            ("Matcha Powder", 220m, 60m),
        };
        foreach (var (name, bgcQuantity, qcQuantity) in otherStart)
        {
            var item = items[name];
            Move(db, item, StockMovementTypes.AddStock, bgcQuantity, owner.Id, shopId, null, null, "Opening stock", item.CostPrice, bgc.Id);
            Move(db, item, StockMovementTypes.AddStock, qcQuantity, owner.Id, shopId, null, null, "Opening stock", item.CostPrice, quezonCity.Id);
        }

        var transfer = new StockTransfer
        {
            Id = Guid.NewGuid(),
            TenantId = shopId,
            FromBranchId = mainBranchId,
            ToBranchId = bgc.Id,
            Notes = "Beans for the BGC weekend rush",
            CreatedAt = now.AddDays(-2),
            CreatedBy = owner.Id,
        };
        db.StockTransfers.Add(transfer);
        var beans = items["Espresso Beans"];
        db.StockTransferLines.Add(new StockTransferLine { Id = Guid.NewGuid(), TenantId = shopId, TransferId = transfer.Id, ItemId = beans.Id, Quantity = 1000m, UnitCost = beans.CostPrice });
        Move(db, beans, StockMovementTypes.TransferOut, -1000m, owner.Id, shopId, StockMovementTypes.StockTransferReference, transfer.Id, "Transfer to BGC", beans.CostPrice, mainBranchId);
        Move(db, beans, StockMovementTypes.TransferIn, 1000m, owner.Id, shopId, StockMovementTypes.StockTransferReference, transfer.Id, "Transfer from Makati", beans.CostPrice, bgc.Id);
        added.Add("stock at BGC and Quezon City, and a transfer from Makati to BGC");
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
    if (!await db.StockReceipts.AnyAsync())
    {
        var receipt = new StockReceipt
        {
            Id = Guid.NewGuid(),
            SupplierId = beansSupplier.Id,
            ReceivedOn = DateOnly.FromDateTime(now.AddDays(-2)),
            InvoiceNumber = "BB-2026-0412",
            InvoiceTotal = 1250m,
            Note = "Weekly delivery, all sealed",
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
    if (!await db.StockWastes.AnyAsync())
    {
        foreach (var (itemName, quantity, reasonName, status, review, reasonNote) in new[]
                 {
                     ("Fresh Milk", 100m, "Spilled or dropped", StockWasteStatuses.Recorded, false, "Carton slipped while restocking the chiller"),
                     ("Matcha Powder", 20m, "Expired or spoiled", StockWasteStatuses.PendingReview, true, "Old tin found past its best-before date"),
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
                Notes = reasonNote,
                Status = status,
                RequiresReview = review,
                CreatedAt = now.AddDays(-1),
                CreatedBy = cashier.Id,
                TenantId = shopId,
            });
        }

        added.Add("2 waste entries (one waiting for review)");
    }

    if (!await db.PurchaseOrders.AnyAsync())
    {
        var nextPo = (await db.PurchaseOrders.IgnoreQueryFilters().Where(p => p.TenantId == shopId).MaxAsync(p => (int?)p.PoNumber) ?? 0) + 1;
        foreach (var (supplier, status, itemName, packs, note) in new[]
                 {
                     (dairySupplier, PurchaseOrderStatuses.Sent, "Fresh Milk", 10m, "Milk for the week, deliver before Friday"),
                     (beansSupplier, PurchaseOrderStatuses.Draft, "Espresso Beans", 5m, "Next month beans order, check price first"),
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
                Note = note,
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

    if (!await db.StockCounts.AnyAsync())
    {
        var count = new StockCount
        {
            Id = Guid.NewGuid(),
            Name = "Weekly count, Sunday close",
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
                ExpectedQuantity = MainQuantity(db, item, shopId),
                CountedQuantity = counted ? MainQuantity(db, item, shopId) - 25m : null,
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
        var text = note;
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
    if (!await db.Orders.AnyAsync())
    {
        var vatRegistered = settings?.VatRegistered ?? false;
        var branchPricing = await LoadBranchPricingAsync(db, shopId);
        var specs = new List<OrderSpec>
        {
            new("cash sale, 3 days ago", null, OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -72, [new("Latte", 2, ["Large", "Vanilla"]), new("Croissant", 1, [])]),
            new("BGC cash sale at the branch prices", null, OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -26, [new("Latte", 1, ["Large", "Oat Milk"]), new("Cappuccino", 1, ["Medium"])], BranchCode: "BGC"),
            new("BGC held order at the branch prices", "Will pick up after the meeting", OrderStatusEnum.Pending, null, "Ana", -1, [new("Spanish Latte", 2, []), new("Basque Cheesecake Slice", 1, [])], BranchCode: "BGC"),
            new("gcash sale, 2 days ago", "Paid by GCash, sent the receipt by message", OrderStatusEnum.Completed, PaymentMethodEnum.GCash, "Maria", -48, [new("Cappuccino", 1, ["Medium"]), new("Chocolate Cake Slice", 1, [])]),
            new("cash sale with tips", "Less ice please", OrderStatusEnum.Completed, PaymentMethodEnum.Cash, "Juan", -30, [new("Matcha Latte", 1, ["Large", "Iced", "Oat Milk"])], Tips: 20m),
            new("promo price on Latte", null, OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -24, [new("Latte", 1, ["Medium"], PromoPrice: 120m, PromoLabel: "Latte Happy Price")]),
            new("senior citizen discount", "Senior citizen, ID checked at the counter", OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, -12, [new("Iced Americano", 1, ["Medium"]), new("Croissant", 2, [])], Senior: SeniorPwdKind.Senior),
            new("pwd discount", "PWD, ID checked at the counter", OrderStatusEnum.Completed, PaymentMethodEnum.GCash, "Ana", -6, [new("Espresso", 2, ["Extra Shot"])], Senior: SeniorPwdKind.Pwd),
            new("held order (pending)", "Customer is parking the car, will pay when back", OrderStatusEnum.Pending, null, "Maria", -1, [new("Latte", 1, ["Hot"]), new("Ham and Cheese Sandwich", 1, [])]),
            new("cancelled order", "Customer left before it was made", OrderStatusEnum.Cancelled, null, null, -20, [new("Espresso", 1, [])]),
            new("refunded order", "Croissants were stale, refunded", OrderStatusEnum.Refunded, PaymentMethodEnum.Cash, null, -36, [new("Croissant", 3, [])]),
            new("held offline sale, price changed", "Sold while the wifi was down", OrderStatusEnum.PendingReview, PaymentMethodEnum.Cash, "Juan", -5, [new("Cappuccino", 2, ["Large"])],
                Held: new("OFF-0412", 20m, [new("PriceChanged", ReviewSeverityEnum.Hold, "Cappuccino was sold at 130.00 but costs 140.00 now", 0, "140.00", "130.00"), new("StockShortfall", ReviewSeverityEnum.Note, "Oat milk ran short by 1 carton when this sale synced")])),
            new("held offline sale, promotion ended", "Customer asked for the Happy Price", OrderStatusEnum.PendingReview, PaymentMethodEnum.GCash, "Ana", -150, [new("Latte", 1, ["Medium"])],
                Held: new("OFF-0398", 20m, [new("PromotionEnded", ReviewSeverityEnum.Hold, "Latte Happy Price had ended when this sale synced", 0, "140.00", "120.00")])),
            new("held offline sale, senior ID missing", null, OrderStatusEnum.PendingReview, PaymentMethodEnum.Cash, null, -9, [new("Iced Americano", 1, ["Medium"])], Senior: SeniorPwdKind.Senior,
                Held: new("OFF-0421", 0m, [new("SeniorPwdIdMissing", ReviewSeverityEnum.Hold, "The Senior Citizen ID number was left blank on the device")])),
            new("office catering order, many lines", "Team meeting at 3 PM, please pack the pastries in separate boxes", OrderStatusEnum.Completed, PaymentMethodEnum.GCash, "Maria", -18, [new("Latte", 3, ["Large", "Vanilla"]), new("Cappuccino", 2, ["Medium", "Hot"]), new("Iced Americano", 4, ["Large"]), new("Matcha Latte", 2, ["Large", "Iced", "Oat Milk"]), new("Flat White", 2, []), new("Chai Latte", 1, []), new("Croissant", 6, []), new("Blueberry Muffin", 4, []), new("Cinnamon Roll", 3, []), new("Ham and Cheese Sandwich", 3, []), new("Chicken Pesto Panini", 2, []), new("Basque Cheesecake Slice", 4, []), new("Brownie", 4, [])]),
            new("customer link order waiting approval", "Please deliver to the front gate", OrderStatusEnum.PendingApproval, null, "Maria", -2, [new("Cappuccino", 2, ["Large", "Caramel"])], FromLink: true),
        };

        var statusIds = await db.Statuses.Select(s => s.Id).ToListAsync();
        foreach (var spec in specs.Where(s => statusIds.Contains((int)s.Status)).OrderBy(s => s.HoursAgo))
        {
            AddOrder(db, spec, products, addOnProducts, customers, spec.FromLink ? owner : cashier, shopId, now, vatRegistered, branchPricing);
            await db.SaveChangesAsync();
        }

        await db.SaveChangesAsync();
        added.Add($"{specs.Count} orders (completed, held, cancelled, refunded, senior, PWD, customer link, long catering order)");
    }

    if (!await db.OfflineSyncPolicies.AnyAsync())
    {
        const byte hold = (byte)ReviewSeverityEnum.Hold;
        db.OfflineSyncPolicies.Add(new OfflineSyncPolicy
        {
            TenantId = shopId,
            PriceChangedMode = hold,
            AddOnPriceChangedMode = (byte)ReviewSeverityEnum.Note,
            ProductInactiveMode = hold,
            BundleChangedMode = hold,
            CustomerInactiveMode = (byte)ReviewSeverityEnum.Note,
            PromotionEndedMode = hold,
            UnknownProductMode = hold,
            PriceTolerance = 5m,
            AutoApproveNotes = true,
            AgedAfterDays = 3,
            UpdatedAt = now.AddDays(-4),
            UpdatedBy = owner.Id,
        });
        added.Add("offline sync policy");
    }

    if (!await db.UnsyncedOrders.AnyAsync())
    {
        var branchByCode = await db.Branches.IgnoreQueryFilters()
            .Where(b => b.TenantId == shopId)
            .ToDictionaryAsync(b => b.Code, b => b.Id);

        UnsyncedOrder Unsynced(string localId, string code, string error, int hoursAgo, string product, int quantity, decimal price, bool resolved, string branchCode)
        {
            var item = products[product];
            var command = new WTF.Api.Features.Orders.CreateOrderCommand
            {
                Items = [new WTF.Api.Features.Orders.DTOs.OrderItemRequestDto(item.Id, quantity, [], null, null, price)],
                Status = OrderStatusEnum.Completed,
                PaymentMethod = PaymentMethodEnum.Cash,
                CreatedAt = now.AddHours(hoursAgo),
                OfflineLocalId = localId,
                ExpectedTotal = price * quantity,
                BranchId = branchByCode.GetValueOrDefault(branchCode),
            };
            return new UnsyncedOrder
            {
                Id = Guid.NewGuid(),
                OfflineLocalId = localId,
                QuotedOrderJson = System.Text.Json.JsonSerializer.Serialize(command, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)),
                ErrorText = error,
                ErrorCode = code,
                CashierUserId = cashier.Id,
                DeviceCreatedAt = now.AddHours(hoursAgo),
                ReceivedAt = now.AddHours(hoursAgo).AddMinutes(40),
                QuotedTotal = price * quantity,
                StatusId = (byte)(resolved ? UnsyncedOrderStatusEnum.Resolved : UnsyncedOrderStatusEnum.Open),
                Resolution = resolved ? (byte)UnsyncedOrderResolutionEnum.Discarded : null,
                ResolvedBy = resolved ? manager.Id : null,
                ResolvedAt = resolved ? now.AddHours(hoursAgo).AddHours(20) : null,
                DiscardReason = resolved ? "Customer already paid again at the counter" : null,
                TenantId = shopId,
                BranchId = branchByCode.GetValueOrDefault(branchCode),
            };
        }

        db.UnsyncedOrders.AddRange(
            Unsynced("OFF-0405", "Rejected", "The server could not save this sale: the item was removed from the menu", -30, "Croissant", 2, 95m, false, "MKT"),
            Unsynced("OFF-0409", "InvalidData", "The quantity on this sale was not valid", -11, "Iced Americano", 1, 120m, false, "BGC"),
            Unsynced("OFF-0391", "Rejected", "The server could not save this sale: the customer was not found", -200, "Latte", 1, 140m, true, "QC"));
        added.Add("3 unsynced offline sales");
    }

    await db.SaveChangesAsync();

    await SeedBulkMainShopAsync(db, owner, manager, cashier, products, addOnProducts, drinksAddOns, customers, settings?.VatRegistered ?? false);

    // The kitchen board: orders at every step, so it is never empty on demo day. Times are relative to the deploy.
    if (!await db.Orders.AnyAsync(o => o.KitchenStatus != null))
    {
        var vatRegistered = settings?.VatRegistered ?? false;
        var kitchenSpecs = new List<OrderSpec>
        {
            new("kitchen new, pickup", null, OrderStatusEnum.Pending, null, "Maria", 0, [new("Latte", 1, ["Large", "Iced"]), new("Croissant", 1, [])], MinutesAgo: -2, Instructions: "Name on the cup: Migs", Kitchen: new(KitchenState.New)),
            new("kitchen new, prepaid", null, OrderStatusEnum.Completed, PaymentMethodEnum.GCash, null, 0, [new("Cappuccino", 2, ["Medium", "Hot"])], MinutesAgo: -4, Kitchen: new(KitchenState.New)),
            new("kitchen preparing, less ice", null, OrderStatusEnum.Pending, null, "Juan", 0, [new("Matcha Latte", 1, ["Large", "Iced", "Oat Milk"])], MinutesAgo: -7, Instructions: "Less ice please", Kitchen: new(KitchenState.Preparing, StartedMinutesAfter: 2)),
            new("kitchen preparing, prepaid", null, OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, 0, [new("Iced Americano", 1, ["Medium"]), new("Ham and Cheese Sandwich", 1, [])], MinutesAgo: -9, Kitchen: new(KitchenState.Preparing, StartedMinutesAfter: 1)),
            new("kitchen ready for pickup", null, OrderStatusEnum.Pending, null, "Ana", 0, [new("Espresso", 2, ["Extra Shot"])], MinutesAgo: -12, Instructions: "Extra hot", Kitchen: new(KitchenState.Ready, StartedMinutesAfter: 1, ReadyMinutesAfter: 6)),
            new("kitchen customer link", null, OrderStatusEnum.Pending, null, "Maria", 0, [new("Cappuccino", 2, ["Large", "Caramel"])], MinutesAgo: -15, Instructions: "Please deliver to the front gate", FromLink: true, Kitchen: new(KitchenState.Preparing, StartedMinutesAfter: 3)),
            new("kitchen changed after start", null, OrderStatusEnum.Pending, null, "Juan", 0, [new("Latte", 1, ["Medium", "Hot"]), new("Croissant", 1, [])], MinutesAgo: -10, Kitchen: new(KitchenState.Preparing, StartedMinutesAfter: 2, ChangeNote: "+1 Croissant, -1 Chocolate Cake Slice", ChangeKind: KitchenChangeKind.Changed)),
            new("kitchen added after served", null, OrderStatusEnum.Pending, null, "Ana", 0, [new("Iced Americano", 1, ["Medium"]), new("Croissant", 1, [])], MinutesAgo: -25, Kitchen: new(KitchenState.New, ChangeNote: "+1 Croissant", ChangeKind: KitchenChangeKind.Added)),
            new("kitchen cancelled while making", "Customer left before it was made", OrderStatusEnum.Cancelled, null, null, 0, [new("Espresso", 1, [])], MinutesAgo: -14, Kitchen: new(KitchenState.Preparing, StartedMinutesAfter: 2)),
            new("kitchen served, paid later", "Will pay at the end of the day", OrderStatusEnum.Pending, null, "Maria", 0, [new("Latte", 1, ["Medium", "Iced"])], MinutesAgo: -40, Kitchen: new(KitchenState.Served, StartedMinutesAfter: 2, ReadyMinutesAfter: 7, ServedMinutesAfter: 8)),
            new("kitchen served, prepaid", null, OrderStatusEnum.Completed, PaymentMethodEnum.Cash, null, 0, [new("Chocolate Cake Slice", 1, []), new("Cappuccino", 1, ["Medium", "Hot"])], MinutesAgo: -55, Kitchen: new(KitchenState.Served, StartedMinutesAfter: 1, ReadyMinutesAfter: 6, ServedMinutesAfter: 7)),
            new("kitchen long order, team lunch", "Bring everything out together, table of 8", OrderStatusEnum.Pending, null, "Ana", 0, [new("Latte", 2, ["Large", "Iced"]), new("Cappuccino", 2, ["Medium", "Hot"]), new("Iced Americano", 3, ["Large"]), new("Spanish Latte", 1, []), new("Mango Smoothie", 2, []), new("Garlic Rice with Tapa", 2, []), new("Pasta Aglio e Olio", 2, []), new("Chicken Pesto Panini", 2, []), new("Tuna Melt Sandwich", 1, []), new("Tiramisu Cup", 3, []), new("Leche Flan", 2, [])], MinutesAgo: -6, Instructions: "Serve the pasta first", Kitchen: new(KitchenState.Preparing, StartedMinutesAfter: 2)),
            new("kitchen left over from yesterday", null, OrderStatusEnum.Pending, null, "Juan", -30, [new("Latte", 1, ["Medium", "Hot"])], Kitchen: new(KitchenState.New)),
        };

        var statusIds = await db.Statuses.Select(s => s.Id).ToListAsync();
        var kitchenPricing = await LoadBranchPricingAsync(db, shopId);
        foreach (var spec in kitchenSpecs.Where(s => statusIds.Contains((int)s.Status)).OrderBy(s => s.HoursAgo).ThenBy(s => s.MinutesAgo))
        {
            AddOrder(db, spec, products, addOnProducts, customers, spec.FromLink ? owner : cashier, shopId, now, vatRegistered, kitchenPricing);
            await db.SaveChangesAsync();
        }

        added.Add($"{kitchenSpecs.Count} kitchen board orders (new, preparing, ready, changed, cancelled, served, left over)");
    }
}

static async Task<BranchPricing> LoadBranchPricingAsync(WTFDbContext db, Guid shopId) => new(
    await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == shopId).ToDictionaryAsync(b => b.Code, b => b.Id),
    (await db.ProductBranchPrices.IgnoreQueryFilters().Where(p => p.TenantId == shopId).ToListAsync())
        .GroupBy(p => p.BranchId)
        .ToDictionary(g => g.Key, g => g.ToDictionary(p => p.ProductId, p => p.Price)));

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

    await EnsureBranchesAsync(db, starterTenantId, [("Main", BranchCodes.FromShopName("Starter Demo Cafe"), "7 Bonifacio Street, Pasig City", "02 8777 1450", true)]);

    var ownerUser = NewUser("starterowner", "Mark", "Tan", UserRoleEnum.Owner, starterTenantId);
    var linkUser = NewUser("starter-link", "Customer", "Link", UserRoleEnum.Cashier, starterTenantId);
    linkUser.IsActive = false;
    db.Users.Add(ownerUser);
    db.Users.Add(linkUser);
    await db.SaveChangesAsync();
    await AssignBranchesAsync(db, starterTenantId);

    await using (var transaction = await db.Database.BeginTransactionAsync())
    {
        await TenantCatalogTemplate.CopyAsync(db, starterTenantId, ownerUser.Id, CancellationToken.None);
        await transaction.CommitAsync();
    }

    var drinkCategory = await db.ProductCategories.FirstOrDefaultAsync(c => c.Name == "Drink");
    if (drinkCategory is not null)
    {
        await EnsureProductAsync(db, starterTenantId, ownerUser.Id, "COF-101S", "Espresso", 90m, drinkCategory.Id, null, true, false);
        await EnsureProductAsync(db, starterTenantId, ownerUser.Id, "COF-102S", "Latte", 140m, drinkCategory.Id, null, true, false);
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
        Notes = "First month, paid by bank transfer",
        CreatedAt = now,
    });
    await db.SaveChangesAsync();
    added.Add("second shop 'Starter Demo Cafe' on the Starter plan (owner starterowner, small menu, open invoice)");
}

async Task SeedBulkMainShopAsync(WTFDbContext db, User owner, User manager, User cashier, Dictionary<string, Product> products, Dictionary<string, Product> addOnProducts, Dictionary<string, string[]> drinksAddOns, Dictionary<string, Customer> customers, bool vatRegistered)
{
    // Enough rows in every list to scroll or page through it. Fixed seed, so every deploy builds the same shop.
    var random = new Random(2026);
    T Pick<T>(IReadOnlyList<T> list) => list[random.Next(list.Count)];

    // Staff
    var staff = new (string Username, string First, string Last, UserRoleEnum Role)[]
    {
        ("jose.mendoza", "Jose", "Mendoza", UserRoleEnum.Cashier),
        ("carla.reyes", "Carla", "Reyes", UserRoleEnum.Cashier),
        ("miguel.torres", "Miguel", "Torres", UserRoleEnum.Cashier),
        ("angela.garcia", "Angela", "Garcia", UserRoleEnum.Cashier),
        ("rafael.lim", "Rafael", "Lim", UserRoleEnum.Cashier),
        ("bea.fernandez", "Bea", "Fernandez", UserRoleEnum.Cashier),
        ("dennis.ocampo", "Dennis", "Ocampo", UserRoleEnum.Cashier),
        ("trisha.castillo", "Trisha", "Castillo", UserRoleEnum.Cashier),
        ("marco.salazar", "Marco", "Salazar", UserRoleEnum.StockManager),
        ("ines.delrosario", "Ines", "Del Rosario", UserRoleEnum.StockManager),
        ("kevin.pascual", "Kevin", "Pascual", UserRoleEnum.ItemManager),
        ("hannah.soriano", "Hannah", "Soriano", UserRoleEnum.ItemManager),
        ("gabriel.navarro", "Gabriel", "Navarro", UserRoleEnum.AdminViewer),
        ("lorna.mercado", "Lorna", "Mercado", UserRoleEnum.AdminViewer),
        ("arvin.santiago", "Arvin", "Santiago", UserRoleEnum.Cashier),
        ("katrina.domingo", "Katrina", "Domingo", UserRoleEnum.Cashier),
        ("ramon.aguilar", "Ramon", "Aguilar", UserRoleEnum.Cashier),
        ("sheila.valdez", "Sheila", "Valdez", UserRoleEnum.Cashier),
        ("jericho.pineda", "Jericho", "Pineda", UserRoleEnum.Cashier),
        ("monica.cabrera", "Monica", "Cabrera", UserRoleEnum.Cashier),
        ("vince.lacson", "Vince", "Lacson", UserRoleEnum.Cashier),
        ("pia.magno", "Pia", "Magno", UserRoleEnum.Cashier),
        ("noel.estrada", "Noel", "Estrada", UserRoleEnum.Cashier),
        ("diane.tolentino", "Diane", "Tolentino", UserRoleEnum.Cashier),
        ("harold.bernardo", "Harold", "Bernardo", UserRoleEnum.Cashier),
        ("celine.ramirez", "Celine", "Ramirez", UserRoleEnum.Cashier),
        ("bong.salvador", "Bong", "Salvador", UserRoleEnum.Cashier),
        ("tessa.manalo", "Tessa", "Manalo", UserRoleEnum.Cashier),
    };
    var staffUsers = new List<User>();
    for (var i = 0; i < staff.Length; i++)
    {
        var (username, first, last, role) = staff[i];
        var user = await db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Username == username);
        if (user is null)
        {
            user = NewUser(username, first, last, role, shopId);
            user.IsActive = i < staff.Length - 3;
            db.Users.Add(user);
            added.Add($"user {username} ({role})");
        }

        staffUsers.Add(user);
    }

    await db.SaveChangesAsync();
    await AssignBranchesAsync(db, shopId);
    var cashiers = staffUsers.Where(u => u.RoleId == (int)UserRoleEnum.Cashier && u.IsActive).Append(cashier).ToList();
    var stockStaff = staffUsers.Where(u => u.RoleId == (int)UserRoleEnum.StockManager).Append(manager).ToList();

    // Customers
    var firstNames = new[] { "Carlo", "Bianca", "Migo", "Trina", "Paolo", "Kristine", "Enzo", "Patricia", "Jerome", "Camille", "Nathan", "Isabel", "Rommel", "Aileen", "Gino", "Dessa", "Franco", "Marites", "Clarence", "Joanna", "Rey", "Shiela", "Albert", "Cherry", "Lance", "Maricar", "Oscar", "Rhea", "Vicente", "Liza", "Dante", "Jasmine", "Ferdie", "Michelle", "Allan" };
    var lastNames = new[] { "Villareal", "Concepcion", "Aquino", "Dizon", "Hernandez", "Lopez", "Ramos", "Flores", "Gonzales", "Bautista", "Cruz", "Morales", "Castro", "Mendoza", "Rivera", "Alvarez", "Santos", "Perez", "Diaz", "Robles", "Panganiban", "Soriano", "Tan", "Uy", "Go", "Chua", "Evangelista", "Ignacio", "Jimenez", "Gutierrez", "Lacson", "Macaraeg", "Noble", "Ocampo", "Padilla" };
    var streets = new[] { "Maginhawa Street", "Katipunan Avenue", "Aurora Boulevard", "Shaw Boulevard", "Ayala Avenue", "Jupiter Street", "Kamias Road", "Tomas Morato Avenue", "Timog Avenue", "Ortigas Avenue", "Bonifacio High Street", "Pioneer Street" };
    var cities = new[] { "Quezon City", "Makati City", "Pasig City", "Mandaluyong City", "Taguig City", "Manila", "San Juan City" };
    var prefixes = new[] { "0917", "0918", "0927", "0935", "0945", "0956", "0966" };
    var customersByName = new Dictionary<string, Customer>(customers);
    for (var i = 0; i < firstNames.Length; i++)
    {
        var first = firstNames[i];
        var last = lastNames[(i * 7 + 3) % lastNames.Length];
        var address = i % 6 == 5 ? null : $"{random.Next(2, 199)} {Pick(streets)}, {Pick(cities)}";
        var phone = i % 8 == 7 ? null : prefixes[i % prefixes.Length] + random.Next(1000000, 9999999);
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
                IsActive = i % 17 != 16,
                CreatedAt = now.AddDays(-random.Next(1, 90)),
                CreatedBy = owner.Id,
                TenantId = shopId,
            };
            db.Customers.Add(customer);
            added.Add($"customer {first} {last}");
        }

        customersByName[$"{first} {last}"] = customer;
    }

    await db.SaveChangesAsync();

    // Stock items with their own suppliers. The three original items are left alone so their low-stock warnings stay.
    var supplierRows = new (string Name, string Contact, string Phone, int Lead)[]
    {
        ("Sweet Treats Ingredients", "Dina Asuncion", "09175550103", 2),
        ("Luzon Tea and Pantry", "Gilbert Sy", "09175550104", 3),
        ("Manila Packaging Depot", "Ferdie Ong", "09175550105", 4),
        ("Fresh Farm Produce", "Aling Nena Pascual", "09175550106", 1),
    };
    var suppliers = new List<Supplier>();
    foreach (var (name, contact, phone, lead) in supplierRows)
    {
        suppliers.Add(await EnsureSupplierAsync(db, shopId, owner.Id, name, contact, phone, lead));
    }

    await db.SaveChangesAsync();

    var itemRows = new (string Name, string Unit, int Supplier, string Pack, decimal PackUnits, decimal PackPrice)[]
    {
        ("Vanilla Syrup", "ml", 0, "750 ml bottle", 750m, 420m),
        ("Caramel Syrup", "ml", 0, "750 ml bottle", 750m, 420m),
        ("Hazelnut Syrup", "ml", 0, "750 ml bottle", 750m, 430m),
        ("Chocolate Sauce", "ml", 0, "2 L jug", 2000m, 690m),
        ("Whipped Cream", "ml", 0, "1 L pack", 1000m, 380m),
        ("Brown Sugar", "g", 0, "1 kg pack", 1000m, 78m),
        ("White Sugar", "g", 0, "1 kg pack", 1000m, 72m),
        ("Cocoa Powder", "g", 0, "500 g tub", 500m, 310m),
        ("Chai Concentrate", "ml", 1, "1 L bottle", 1000m, 360m),
        ("Earl Grey Tea Bags", "pcs", 1, "box of 100", 100m, 280m),
        ("Green Tea Leaves", "g", 1, "250 g pack", 250m, 420m),
        ("Decaf Beans", "g", 1, "1 kg bag", 1000m, 950m),
        ("Oat Milk", "ml", 1, "1 L carton", 1000m, 165m),
        ("Bottled Water", "pcs", 1, "case of 24", 24m, 190m),
        ("Dish Detergent", "ml", 1, "3.8 L gallon", 3800m, 240m),
        ("Coffee Filters", "pcs", 1, "pack of 100", 100m, 150m),
        ("12oz Paper Cups", "pcs", 2, "case of 1,000", 1000m, 2900m),
        ("16oz Paper Cups", "pcs", 2, "case of 1,000", 1000m, 3400m),
        ("Cup Lids", "pcs", 2, "case of 1,000", 1000m, 1500m),
        ("Paper Straws", "pcs", 2, "box of 500", 500m, 320m),
        ("Napkins", "pcs", 2, "pack of 1,000", 1000m, 260m),
        ("Stirrers", "pcs", 2, "pack of 1,000", 1000m, 180m),
        ("Cup Sleeves", "pcs", 2, "pack of 500", 500m, 450m),
        ("Takeout Bags", "pcs", 2, "pack of 200", 200m, 380m),
        ("Receipt Paper Rolls", "pcs", 2, "box of 50", 50m, 650m),
        ("Croissant Dough", "pcs", 3, "tray of 24", 24m, 960m),
        ("Ham Slices", "g", 3, "1 kg pack", 1000m, 420m),
        ("Cheese Slices", "pcs", 3, "pack of 100", 100m, 560m),
        ("Sandwich Bread", "pcs", 3, "pack of 12 loaves", 12m, 380m),
        ("Butter", "g", 3, "1 kg block", 1000m, 540m),
        ("Chocolate Cake Mix", "g", 3, "1 kg pack", 1000m, 360m),
        ("Eggs", "pcs", 3, "tray of 30", 30m, 270m),
    };
    var bulkItems = new List<(Item Item, int Supplier, string Pack, decimal PackUnits, decimal PackPrice)>();
    foreach (var (name, unit, supplierIndex, pack, packUnits, packPrice) in itemRows)
    {
        var item = await db.Items.FirstOrDefaultAsync(i => i.Name == name);
        if (item is null)
        {
            var cost = Math.Round(packPrice / packUnits, 4);
            item = new Item
            {
                Id = Guid.NewGuid(),
                Name = name,
                UnitName = unit,
                CurrentQuantity = 0m,
                WarningQuantity = packUnits,
                CriticalQuantity = Math.Round(packUnits * 0.4m, 2),
                CostPrice = cost,
                AverageCost = cost,
                YieldPercent = 100m,
                IsActive = true,
                CreatedAt = now.AddDays(-75),
                CreatedBy = owner.Id,
                TenantId = shopId,
            };
            db.Items.Add(item);
            Move(db, item, StockMovementTypes.AddStock, packUnits * 4m, owner.Id, shopId, null, null, "Opening stock", cost);
            var shares = (await db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == shopId && !b.IsMain).OrderBy(b => b.Name).Select(b => new { b.Id, b.Code }).ToListAsync())
                .Select(b => (BranchId: b.Id, Share: b.Code == "BGC" ? 2m : 1m));
            foreach (var (branchId, share) in shares)
            {
                Move(db, item, StockMovementTypes.AddStock, packUnits * share, owner.Id, shopId, null, null, "Opening stock", cost, branchId);
            }

            db.ItemSuppliers.Add(new ItemSupplier
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                SupplierId = suppliers[supplierIndex].Id,
                PackName = pack,
                UnitsPerPack = packUnits,
                PackPrice = packPrice,
                IsPreferred = true,
                CreatedAt = now.AddDays(-75),
                CreatedBy = owner.Id,
                TenantId = shopId,
            });
            added.Add($"stock item {name}");
        }

        bulkItems.Add((item, supplierIndex, pack, packUnits, packPrice));
    }

    await db.SaveChangesAsync();

    // Deliveries over the last two months
    if (await db.StockReceipts.CountAsync() < 30)
    {
        var prefixesByDepot = new[] { "STI", "LTP", "MPD", "FFP" };
        for (var r = 0; r < 30; r++)
        {
            var supplierIndex = r % suppliers.Count;
            var daysAgo = 2 + r * 2;
            var receiptId = Guid.NewGuid();
            var receivedBy = Pick(stockStaff);
            var lines = bulkItems.Where(i => i.Supplier == supplierIndex).OrderBy(_ => random.Next()).Take(2 + r % 2).ToList();
            var total = 0m;
            db.StockReceipts.Add(new StockReceipt
            {
                Id = receiptId,
                SupplierId = suppliers[supplierIndex].Id,
                ReceivedOn = DateOnly.FromDateTime(now.AddDays(-daysAgo)),
                InvoiceNumber = $"{prefixesByDepot[supplierIndex]}-2026-{1040 + r * 3}",
                Note = r % 4 == 0 ? "Delivered by the supplier's rider, all sealed" : null,
                CreatedAt = now.AddDays(-daysAgo),
                CreatedBy = receivedBy.Id,
                TenantId = shopId,
            });
            foreach (var (item, _, pack, packUnits, packPrice) in lines)
            {
                var packs = random.Next(1, 4);
                var quantity = packs * packUnits;
                var movement = Move(db, item, StockMovementTypes.AddStock, quantity, receivedBy.Id, shopId, StockMovementTypes.StockReceiptReference, receiptId, "Received", packPrice / packUnits);
                movement.CreatedAt = now.AddDays(-daysAgo);
                total += packs * packPrice;
                db.StockReceiptLines.Add(new StockReceiptLine
                {
                    Id = Guid.NewGuid(),
                    ReceiptId = receiptId,
                    ItemId = item.Id,
                    PackName = pack,
                    Packs = packs,
                    UnitsPerPack = packUnits,
                    PackPrice = packPrice,
                    Quantity = quantity,
                    UnitCost = packPrice / packUnits,
                    MovementId = movement.Id,
                    TenantId = shopId,
                });
            }

            db.StockReceipts.Local.First(x => x.Id == receiptId).InvoiceTotal = total;
        }

        added.Add("30 stock receipts");
    }

    // Waste, in every status
    if (await db.StockWastes.CountAsync() < 30)
    {
        var reasons = await db.WasteReasons.ToListAsync();
        var wasteRows = new (string Reason, string[] Notes)[]
        {
            ("Expired or spoiled", ["Found past the best-before date during closing", "Went off in the chiller overnight", "Opened pack left out too long"]),
            ("Spilled or dropped", ["Dropped while restocking the shelf", "Tipped over during the morning rush", "Bag split open while carrying"]),
            ("Wrong order or remade", ["Drink remade, customer asked for oat milk", "Order remade after wrong size", "Remade for a table that waited too long"]),
            ("Quality failed", ["Tasted off during opening check", "Texture was wrong, not served"]),
            ("Staff meal", ["Crew meal during the long shift", "Staff merienda"]),
            ("Sample or tasting", ["Cupping session with the supplier", "Tasting for the new menu item"]),
            ("Breakage", ["Box crushed in the delivery", "Bottle cracked in storage"]),
        };
        var statusPattern = new[]
        {
            StockWasteStatuses.Recorded, StockWasteStatuses.Confirmed, StockWasteStatuses.Recorded, StockWasteStatuses.Recorded,
            StockWasteStatuses.PendingReview, StockWasteStatuses.Confirmed, StockWasteStatuses.Recorded, StockWasteStatuses.Disputed,
        };
        for (var w = 0; w < 32; w++)
        {
            var (reasonName, notes) = wasteRows[w % wasteRows.Length];
            var reason = reasons.FirstOrDefault(x => x.Name == reasonName);
            if (reason is null)
            {
                continue;
            }

            var (item, _, _, packUnits, _) = Pick(bulkItems);
            var quantity = Math.Max(1m, Math.Round(packUnits * (decimal)(0.02 + random.NextDouble() * 0.08), 0));
            var status = statusPattern[w % statusPattern.Length];
            var recordedBy = Pick(cashiers);
            var createdAt = now.AddDays(-1 - w).AddHours(-random.Next(0, 8));
            var movement = Move(db, item, StockMovementTypes.Waste, -quantity, recordedBy.Id, shopId, StockMovementTypes.StockWasteReference, null, "Waste", item.CostPrice);
            movement.CreatedAt = createdAt;
            var reviewed = status is StockWasteStatuses.Confirmed or StockWasteStatuses.Disputed;
            db.StockWastes.Add(new StockWaste
            {
                Id = Guid.NewGuid(),
                ItemId = item.Id,
                StockMovementId = movement.Id,
                Quantity = quantity,
                WasteReasonId = reason.Id,
                ReasonName = reason.Name,
                Notes = Pick(notes),
                Status = status,
                RequiresReview = status != StockWasteStatuses.Recorded,
                ReviewedAt = reviewed ? createdAt.AddHours(6) : null,
                ReviewedBy = reviewed ? manager.Id : null,
                ReviewNote = status == StockWasteStatuses.Disputed ? "Quantity looks too high for one shift, please recount" : null,
                CreatedAt = createdAt,
                CreatedBy = recordedBy.Id,
                TenantId = shopId,
            });
        }

        added.Add("32 waste entries (recorded, to review, confirmed, disputed)");
    }

    await db.SaveChangesAsync();

    // Purchase orders from draft to received
    if (await db.PurchaseOrders.CountAsync() < 30)
    {
        var nextPo = (await db.PurchaseOrders.IgnoreQueryFilters().Where(p => p.TenantId == shopId).MaxAsync(p => (int?)p.PoNumber) ?? 0) + 1;
        var statusPlan = new[]
        {
            PurchaseOrderStatuses.Received, PurchaseOrderStatuses.Received, PurchaseOrderStatuses.Sent, PurchaseOrderStatuses.Received,
            PurchaseOrderStatuses.PartlyReceived, PurchaseOrderStatuses.Draft, PurchaseOrderStatuses.Received, PurchaseOrderStatuses.Cancelled,
        };
        var poNotes = new[] { "Regular weekly restock", "Running low before the weekend", "Ahead of the holiday rush", "Price list changed, confirm with the supplier", "Deliver in the morning before opening", null };
        for (var p = 0; p < 30; p++)
        {
            var supplierIndex = p % suppliers.Count;
            var status = statusPlan[p % statusPlan.Length];
            var daysAgo = 1 + p * 2;
            var createdAt = now.AddDays(-daysAgo);
            var poId = Guid.NewGuid();
            var buyer = Pick(stockStaff);
            var open = status is PurchaseOrderStatuses.Sent or PurchaseOrderStatuses.PartlyReceived or PurchaseOrderStatuses.Received;
            db.PurchaseOrders.Add(new PurchaseOrder
            {
                Id = poId,
                TenantId = shopId,
                PoNumber = nextPo++,
                SupplierId = suppliers[supplierIndex].Id,
                Status = status,
                ExpectedOn = DateOnly.FromDateTime(createdAt.AddDays(suppliers[supplierIndex].LeadTimeDays ?? 2)),
                Note = Pick(poNotes),
                CreatedAt = createdAt,
                CreatedBy = buyer.Id,
                SentAt = open ? createdAt.AddHours(2) : null,
                SentBy = open ? buyer.Id : null,
                ClosedAt = status is PurchaseOrderStatuses.Received or PurchaseOrderStatuses.Cancelled ? createdAt.AddDays(3) : null,
                ClosedBy = status is PurchaseOrderStatuses.Received or PurchaseOrderStatuses.Cancelled ? buyer.Id : null,
            });
            foreach (var (item, _, pack, packUnits, packPrice) in bulkItems.Where(i => i.Supplier == supplierIndex).OrderBy(_ => random.Next()).Take(1 + p % 3))
            {
                var ordered = random.Next(2, 9);
                db.PurchaseOrderLines.Add(new PurchaseOrderLine
                {
                    Id = Guid.NewGuid(),
                    TenantId = shopId,
                    PurchaseOrderId = poId,
                    ItemId = item.Id,
                    PackName = pack,
                    UnitsPerPack = packUnits,
                    PackPrice = packPrice,
                    PacksOrdered = ordered,
                    PacksReceived = status switch
                    {
                        PurchaseOrderStatuses.Received => ordered,
                        PurchaseOrderStatuses.PartlyReceived => Math.Max(1, ordered / 2),
                        _ => 0m,
                    },
                });
            }
        }

        added.Add("30 purchase orders (draft, sent, part received, received, cancelled)");
    }

    // Stock counts: weekly counts that were posted, a few cancelled
    if (await db.StockCounts.CountAsync() < 30)
    {
        await db.SaveChangesAsync();
        for (var c = 0; c < 30; c++)
        {
            var weeksAgo = c + 1;
            var createdAt = now.AddDays(-weeksAgo * 3).AddHours(-3);
            var counter = Pick(stockStaff);
            var cancelled = c % 11 == 10;
            var countId = Guid.NewGuid();
            db.StockCounts.Add(new StockCount
            {
                Id = countId,
                Name = c % 4 == 3 ? $"Month-end count, {createdAt:MMMM}" : $"Weekly count, week of {createdAt:MMM d}",
                Status = cancelled ? StockCountStatuses.Cancelled : StockCountStatuses.Posted,
                IsBlind = c % 3 == 0,
                Note = cancelled ? "Started on the wrong shelf, redone the next day" : null,
                CreatedAt = createdAt,
                CreatedBy = counter.Id,
                PostedAt = cancelled ? null : createdAt.AddHours(2),
                PostedBy = cancelled ? null : counter.Id,
                CancelledAt = cancelled ? createdAt.AddHours(1) : null,
                CancelledBy = cancelled ? counter.Id : null,
                TenantId = shopId,
            });
            foreach (var (item, _, _, _, _) in bulkItems.OrderBy(_ => random.Next()).Take(4 + c % 3))
            {
                db.StockCountLines.Add(new StockCountLine
                {
                    Id = Guid.NewGuid(),
                    CountId = countId,
                    ItemId = item.Id,
                    ExpectedQuantity = MainQuantity(db, item, shopId),
                    CountedQuantity = MainQuantity(db, item, shopId),
                    CountedAt = createdAt.AddHours(1),
                    CountedBy = counter.Id,
                    TenantId = shopId,
                });
            }
        }

        added.Add("30 stock counts (posted and cancelled)");
    }

    await db.SaveChangesAsync();

    // Expenses for the last two months
    var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(now, TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila")));
    var expenseRows = new (byte Category, string Text, decimal Amount)[]
    {
        (ExpenseCategories.Supplies, "Ice delivery", 650m),
        (ExpenseCategories.Utilities, "Water refill", 380m),
        (ExpenseCategories.Salaries, "Part-time barista pay", 4200m),
        (ExpenseCategories.Supplies, "Cleaning supplies from the palengke", 720m),
        (ExpenseCategories.Marketing, "Printed menu cards", 1350m),
        (ExpenseCategories.Delivery, "Courier for a catering order", 480m),
        (ExpenseCategories.PaymentFees, "GCash merchant fees", 310m),
        (ExpenseCategories.Utilities, "Internet bill", 1899m),
        (ExpenseCategories.Other, "Pest control visit", 1500m),
        (ExpenseCategories.Supplies, "Fresh flowers for the tables", 450m),
        (ExpenseCategories.Salaries, "Weekend crew overtime", 2600m),
        (ExpenseCategories.Other, "Grinder blade replacement", 950m),
    };
    for (var e = 0; e < 38; e++)
    {
        var (category, text, amount) = expenseRows[e % expenseRows.Length];
        var date = today.AddDays(-(2 + e * 3 / 2));
        var note = $"{text}, {date:MMM d}";
        if (await db.Expenses.AnyAsync(x => x.Note == note))
        {
            continue;
        }

        db.Expenses.Add(new Expense
        {
            Id = Guid.NewGuid(),
            ExpenseDate = date,
            Category = category,
            Amount = amount + e % 5 * 25m,
            Note = note,
            IsActive = true,
            CreatedAt = now.AddDays(-(2 + e * 3 / 2)),
            CreatedBy = manager.Id,
            TenantId = shopId,
        });
    }

    await db.SaveChangesAsync();

    // Orders for the last month. Totals come from the lines, the same way the app works them out.
    if (await db.Orders.CountAsync() < 90)
    {
        var drinkNames = drinksAddOns.Keys.ToList();
        var foodNames = products.Values.Where(p => !p.IsAddOn && p.CategoryId != products["Espresso"].CategoryId && p.Code is not null && !p.Code.StartsWith("RTL")).Select(p => p.Name).ToList();
        var orderNotes = new[] { "Less ice please", "Extra hot", "No sugar", "Name on the cup: Migs", "For pickup in 10 minutes", "Birthday treat, add a candle if possible", "Oat milk instead of fresh milk" };
        var specs = new List<OrderSpec>();
        for (var o = 0; o < 90; o++)
        {
            var lines = new List<OrderLineSpec>();
            var drinkCount = random.Next(100) < 20 ? 2 : 1;
            for (var d = 0; d < drinkCount; d++)
            {
                var drink = Pick(drinkNames);
                var types = drinksAddOns[drink];
                var chosen = new List<string>();
                if (types.Contains("Size"))
                {
                    chosen.Add(random.Next(100) < 65 ? "Medium" : "Large");
                }

                if (types.Contains("Temperature"))
                {
                    chosen.Add(random.Next(100) < 55 ? "Hot" : "Iced");
                }

                if (types.Contains("Flavor") && random.Next(100) < 20)
                {
                    chosen.Add(Pick(new[] { "Vanilla", "Caramel", "Hazelnut" }));
                }

                if (types.Contains("Extra") && random.Next(100) < 12)
                {
                    chosen.Add(Pick(new[] { "Extra Shot", "Oat Milk" }));
                }

                lines.Add(new OrderLineSpec(drink, random.Next(100) < 80 ? 1 : 2, chosen.ToArray()));
            }

            if (random.Next(100) < 45)
            {
                lines.Add(new OrderLineSpec(Pick(foodNames), random.Next(100) < 85 ? 1 : 2, []));
            }

            var roll = random.Next(100);
            var status = roll < 86 ? OrderStatusEnum.Completed : roll < 94 ? OrderStatusEnum.Cancelled : OrderStatusEnum.Refunded;
            var payment = status == OrderStatusEnum.Cancelled ? (PaymentMethodEnum?)null : random.Next(100) < 58 ? PaymentMethodEnum.Cash : PaymentMethodEnum.GCash;
            var customer = random.Next(100) < 40 ? Pick(customersByName.Keys.ToList()) : null;
            var senior = status == OrderStatusEnum.Completed && random.Next(100) < 6 ? (random.Next(2) == 0 ? SeniorPwdKind.Senior : SeniorPwdKind.Pwd) : (SeniorPwdKind?)null;
            var note = random.Next(100) < 15 ? Pick(orderNotes) : status == OrderStatusEnum.Cancelled ? "Customer changed their mind" : status == OrderStatusEnum.Refunded ? "Wrong drink served, refunded at the counter" : null;
            var tips = payment == PaymentMethodEnum.Cash && random.Next(100) < 10 ? 20m : (decimal?)null;
            specs.Add(new OrderSpec($"order {o}", note, status, payment, customer, -(4 + o * 8 + random.Next(0, 7)), lines.ToArray(), Tips: tips, Senior: senior));
        }

        var statusIds = await db.Statuses.Select(s => s.Id).ToListAsync();
        var bulkPricing = await LoadBranchPricingAsync(db, shopId);
        foreach (var spec in specs.Where(s => statusIds.Contains((int)s.Status)).OrderBy(s => s.HoursAgo))
        {
            AddOrder(db, spec, products, addOnProducts, customersByName, Pick(cashiers), shopId, now, vatRegistered, bulkPricing);
            await db.SaveChangesAsync();
        }

        added.Add($"{specs.Count} more orders over the last month");
    }

    // Audit log
    if (await db.AuditLogs.CountAsync() < 80)
    {
        var orderIds = await db.Orders.OrderBy(o => o.CreatedAt).Select(o => o.Id).Take(60).ToListAsync();
        var productList = products.Values.Where(p => !p.IsAddOn).ToList();
        var everyone = new List<User> { owner, manager }.Concat(staffUsers.Where(u => u.IsActive)).ToList();
        var ips = new[] { "112.200.45.18", "120.28.71.203", "49.145.12.77", "124.105.88.9" };
        for (var a = 0; a < 90; a++)
        {
            var user = everyone[a % everyone.Count];
            var timestamp = now.AddMinutes(-(40 + a * 190 + random.Next(0, 60)));
            var (action, entityType, entityId, oldValues, newValues) = (a % 6) switch
            {
                0 => ("UserLogin", "User", user.Id.ToString(), null, null),
                1 => ("OrderCreated", "Order", Pick(orderIds).ToString(), null, "{\"status\":\"Completed\"}"),
                2 => ("ProductUpdated", "Product", Pick(productList).Id.ToString(), $"{{\"price\":{Pick(productList).Price}}}", $"{{\"price\":{Pick(productList).Price + 5m}}}"),
                3 => ("ItemStockAdded", "Item", Pick(bulkItems).Item.Id.ToString(), null, "{\"reason\":\"Delivery received\"}"),
                4 => ("StockWasted", "StockWaste", Guid.NewGuid().ToString(), null, "{\"status\":\"Recorded\"}"),
                _ => ("UserLogout", "User", user.Id.ToString(), null, null),
            };
            db.AuditLogs.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                Action = action,
                EntityType = entityType,
                EntityId = entityId,
                OldValues = oldValues,
                NewValues = newValues,
                IpAddress = ips[a % ips.Length],
                Timestamp = timestamp,
                TenantId = shopId,
            });
        }

        added.Add("90 audit log rows");
    }

    await db.SaveChangesAsync();
}

async Task SeedStarterBulkAsync()
{
    await using var db = new SeedContext(options, starterTenantId);
    if (!await db.Tenants.AnyAsync(t => t.Id == starterTenantId) || await db.Orders.CountAsync() >= 40)
    {
        return;
    }

    var random = new Random(77);
    var owner = await db.Users.IgnoreQueryFilters().FirstAsync(u => u.Username == "starterowner");
    var staff = new (string Username, string First, string Last)[] { ("starter.cashier1", "Rowena", "Abad"), ("starter.cashier2", "Jun", "Calderon") };
    var cashiers = new List<User> { owner };
    foreach (var (username, first, last) in staff)
    {
        var user = await db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Username == username);
        if (user is null)
        {
            user = NewUser(username, first, last, UserRoleEnum.Cashier, starterTenantId);
            db.Users.Add(user);
        }

        cashiers.Add(user);
    }

    var customers = new Dictionary<string, Customer>();
    foreach (var (first, last, address) in new[] { ("Pedro", "Reyes", "7 Bonifacio Street, Pasig City"), ("Lourdes", "Tiu", "88 Scout Tuazon Street, Quezon City"), ("Ariel", "Macapagal", "14 Sampaguita Road, Marikina City"), ("Gemma", "Sarmiento", (string?)null) })
    {
        var customer = await db.Customers.FirstOrDefaultAsync(c => c.FirstName == first && c.LastName == last);
        if (customer is null)
        {
            customer = new Customer { Id = Guid.NewGuid(), FirstName = first, LastName = last, Address = address, IsActive = true, CreatedAt = now.AddDays(-10), CreatedBy = owner.Id, TenantId = starterTenantId };
            db.Customers.Add(customer);
        }

        customers[first] = customer;
    }

    await db.SaveChangesAsync();
    await AssignBranchesAsync(db, starterTenantId);

    var products = await db.Products.Where(p => !p.IsAddOn && p.IsActive).ToDictionaryAsync(p => p.Name);
    var names = products.Keys.ToList();
    var statusIds = await db.Statuses.Select(s => s.Id).ToListAsync();
    var noAddOns = new Dictionary<string, Product>();
    var customerKeys = customers.Keys.ToList();
    for (var o = 0; o < 45; o++)
    {
        var lines = new[] { new OrderLineSpec(names[random.Next(names.Count)], random.Next(1, 3), []) };
        var status = random.Next(100) < 90 ? OrderStatusEnum.Completed : OrderStatusEnum.Cancelled;
        var payment = status == OrderStatusEnum.Completed ? (random.Next(100) < 60 ? PaymentMethodEnum.Cash : PaymentMethodEnum.GCash) : (PaymentMethodEnum?)null;
        var customer = random.Next(100) < 35 ? customerKeys[random.Next(customerKeys.Count)] : null;
        var spec = new OrderSpec($"starter order {o}", null, status, payment, customer, -(3 + o * 14 + random.Next(0, 9)), lines);
        if (!statusIds.Contains((int)spec.Status))
        {
            continue;
        }

        AddOrder(db, spec, products, noAddOns, customers, cashiers[random.Next(cashiers.Count)], starterTenantId, now, false);
        await db.SaveChangesAsync();
    }

    added.Add("Starter Demo Cafe: 2 more staff, 3 more customers and 45 orders over the last month");
}

async Task EnsureBranchesAsync(WTFDbContext db, Guid tenantId, (string Name, string Code, string? Address, string? Phone, bool IsMain)[] branches)
{
    foreach (var (name, code, address, phone, isMain) in branches)
    {
        if (await db.Branches.IgnoreQueryFilters().AnyAsync(b => b.TenantId == tenantId && b.Code == code))
        {
            continue;
        }

        var existingMain = isMain ? await db.Branches.IgnoreQueryFilters().FirstOrDefaultAsync(b => b.TenantId == tenantId && b.IsMain) : null;
        if (existingMain is not null)
        {
            // The branches script already gave the shop its Main branch; the demo shop uses that one under its real name.
            existingMain.Name = name;
            existingMain.Code = code;
            existingMain.Address = address;
            existingMain.Phone = phone;
            added.Add($"branch {name} ({code})");
            continue;
        }

        db.Branches.Add(new Branch
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Name = name,
            Code = code,
            Address = address,
            Phone = phone,
            TimeZone = "Asia/Manila",
            IsActive = true,
            IsMain = isMain,
            CreatedAt = now.AddDays(-45),
        });
        added.Add($"branch {name} ({code})");
    }

    await db.SaveChangesAsync();
}

// Cashiers and stock managers work in one branch each, spread across the branches in turn; everyone else sees all of them.
async Task AssignBranchesAsync(WTFDbContext db, Guid tenantId)
{
    var branches = await db.Branches.IgnoreQueryFilters()
        .Where(b => b.TenantId == tenantId && b.IsActive)
        .OrderByDescending(b => b.IsMain).ThenBy(b => b.Code)
        .ToListAsync();
    if (branches.Count == 0)
    {
        return;
    }

    var main = branches[0];
    var users = await db.Users.IgnoreQueryFilters()
        .Where(u => u.TenantId == tenantId && u.DefaultBranchId == null)
        .OrderBy(u => u.Username)
        .ToListAsync();
    var turn = 0;
    foreach (var user in users)
    {
        var single = user.RoleId is (int)UserRoleEnum.Cashier or (int)UserRoleEnum.StockManager;
        var branch = single ? branches[turn++ % branches.Count] : main;
        user.DefaultBranchId = branch.Id;
        user.BranchScope = (byte)(single ? BranchScopeEnum.Selected : BranchScopeEnum.All);
        if (single)
        {
            db.UserBranches.Add(new UserBranch { UserId = user.Id, BranchId = branch.Id, CreatedAt = now });
        }
    }

    if (users.Count > 0)
    {
        await db.SaveChangesAsync();
    }
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

User NewUser(string username, string firstName, string lastName, UserRoleEnum role, Guid tenantId)
{
    var id = Guid.NewGuid();
    return new User
    {
        Id = id,
        Username = username,
        PasswordHash = hash,
        FirstName = firstName,
        LastName = lastName,
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

static decimal MainQuantity(WTFDbContext db, Item item, Guid tenantId)
{
    var main = db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == tenantId && b.IsMain).Select(b => b.Id).First();
    return db.ItemBranchStocks.Local.Where(s => s.ItemId == item.Id && s.BranchId == main).Select(s => s.CurrentQuantity).FirstOrDefault();
}

// One stock change: moves the item's quantity and writes the matching history row
static StockMovement Move(WTFDbContext db, Item item, string type, decimal delta, Guid userId, Guid tenantId, string? referenceType, Guid? referenceId, string notes, decimal? unitCost, Guid? branchId = null)
{
    var branch = branchId ?? db.Branches.IgnoreQueryFilters().Where(b => b.TenantId == tenantId && b.IsMain).Select(b => b.Id).First();
    var stock = db.ItemBranchStocks.Local.FirstOrDefault(s => s.ItemId == item.Id && s.BranchId == branch)
        ?? db.ItemBranchStocks.IgnoreQueryFilters().FirstOrDefault(s => s.ItemId == item.Id && s.BranchId == branch);
    if (stock is null)
    {
        stock = new ItemBranchStock { Id = Guid.NewGuid(), TenantId = tenantId, ItemId = item.Id, BranchId = branch, CurrentQuantity = 0m, UpdatedAt = DateTime.UtcNow };
        db.ItemBranchStocks.Add(stock);
    }

    var before = stock.CurrentQuantity;
    stock.CurrentQuantity = before + delta;
    stock.UpdatedAt = DateTime.UtcNow;
    item.CurrentQuantity += delta;
    var movement = new StockMovement
    {
        Id = Guid.NewGuid(),
        ItemId = item.Id,
        BranchId = branch,
        MovementType = type,
        QuantityDelta = delta,
        QuantityBefore = before,
        QuantityAfter = stock.CurrentQuantity,
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

static Order AddOrder(WTFDbContext db, OrderSpec spec, Dictionary<string, Product> products, Dictionary<string, Product> addOns, Dictionary<string, Customer> customers, User creator, Guid tenantId, DateTime now, bool vatRegistered, BranchPricing? pricing = null)
{
    // A sale is priced the way its branch prices things: the branch the spec names, else the one its cashier works in
    var orderBranchId = spec.BranchCode is not null && pricing is not null && pricing.BranchIds.TryGetValue(spec.BranchCode, out var specBranchId) ? specBranchId : creator.DefaultBranchId;
    var branchPrices = orderBranchId is { } branchKey && pricing is not null && pricing.Prices.TryGetValue(branchKey, out var found) ? found : [];
    decimal PriceIn(Product p) => branchPrices.GetValueOrDefault(p.Id, p.Price);

    var orderId = Guid.NewGuid();
    var createdAt = now.AddHours(spec.HoursAgo).AddMinutes(spec.MinutesAgo);
    var customer = spec.Customer is null ? null : customers[spec.Customer];
    var sortOrder = 0;
    var gross = 0m;
    var seniorDiscount = 0m;
    var seniorRows = new List<(OrderItem Item, SeniorPwdAmounts Amounts)>();

    foreach (var line in spec.Lines)
    {
        var product = products[line.Product];
        var unitPrice = line.PromoPrice ?? PriceIn(product);
        var lineId = Guid.NewGuid();
        var lineItem = new OrderItem
        {
            Id = lineId,
            OrderId = orderId,
            ProductId = product.Id,
            Quantity = line.Quantity,
            Price = unitPrice,
            OriginalPrice = line.PromoPrice is null ? null : PriceIn(product),
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
                Price = PriceIn(addOn),
                ParentOrderItemId = lineId,
                SortOrder = sortOrder++,
                TenantId = tenantId,
            });
            addOnTotal += PriceIn(addOn);
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
            CustomerName = kind == SeniorPwdKind.Senior ? "Remedios Navarro" : "Elena Villanueva",
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
    var held = spec.Held;
    var order = new Order
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
        Note = spec.Note,
        SpecialInstructions = spec.Instructions,
        Source = (byte)(spec.FromLink ? OrderSourceEnum.CustomerLink : OrderSourceEnum.Pos),
        FulfillmentType = spec.FromLink ? (byte)FulfillmentTypeEnum.Delivery : null,
        DeliveryAddress = spec.FromLink ? customer?.Address : null,
        ContactNumber = spec.FromLink ? customer?.ContactNumber : null,
        CustomerAddress = customer?.Address,
        AcceptedAt = paid || (spec.FromLink && spec.Status == OrderStatusEnum.Pending) ? createdAt : null,
        ReadyAt = spec.Kitchen is { } kitchenReady
            ? kitchenReady.ReadyMinutesAfter is { } ready ? createdAt.AddMinutes(ready) : null
            : paid ? createdAt.AddMinutes(8) : null,
        KitchenStatus = spec.Kitchen is { } kitchen ? (byte)kitchen.State : null,
        KitchenStartedAt = spec.Kitchen?.StartedMinutesAfter is { } started ? createdAt.AddMinutes(started) : null,
        KitchenServedAt = spec.Kitchen?.ServedMinutesAfter is { } served ? createdAt.AddMinutes(served) : null,
        KitchenUpdatedBy = spec.Kitchen is null ? null : creator.Id,
        KitchenChangedAt = spec.Kitchen?.ChangeNote is null ? null : createdAt.AddMinutes(3),
        KitchenChangeNote = spec.Kitchen?.ChangeNote,
        KitchenChangeKind = spec.Kitchen?.ChangeKind is { } kind2 ? (byte)kind2 : null,
        OfflineLocalId = held?.LocalId,
        QuotedTotal = held is null ? null : net - held.QuotedLess,
        CatalogSyncedAt = held is null ? null : createdAt.AddHours(-3),
        ReviewReasons = held is null ? null : string.Join("\n", held.Reasons.Where(r => r.Severity == ReviewSeverityEnum.Hold).Select(r => r.Text)),
        TenantId = tenantId,
        BranchId = orderBranchId ?? Guid.Empty,
    };
    db.Orders.Add(order);

    if (held is not null)
    {
        for (var i = 0; i < held.Reasons.Length; i++)
        {
            var reason = held.Reasons[i];
            db.OrderReviewReasons.Add(new OrderReviewReason
            {
                Id = Guid.NewGuid(),
                OrderId = orderId,
                SortOrder = i,
                LineIndex = reason.LineIndex,
                Code = reason.Code,
                Severity = (byte)reason.Severity,
                ExpectedValue = reason.Expected,
                QuotedValue = reason.Quoted,
                Text = reason.Text,
                TenantId = tenantId,
            });
        }
    }

    return order;
}

internal sealed record BranchPricing(Dictionary<string, Guid> BranchIds, Dictionary<Guid, Dictionary<Guid, decimal>> Prices);

internal enum SeniorPwdKind : byte
{
    Senior = 1,
    Pwd = 2,
}

internal sealed record OrderLineSpec(string Product, int Quantity, string[] AddOns, decimal? PromoPrice = null, string? PromoLabel = null);

internal sealed record OrderSpec(
    string Label,
    string? Note,
    OrderStatusEnum Status,
    PaymentMethodEnum? Payment,
    string? Customer,
    int HoursAgo,
    OrderLineSpec[] Lines,
    decimal? Tips = null,
    SeniorPwdKind? Senior = null,
    bool FromLink = false,
    HeldSpec? Held = null,
    int MinutesAgo = 0,
    KitchenSpec? Kitchen = null,
    string? Instructions = null,
    string? BranchCode = null);

internal sealed record KitchenSpec(
    KitchenState State,
    int? StartedMinutesAfter = null,
    int? ReadyMinutesAfter = null,
    int? ServedMinutesAfter = null,
    string? ChangeNote = null,
    KitchenChangeKind? ChangeKind = null);

internal sealed record HeldReasonSpec(string Code, ReviewSeverityEnum Severity, string Text, int? LineIndex = null, string? Expected = null, string? Quoted = null);

internal sealed record HeldSpec(string LocalId, decimal QuotedLess, HeldReasonSpec[] Reasons);

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
