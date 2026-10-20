using Microsoft.AspNetCore.SignalR;
using NSubstitute;
using WTF.Api.Features.Inventory;
using WTF.Api.Features.Notifications;
using WTF.Api.Hubs;
using WTF.Api.Services;
using WTF.Domain.Data;

namespace WTF.Tests.Infrastructure;

/// <summary>Substitutes for the services handlers call out to. Assert on them with Received()/DidNotReceive().</summary>
internal static class TestFakes
{
    public static IAuditService Audit() => Substitute.For<IAuditService>();

    public static IStockAlertService Alerts(WTFDbContext db) => new StockAlertService(db, Notifications(db));

    public static INotificationService Notifications(WTFDbContext db, IPushNotificationService? push = null) =>
        new NotificationService(db, push ?? Push(), Substitute.For<IHubContext<NotificationHub>>());

    public static IOrderStockService Stock(WTFDbContext db) => new OrderStockService(db, Audit(), Alerts(db));

    public static IPushNotificationService Push() => Substitute.For<IPushNotificationService>();

    public static IConversationNotifier Conversations() => Substitute.For<IConversationNotifier>();

    /// <summary>A dashboard hub context whose clients accept any broadcast (NSubstitute auto-creates the nested proxies).</summary>
    public static IHubContext<DashboardHub> Hub() => Substitute.For<IHubContext<DashboardHub>>();
}
