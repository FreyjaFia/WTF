using Microsoft.AspNetCore.SignalR;
using NSubstitute;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Notifications;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Tests.Infrastructure;

/// <summary>Substitutes for the services handlers call out to. Assert on them with Received()/DidNotReceive().</summary>
internal static class TestFakes
{
    public static ITenantFeatures Features { get; } = new UncachedTenantFeatures();

    public static IAuditService Audit() => Substitute.For<IAuditService>();

    public static IStockAlertService Alerts(WTFDbContext db) => new StockAlertService(db, Notifications(db), Features);

    public static INotificationService Notifications(WTFDbContext db, IPushNotificationService? push = null) =>
        new NotificationService(db, push ?? Push(), Substitute.For<IHubContext<NotificationHub>>());

    public static IOrderStockService Stock(WTFDbContext db) => new OrderStockService(db, Audit(), Alerts(db), Features);

    public static IPushNotificationService Push() => Substitute.For<IPushNotificationService>();

    public static IConversationNotifier Conversations() => Substitute.For<IConversationNotifier>();

    /// <summary>A dashboard hub context whose clients accept any broadcast (NSubstitute auto-creates the nested proxies).</summary>
    public static IHubContext<DashboardHub> Hub() => Substitute.For<IHubContext<DashboardHub>>();
}

/// <summary>Reads the plan from the database every time, so a test that changes the plan sees it at once.</summary>
internal sealed class UncachedTenantFeatures : ITenantFeatures
{
    public Task<TenantPlan> GetAsync(WTFDbContext db, Guid tenantId, CancellationToken cancellationToken) =>
        TenantPlanLookup.LoadAsync(db, tenantId, cancellationToken);

    public void Forget()
    {
    }

    public void Forget(Guid tenantId)
    {
    }
}
