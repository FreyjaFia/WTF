using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NSubstitute;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Notifications;
using WTF.Api.Features.OrderLinks;
using WTF.Api.Features.Platform;
using WTF.Api.Features.Subscriptions;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

/// <summary>Plans, subscriptions, invoices, the lapsed-shop rules and the brand against a real SQL Server.</summary>
public class SubscriptionDatabaseTests
{
    private static readonly DateTime Today = new(2026, 11, 8, 6, 0, 0, DateTimeKind.Utc);

    private sealed class FixedClock(DateTime utc) : TimeProvider
    {
        public DateTime Utc { get; set; } = utc;

        public override DateTimeOffset GetUtcNow() => new(Utc, TimeSpan.Zero);
    }

    private sealed class SwitchableTenant : ICurrentTenant, ITenantSwitch
    {
        private Guid? _id;

        public bool FilterEnabled => true;

        public Guid? TenantId => _id;

        public Guid? StampTenantId => _id;

        public void Use(Guid tenantId) => _id = tenantId;
    }

    private sealed class FixedTenant(Guid id) : ICurrentTenant
    {
        public bool FilterEnabled => true;

        public Guid? TenantId => id;

        public Guid? StampTenantId => id;
    }

    private static WTFDbContext PlatformContext(SqlTestDatabase database) => database.CreateContext(new SwitchableTenant());

    private static IPlatformAuditService Audit(WTFDbContext db) => new PlatformAuditService(db, TestRequest.None());

    private static async Task SeedPlansAsync(SqlTestDatabase database)
    {
        await using var db = database.CreateContext();
        db.Plans.Add(new Plan { Code = "starter", Name = "Starter", MonthlyPrice = 1500, Features = "pos,orders", IsActive = true, SortOrder = 1 });
        db.Plans.Add(new Plan { Code = "pro", Name = "Pro", MonthlyPrice = 2500, Features = "pos,orders,inventory", IsActive = true, SortOrder = 2 });
        await db.SaveChangesAsync();
    }

    private static async Task<CreatedTenantDto> CreateShopAsync(SqlTestDatabase database, string slug, bool trial = false, string? plan = null)
    {
        await using var db = PlatformContext(database);
        return await new CreateTenantHandler(db, Audit(db), Options.Create(new SubscriptionOptions()))
            .Handle(new CreateTenantCommand("Shop " + slug, slug, "Own", "Er", slug + ".owner", trial, plan), CancellationToken.None);
    }

    private static async Task SetPeriodAsync(SqlTestDatabase database, Guid tenantId, DateTime start, DateTime end, int grace = 7, decimal discount = 0)
    {
        await using var db = database.CreateContext();
        var sub = await db.TenantSubscriptions.SingleAsync(s => s.TenantId == tenantId);
        sub.CurrentPeriodStart = start;
        sub.CurrentPeriodEnd = end;
        sub.GraceDays = grace;
        sub.DiscountPercent = discount;
        await db.SaveChangesAsync();
    }

    [SqlFact]
    public async Task CreateTenant_GetsASubscriptionOnTheTopPlan_AndBrandSettings()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);

        var shop = await CreateShopAsync(database, "moonbrew");

        await using var db = database.CreateContext();
        var sub = await db.TenantSubscriptions.Include(s => s.Plan).SingleAsync(s => s.TenantId == shop.Tenant.Id);
        sub.Plan.Code.ShouldBe("pro");
        sub.GraceDays.ShouldBe(7);
        (sub.CurrentPeriodEnd - sub.CurrentPeriodStart).Days.ShouldBeInRange(28, 31);

        var settings = await db.TenantSettings.IgnoreQueryFilters().SingleAsync(s => s.TenantId == shop.Tenant.Id);
        settings.ShopName.ShouldBe("Shop moonbrew");
        settings.TimeZone.ShouldBe("Asia/Manila");
        settings.CurrencyCode.ShouldBe("PHP");
    }

    [SqlFact]
    public async Task CreateTenant_AsATrial_UsesTheTrialDays_AndAPlanCanBePicked()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);

        var shop = await CreateShopAsync(database, "trialcafe", trial: true, plan: "starter");

        await using var db = database.CreateContext();
        var sub = await db.TenantSubscriptions.Include(s => s.Plan).SingleAsync(s => s.TenantId == shop.Tenant.Id);
        sub.Plan.Code.ShouldBe("starter");
        (sub.CurrentPeriodEnd - sub.CurrentPeriodStart).Days.ShouldBe(30);
        shop.Tenant.Status.ShouldBe(TenantAccess.Trial);

        await Should.ThrowAsync<InvalidOperationException>(() => CreateShopAsync(database, "otherone", plan: "nope"));
    }

    [SqlFact]
    public async Task Invoice_IsPricedByThePlanAndDiscount_AndPayingExtendsFromTheEnd()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "moonbrew");
        var clock = new FixedClock(Today);
        var end = Today.AddDays(10);
        await SetPeriodAsync(database, shop.Tenant.Id, Today.AddDays(-20), end, discount: 20);

        TenantInvoiceDto invoice;
        await using (var db = PlatformContext(database))
        {
            invoice = await new CreateInvoiceHandler(db, Audit(db), clock)
                .Handle(new CreateInvoiceCommand(shop.Tenant.Id, 3, "INV-1", null, null), CancellationToken.None);
        }

        invoice.Amount.ShouldBe(6000m);
        invoice.PeriodStart.ShouldBe(end);
        invoice.PeriodEnd.ShouldBe(end.AddMonths(3));
        invoice.StatusName.ShouldBe("Open");

        // Open invoices extend nothing.
        await using (var db = database.CreateContext())
        {
            (await db.TenantSubscriptions.SingleAsync(s => s.TenantId == shop.Tenant.Id)).CurrentPeriodEnd.ShouldBe(end);
        }

        TenantSubscriptionDto after;
        await using (var db = PlatformContext(database))
        {
            after = await new MarkInvoicePaidHandler(db, Audit(db), new TenantStatusCache(clock), clock)
                .Handle(new MarkInvoicePaidCommand(invoice.Id, "GCash 123"), CancellationToken.None);
        }

        after.PeriodEnd.ShouldBe(end.AddMonths(3));
        after.Invoices.Single().StatusName.ShouldBe("Paid");
        after.Invoices.Single().Reference.ShouldBe("GCash 123");
    }

    [SqlFact]
    public async Task PayingALapsedShop_StartsFromToday_AndATrialBecomesActive()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "lapsed", trial: true);
        var clock = new FixedClock(Today);
        await SetPeriodAsync(database, shop.Tenant.Id, Today.AddDays(-60), Today.AddDays(-30));

        await using var db = PlatformContext(database);
        var invoice = await new CreateInvoiceHandler(db, Audit(db), clock)
            .Handle(new CreateInvoiceCommand(shop.Tenant.Id, 1, null, null, null), CancellationToken.None);
        var after = await new MarkInvoicePaidHandler(db, Audit(db), new TenantStatusCache(clock), clock)
            .Handle(new MarkInvoicePaidCommand(invoice.Id, null), CancellationToken.None);

        after.PeriodStart.ShouldBe(Today);
        after.PeriodEnd.ShouldBe(Today.AddMonths(1));
        after.TenantStatus.ShouldBe(TenantAccess.Active);
    }

    [SqlFact]
    public async Task APaidOrVoidInvoice_CannotBePaidAgain_AndTwoInvoicesExtendOneAfterTheOther()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "twice");
        var clock = new FixedClock(Today);
        await SetPeriodAsync(database, shop.Tenant.Id, Today.AddDays(-5), Today.AddDays(25));

        await using var db = PlatformContext(database);
        var first = await new CreateInvoiceHandler(db, Audit(db), clock).Handle(new CreateInvoiceCommand(shop.Tenant.Id, 1, null, null, null), CancellationToken.None);
        var second = await new CreateInvoiceHandler(db, Audit(db), clock).Handle(new CreateInvoiceCommand(shop.Tenant.Id, 1, null, null, null), CancellationToken.None);
        var voided = await new CreateInvoiceHandler(db, Audit(db), clock).Handle(new CreateInvoiceCommand(shop.Tenant.Id, 1, null, null, null), CancellationToken.None);
        var cache = new TenantStatusCache(clock);

        await new MarkInvoicePaidHandler(db, Audit(db), cache, clock).Handle(new MarkInvoicePaidCommand(first.Id, null), CancellationToken.None);
        var after = await new MarkInvoicePaidHandler(db, Audit(db), cache, clock).Handle(new MarkInvoicePaidCommand(second.Id, null), CancellationToken.None);
        after.PeriodEnd.ShouldBe(Today.AddDays(25).AddMonths(2));

        await Should.ThrowAsync<InvalidOperationException>(() =>
            new MarkInvoicePaidHandler(db, Audit(db), cache, clock).Handle(new MarkInvoicePaidCommand(first.Id, null), CancellationToken.None));

        await new VoidInvoiceHandler(db, Audit(db), clock).Handle(new VoidInvoiceCommand(voided.Id), CancellationToken.None);
        await Should.ThrowAsync<InvalidOperationException>(() =>
            new MarkInvoicePaidHandler(db, Audit(db), cache, clock).Handle(new MarkInvoicePaidCommand(voided.Id, null), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() =>
            new VoidInvoiceHandler(db, Audit(db), clock).Handle(new VoidInvoiceCommand(first.Id), CancellationToken.None));
    }

    [SqlFact]
    public async Task SetSubscription_ChangesPlanGraceAndDiscount_AndRefusesBadValues()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "tweak");
        var clock = new FixedClock(Today);
        int starterId;
        await using (var all = database.CreateContext())
        {
            starterId = (await all.Plans.SingleAsync(p => p.Code == "starter")).Id;
        }

        await using var db = PlatformContext(database);
        var handler = new SetTenantSubscriptionHandler(db, Audit(db), new TenantStatusCache(clock), new TenantFeatureCache(clock), clock);

        var changed = await handler.Handle(new SetTenantSubscriptionCommand(shop.Tenant.Id, starterId, Today.AddDays(45), 14, 25, " pilot "), CancellationToken.None);
        changed.PlanName.ShouldBe("Starter");
        changed.GraceDays.ShouldBe(14);
        changed.DiscountPercent.ShouldBe(25);
        changed.Notes.ShouldBe("pilot");
        changed.PeriodEnd.ShouldBe(Today.AddDays(45));

        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new SetTenantSubscriptionCommand(shop.Tenant.Id, 9999, null, 7, 0, null), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new SetTenantSubscriptionCommand(shop.Tenant.Id, starterId, null, 200, 0, null), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new SetTenantSubscriptionCommand(shop.Tenant.Id, starterId, null, 7, 101, null), CancellationToken.None));
        await Should.ThrowAsync<InvalidOperationException>(() => handler.Handle(new SetTenantSubscriptionCommand(shop.Tenant.Id, starterId, Today.AddYears(-5), 7, 0, null), CancellationToken.None));
    }

    [SqlFact]
    public async Task TheShopsPlanDecidesItsFeatures_AndAPlanChangeOrEditShowsAtOnce()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "gated", plan: "starter");
        var clock = new FixedClock(Today);
        var features = new TenantFeatureCache(clock);
        int proId;
        await using (var all = database.CreateContext())
        {
            proId = (await all.Plans.SingleAsync(p => p.Code == "pro")).Id;
        }

        await using var db = PlatformContext(database);
        var starter = await features.GetAsync(db, shop.Tenant.Id, CancellationToken.None);
        starter.Name.ShouldBe("Starter");
        starter.Features.Order().ShouldBe(["core"]);

        // A shop that has no subscription row (single-shop install) keeps every feature.
        (await features.GetAsync(db, Guid.NewGuid(), CancellationToken.None)).Features.ShouldContain("inventory");

        await new SetTenantSubscriptionHandler(db, Audit(db), new TenantStatusCache(clock), features, clock)
            .Handle(new SetTenantSubscriptionCommand(shop.Tenant.Id, proId, Today.AddDays(30), 7, 0, null), CancellationToken.None);
        var pro = await features.GetAsync(db, shop.Tenant.Id, CancellationToken.None);
        pro.Name.ShouldBe("Pro");
        pro.Features.Order().ShouldBe(["core", "inventory"]);

        await new UpdatePlanHandler(db, Audit(db), features)
            .Handle(new UpdatePlanCommand(proId, "Pro", 2500, ["pos", "promotions", "chat"], null, true), CancellationToken.None);
        (await features.GetAsync(db, shop.Tenant.Id, CancellationToken.None)).Features.Order().ShouldBe(["chat", "core", "promotions"]);
    }

    [SqlFact]
    public async Task TheShopSeesItsOwnSubscription_WithAVerifiableLease_AndNoOtherShopsInvoices()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var mine = await CreateShopAsync(database, "mine");
        var other = await CreateShopAsync(database, "other");
        var clock = new FixedClock(Today);
        await SetPeriodAsync(database, mine.Tenant.Id, Today.AddDays(-20), Today.AddDays(2));
        await using (var db = PlatformContext(database))
        {
            await new CreateInvoiceHandler(db, Audit(db), clock).Handle(new CreateInvoiceCommand(other.Tenant.Id, 1, null, null, null), CancellationToken.None);
        }

        var signer = new LeaseSigner(Options.Create(new SubscriptionOptions()));
        await using var mineDb = database.CreateContext(new FixedTenant(mine.Tenant.Id));

        var dto = await new GetSubscriptionHandler(mineDb, new FixedTenant(mine.Tenant.Id), signer, Options.Create(new SubscriptionOptions()), clock)
            .Handle(new GetSubscriptionQuery(), CancellationToken.None);

        dto.Managed.ShouldBeTrue();
        dto.PlanCode.ShouldBe("pro");
        dto.Warning.ShouldBe("lastDays");
        dto.DaysLeft.ShouldBe(2);
        dto.AccessUntil.ShouldBe(Today.AddDays(2).AddDays(7));
        var payload = signer.Verify(dto.Lease!);
        payload.ShouldNotBeNull();
        payload.TenantId.ShouldBe(mine.Tenant.Id);
        payload.PeriodEnd.ShouldBe(Today.AddDays(2));

        var invoices = await new GetMyInvoicesHandler(mineDb, new FixedTenant(mine.Tenant.Id)).Handle(new GetMyInvoicesQuery(), CancellationToken.None);
        invoices.ShouldBeEmpty();
    }

    [SqlFact]
    public async Task LockedState_IsReportedFromTheEndOfTheGrace()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "grace");
        await SetPeriodAsync(database, shop.Tenant.Id, Today.AddDays(-40), Today.AddDays(-7), grace: 7);

        await using var db = database.CreateContext();
        (await SubscriptionStateLoader.IsLockedAsync(db, shop.Tenant.Id, Today, CancellationToken.None)).ShouldBeTrue();
        (await SubscriptionStateLoader.IsLockedAsync(db, shop.Tenant.Id, Today.AddMinutes(-1), CancellationToken.None)).ShouldBeFalse();
        (await SubscriptionStateLoader.IsLockedAsync(db, Guid.NewGuid(), Today, CancellationToken.None)).ShouldBeFalse();
    }

    [SqlFact]
    public async Task ACustomerLink_StopsWorkingForALapsedShop_AndComesBackAfterPayment()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "linkshop");
        var token = OrderLinkToken.Generate();
        await using (var seed = database.CreateContext(new FixedTenant(shop.Tenant.Id)))
        {
            var userId = await seed.Users.Select(u => u.Id).FirstAsync();
            var customer = new Customer { Id = Guid.NewGuid(), FirstName = "C", LastName = "One", IsActive = true, AllowOrderingLink = true, CreatedAt = DateTime.UtcNow, CreatedBy = userId };
            seed.Customers.Add(customer);
            seed.ShortLinks.Add(new ShortLink { Id = Guid.NewGuid(), Token = token, TargetType = OrderLinkToken.TargetType, TargetId = customer.Id, CreatedAt = DateTime.UtcNow, CreatedBy = userId });
            await seed.SaveChangesAsync();
        }

        async Task<bool> OpensAsync()
        {
            await using var db = database.CreateContext(new SwitchableTenant());
            try
            {
                return await OrderLinkAccess.ResolveAsync(db, token, CancellationToken.None) is not null;
            }
            catch (ShopUnavailableException ex)
            {
                ex.ShopName.ShouldNotBeNullOrWhiteSpace();
                return false;
            }
        }

        (await OpensAsync()).ShouldBeTrue();

        await SetPeriodAsync(database, shop.Tenant.Id, DateTime.UtcNow.AddDays(-60), DateTime.UtcNow.AddDays(-30), grace: 7);
        (await OpensAsync()).ShouldBeFalse();

        await SetPeriodAsync(database, shop.Tenant.Id, DateTime.UtcNow.AddDays(-60), DateTime.UtcNow.AddDays(-3), grace: 7);
        (await OpensAsync()).ShouldBeTrue();
    }

    [SqlFact]
    public async Task DeletingAShop_RemovesItsSubscriptionInvoicesAndSettings()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var doomed = await CreateShopAsync(database, "doomed");
        var kept = await CreateShopAsync(database, "kept");
        var clock = new FixedClock(Today);
        await using (var db = PlatformContext(database))
        {
            await new CreateInvoiceHandler(db, Audit(db), clock).Handle(new CreateInvoiceCommand(doomed.Tenant.Id, 1, null, null, null), CancellationToken.None);
            await new CreateInvoiceHandler(db, Audit(db), clock).Handle(new CreateInvoiceCommand(kept.Tenant.Id, 1, null, null, null), CancellationToken.None);
        }

        await using (var db = database.CreateContext())
        {
            var admin = new PlatformAdmin { Username = "boss", PasswordHash = BCrypt.Net.BCrypt.HashPassword("correct horse battery"), IsActive = true, CreatedAt = DateTime.UtcNow };
            db.PlatformAdmins.Add(admin);
            await db.SaveChangesAsync();
        }

        await using (var db = PlatformContext(database))
        {
            await new SetTenantStatusHandler(db, Audit(db), new TenantStatusCache(clock))
                .Handle(new SetTenantStatusCommand(doomed.Tenant.Id, TenantStatusChange.Suspend), CancellationToken.None);
        }

        await using (var db = PlatformContext(database))
        {
            var admin = await db.PlatformAdmins.SingleAsync();
            var accessor = Substitute.For<Microsoft.AspNetCore.Http.IHttpContextAccessor>();
            accessor.HttpContext.Returns(new Microsoft.AspNetCore.Http.DefaultHttpContext
            {
                User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                [
                    new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, admin.Id.ToString()),
                    new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, admin.Username),
                    new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, WTF.Api.Common.Auth.AppRoles.PlatformAdmin),
                ], "test"))
            });
            var images = Substitute.For<IImageStorage>();
            images.ListAsync(Arg.Any<CancellationToken>()).Returns([]);
            await new DeleteTenantHandler(
                    db,
                    Audit(db),
                    new TenantStatusCache(clock),
                    accessor,
                    images,
                    Substitute.For<WTF.Api.Features.Conversations.IChatImageStore>(),
                    Microsoft.Extensions.Logging.Abstractions.NullLogger<DeleteTenantHandler>.Instance)
                .Handle(new DeleteTenantCommand(doomed.Tenant.Id, "doomed", "correct horse battery"), CancellationToken.None);
        }

        await using var all = database.CreateContext();
        (await all.TenantSubscriptions.AnyAsync(s => s.TenantId == doomed.Tenant.Id)).ShouldBeFalse();
        (await all.TenantInvoices.AnyAsync(i => i.TenantId == doomed.Tenant.Id)).ShouldBeFalse();
        (await all.TenantSettings.IgnoreQueryFilters().AnyAsync(s => s.TenantId == doomed.Tenant.Id)).ShouldBeFalse();
        (await all.TenantSubscriptions.AnyAsync(s => s.TenantId == kept.Tenant.Id)).ShouldBeTrue();
        (await all.TenantInvoices.AnyAsync(i => i.TenantId == kept.Tenant.Id)).ShouldBeTrue();
        (await all.TenantSettings.IgnoreQueryFilters().AnyAsync(s => s.TenantId == kept.Tenant.Id)).ShouldBeTrue();
    }

    [SqlFact]
    public async Task Brand_IsSavedPerShop_AndOneShopNeverSeesAnothers()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var a = await CreateShopAsync(database, "alpha");
        var b = await CreateShopAsync(database, "beta");
        var audit = TestFakes.Audit();

        await using (var db = database.CreateContext(new FixedTenant(a.Tenant.Id)))
        {
            var brand = BrandDefaults.For("Alpha Coffee") with { Phone = "0917", PrimaryColor = "#1A3C5E" };
            await new UpdateBrandHandler(db, new FixedTenant(a.Tenant.Id), audit, Substitute.For<Microsoft.AspNetCore.Http.IHttpContextAccessor>()).Handle(new UpdateBrandCommand(brand), CancellationToken.None);
        }

        await using (var db = database.CreateContext(new FixedTenant(a.Tenant.Id)))
        {
            var loaded = await new GetBrandHandler(db, new FixedTenant(a.Tenant.Id), Substitute.For<Microsoft.AspNetCore.Http.IHttpContextAccessor>()).Handle(new GetBrandQuery(), CancellationToken.None);
            loaded.ShopName.ShouldBe("Alpha Coffee");
            loaded.PrimaryColor.ShouldBe("#1a3c5e");
        }

        await using (var db = database.CreateContext(new FixedTenant(b.Tenant.Id)))
        {
            var loaded = await new GetBrandHandler(db, new FixedTenant(b.Tenant.Id), Substitute.For<Microsoft.AspNetCore.Http.IHttpContextAccessor>()).Handle(new GetBrandQuery(), CancellationToken.None);
            loaded.ShopName.ShouldBe("Shop beta");
        }

        await audit.Received(1).LogAsync(
            Arg.Any<WTF.Api.Features.Audit.Enums.AuditAction>(), Arg.Any<WTF.Api.Features.Audit.Enums.AuditEntityType>(), Arg.Any<string>(),
            Arg.Any<object?>(), Arg.Any<object?>(), Arg.Any<Guid?>(), Arg.Any<CancellationToken>());
    }

    [SqlFact]
    public async Task BrandLogo_IsUploadedReplacedAndRemoved_ForOneShopOnly()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var a = await CreateShopAsync(database, "logoa");
        var b = await CreateShopAsync(database, "logob");
        var audit = TestFakes.Audit();
        var storage = Substitute.For<WTF.Api.Services.IImageStorage>();
        var urls = new Queue<string>(["/images/brand/one.png", "/images/brand/two.png"]);
        storage.SaveAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<byte[]>(), Arg.Any<CancellationToken>()).Returns(_ => urls.Dequeue());
        var http = Substitute.For<Microsoft.AspNetCore.Http.IHttpContextAccessor>();
        http.HttpContext.Returns((Microsoft.AspNetCore.Http.HttpContext?)null);

        await using (var db = database.CreateContext(new FixedTenant(a.Tenant.Id)))
        {
            var handler = new UploadBrandLogoHandler(db, new FixedTenant(a.Tenant.Id), storage, audit, http);
            var first = await handler.Handle(new UploadBrandLogoCommand(TestImages.Png()), CancellationToken.None);
            first.LogoUrl.ShouldBe("/images/brand/one.png");
            var second = await handler.Handle(new UploadBrandLogoCommand(TestImages.Png()), CancellationToken.None);
            second.LogoUrl.ShouldBe("/images/brand/two.png");
            await storage.Received(1).DeleteAsync("/images/brand/one.png", Arg.Any<CancellationToken>());
        }

        await using (var db = database.CreateContext(new FixedTenant(b.Tenant.Id)))
        {
            var other = await new GetBrandHandler(db, new FixedTenant(b.Tenant.Id), http).Handle(new GetBrandQuery(), CancellationToken.None);
            other.LogoUrl.ShouldBeNull();
        }

        await using (var db = database.CreateContext(new FixedTenant(a.Tenant.Id)))
        {
            var saved = await new UpdateBrandHandler(db, new FixedTenant(a.Tenant.Id), audit, http)
                .Handle(new UpdateBrandCommand(BrandDefaults.For("Logo A") with { LogoUrl = "https://evil.example/x.png" }), CancellationToken.None);
            saved.LogoUrl.ShouldBe("/images/brand/two.png");

            var removed = await new RemoveBrandLogoHandler(db, new FixedTenant(a.Tenant.Id), storage, audit, http)
                .Handle(new RemoveBrandLogoCommand(), CancellationToken.None);
            removed.LogoUrl.ShouldBeNull();
            await storage.Received(1).DeleteAsync("/images/brand/two.png", Arg.Any<CancellationToken>());
        }
    }

    [SqlFact]
    public async Task PlatformAdmin_CanSetAShopsBrand_AndUpdatePlans()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "gamma");

        await using (var db = PlatformContext(database))
        {
            var brand = BrandDefaults.For("Gamma Brew") with { ShortName = "Gamma" };
            var saved = await new SetTenantBrandHandler(db, Audit(db)).Handle(new SetTenantBrandCommand(shop.Tenant.Id, brand), CancellationToken.None);
            saved.ShortName.ShouldBe("Gamma");
        }

        await using (var db = PlatformContext(database))
        {
            var plan = await db.Plans.SingleAsync(p => p.Code == "pro");
            var updated = await new UpdatePlanHandler(db, Audit(db), new TenantFeatureCache(TimeProvider.System))
                .Handle(new UpdatePlanCommand(plan.Id, "Pro", 2800, ["POS", "orders", "pos"], 10, true), CancellationToken.None);
            updated.MonthlyPrice.ShouldBe(2800);
            updated.Features.ShouldBe(["pos", "orders"]);
            updated.MaxUsers.ShouldBe(10);

            await Should.ThrowAsync<InvalidOperationException>(() =>
                new UpdatePlanHandler(db, Audit(db), new TenantFeatureCache(TimeProvider.System)).Handle(new UpdatePlanCommand(plan.Id, "", 1, [], null, true), CancellationToken.None));
            await Should.ThrowAsync<InvalidOperationException>(() =>
                new UpdatePlanHandler(db, Audit(db), new TenantFeatureCache(TimeProvider.System)).Handle(new UpdatePlanCommand(plan.Id, "Pro", -1, [], null, true), CancellationToken.None));
        }
    }

    [SqlFact]
    public async Task Reminder_GoesToOwnersOnce_AndNotInADryRun()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedPlansAsync(database);
        var shop = await CreateShopAsync(database, "remind");
        var clock = new FixedClock(Today);
        await SetPeriodAsync(database, shop.Tenant.Id, Today.AddDays(-27), Today.AddDays(3));
        var notifications = Substitute.For<INotificationService>();
        var storage = Substitute.For<IReportFileStorage>();

        async Task<SubscriptionReminderResult> RunAsync(bool dryRun)
        {
            await using var db = database.CreateContext(new FixedTenant(shop.Tenant.Id));
            var options = Options.Create(new SubscriptionRemindersOptions { DryRun = dryRun });
            return await new SubscriptionReminderService(
                    db, new FixedTenant(shop.Tenant.Id), notifications, storage, options, clock,
                    Microsoft.Extensions.Logging.Abstractions.NullLogger<SubscriptionReminderService>.Instance)
                .RunAsync(CancellationToken.None);
        }

        (await RunAsync(dryRun: true)).Reminders.ShouldBe(1);
        await notifications.DidNotReceive().NotifyAsync(Arg.Any<IReadOnlyCollection<Guid>>(), Arg.Any<NotificationMessage>(), Arg.Any<CancellationToken>());

        (await RunAsync(dryRun: false)).Reminders.ShouldBe(1);
        await notifications.Received(1).NotifyAsync(
            Arg.Is<IReadOnlyCollection<Guid>>(ids => ids.Count == 1),
            Arg.Is<NotificationMessage>(m => m.Kind == NotificationKinds.Subscription && m.Title == "Subscription ends soon"),
            Arg.Any<CancellationToken>());

        (await RunAsync(dryRun: false)).Reminders.ShouldBe(0);
        await notifications.Received(1).NotifyAsync(Arg.Any<IReadOnlyCollection<Guid>>(), Arg.Any<NotificationMessage>(), Arg.Any<CancellationToken>());
    }
}
