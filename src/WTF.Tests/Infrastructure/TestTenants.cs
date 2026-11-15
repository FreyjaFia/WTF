using Microsoft.Extensions.DependencyInjection;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Tests.Infrastructure;

public static class TestTenants
{
    public static IServiceCollection AddDefaultTenant(this IServiceCollection services)
    {
        var name = TestDb.NewName();
        TestDb.SaveAsync(name, new Tenant
        {
            Id = TenantDefaults.DefaultTenantId,
            Name = "WTF",
            Slug = "wtf",
            Status = 2,
            CreatedAt = DateTime.UtcNow,
        }).GetAwaiter().GetResult();

        services.AddSingleton(TestFakes.Features);
        return services.AddScoped(_ => TestDb.Create(name));
    }
}

internal sealed class FixedTenant(Guid? id) : ICurrentTenant
{
    public bool FilterEnabled => true;

    public Guid? TenantId => id;

    public Guid? StampTenantId => id;
}

internal sealed class SwitchableTenant : ICurrentTenant, ITenantSwitch
{
    private Guid? _id;

    public bool FilterEnabled => true;

    public Guid? TenantId => _id;

    public Guid? StampTenantId => _id;

    public void Use(Guid tenantId) => _id = tenantId;
}
