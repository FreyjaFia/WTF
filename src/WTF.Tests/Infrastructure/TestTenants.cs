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

        return services.AddScoped(_ => TestDb.Create(name));
    }
}
