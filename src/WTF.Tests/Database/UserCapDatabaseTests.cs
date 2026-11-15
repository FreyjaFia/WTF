using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NSubstitute;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Subscriptions;
using WTF.Api.Features.Users;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Database;

public class UserCapDatabaseTests
{
    private static readonly FixedTenant Shop = new(TenantDefaults.DefaultTenantId);

    private static async Task SetCapAsync(SqlTestDatabase database, int? maxUsers)
    {
        await using var db = database.CreateContext();
        var sub = await db.TenantSubscriptions.SingleOrDefaultAsync();
        if (sub is null)
        {
            var plan = new Plan { Code = "capped", Name = "Capped", MonthlyPrice = 1, Features = "reports", MaxUsers = maxUsers, IsActive = true, SortOrder = 1 };
            db.Plans.Add(plan);
            await db.SaveChangesAsync();
            db.TenantSubscriptions.Add(new TenantSubscription
            {
                TenantId = TenantDefaults.DefaultTenantId,
                PlanId = plan.Id,
                CurrentPeriodStart = DateTime.UtcNow.AddDays(-5),
                CurrentPeriodEnd = DateTime.UtcNow.AddDays(300),
                GraceDays = 7,
                UpdatedAt = DateTime.UtcNow,
            });
        }
        else
        {
            (await db.Plans.SingleAsync(p => p.Id == sub.PlanId)).MaxUsers = maxUsers;
        }

        await db.SaveChangesAsync();
    }

    private static async Task SeedUsersAsync(SqlTestDatabase database, int active, int inactive = 0)
    {
        for (var i = 0; i < active; i++)
        {
            await SqlSeed.UserAsync(database, "active" + i);
        }

        for (var i = 0; i < inactive; i++)
        {
            await SqlSeed.UserAsync(database, "inactive" + i, active: false);
        }
    }

    private static Guid Actor(WTFDbContext db) => db.Users.IgnoreQueryFilters().OrderBy(u => u.CreatedAt).Select(u => u.Id).First();

    private static CreateUserHandler Create(WTFDbContext db) =>
        new(db, TestRequest.As(Actor(db), AppRoles.Owner), TestFakes.Audit(), new RolePermissionCache(TimeProvider.System), Shop);

    private static RestoreUserHandler Restore(WTFDbContext db) =>
        new(db, TestRequest.As(Actor(db)), TestFakes.Audit(), Shop);

    private static CreateUserCommand NewUser(string username) => new("New", "Person", username, "S3cret-pass", 2);

    [SqlFact]
    public async Task Create_BelowTheCap_Saves()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SetCapAsync(database, 3);
        await SeedUsersAsync(database, 2, inactive: 5);

        await using var db = database.CreateContext(Shop);
        var dto = await Create(db).Handle(NewUser("third"), CancellationToken.None);

        dto.Username.ShouldBe("third");
    }

    [SqlFact]
    public async Task Create_AtTheCap_IsRefusedWithThePlanLimitCode_AndSavesNothing()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SetCapAsync(database, 3);
        await SeedUsersAsync(database, 3, inactive: 1);

        await using (var db = database.CreateContext(Shop))
        {
            var ex = await Should.ThrowAsync<ForbiddenActionException>(() => Create(db).Handle(NewUser("fourth"), CancellationToken.None));
            ex.Code.ShouldBe(UserSeatGuard.UserLimitCode);
            ex.Message.ShouldContain("3");
        }

        await using var check = database.CreateContext();
        (await check.Users.CountAsync()).ShouldBe(4);
    }

    [SqlFact]
    public async Task Create_WithNoCap_IsNeverLimited()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SetCapAsync(database, null);
        await SeedUsersAsync(database, 6);

        await using var db = database.CreateContext(Shop);
        (await Create(db).Handle(NewUser("seventh"), CancellationToken.None)).Username.ShouldBe("seventh");
    }

    [SqlFact]
    public async Task Create_ForAShopWithNoSubscription_IsNeverLimited()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SeedUsersAsync(database, 3);

        await using var db = database.CreateContext(Shop);
        (await Create(db).Handle(NewUser("fourth"), CancellationToken.None)).Username.ShouldBe("fourth");
    }

    [SqlFact]
    public async Task Restore_AtTheCap_IsRefused_ButFitsOnceASeatIsFree()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SetCapAsync(database, 2);
        await SeedUsersAsync(database, 2);
        var gone = await SqlSeed.UserAsync(database, "gone", active: false);

        await using (var db = database.CreateContext(Shop))
        {
            var ex = await Should.ThrowAsync<ForbiddenActionException>(() => Restore(db).Handle(new RestoreUserCommand(gone.Id), CancellationToken.None));
            ex.Code.ShouldBe(UserSeatGuard.UserLimitCode);
        }

        await using (var seed = database.CreateContext())
        {
            (await seed.Users.FirstAsync(u => u.Username == "active0")).IsActive = false;
            await seed.SaveChangesAsync();
        }

        await using (var db = database.CreateContext(Shop))
        {
            (await Restore(db).Handle(new RestoreUserCommand(gone.Id), CancellationToken.None)).ShouldBeTrue();
        }

        await using var check = database.CreateContext();
        (await check.Users.SingleAsync(u => u.Id == gone.Id)).IsActive.ShouldBeTrue();
    }

    [SqlFact]
    public async Task Restore_OfAnAlreadyActiveUser_IsNotCountedAsANewSeat()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SetCapAsync(database, 2);
        await SeedUsersAsync(database, 2);
        var existing = await SqlSeed.UserAsync(database, "already", active: true);

        await using var db = database.CreateContext(Shop);
        (await Restore(db).Handle(new RestoreUserCommand(existing.Id), CancellationToken.None)).ShouldBeTrue();
    }

    [SqlFact]
    public async Task AfterADowngradeOverTheCap_ExistingUsersStayActive_AndTheSubscriptionReportsTheExcess()
    {
        await using var database = await SqlTestDatabase.CreateAsync();
        await SetCapAsync(database, null);
        await SeedUsersAsync(database, 5);
        await SetCapAsync(database, 3);

        await using var db = database.CreateContext(Shop);
        var dto = await new GetSubscriptionHandler(db, Shop, Substitute.For<ILeaseSigner>(), Options.Create(new SubscriptionOptions()), TimeProvider.System)
            .Handle(new GetSubscriptionQuery(), CancellationToken.None);

        dto.MaxUsers.ShouldBe(3);
        dto.ActiveUsers.ShouldBe(5);
        dto.UsersOverCap.ShouldBe(2);
        (await db.Users.CountAsync(u => u.IsActive)).ShouldBe(5);
        await Should.ThrowAsync<ForbiddenActionException>(() => Create(db).Handle(NewUser("sixth"), CancellationToken.None));
    }
}
