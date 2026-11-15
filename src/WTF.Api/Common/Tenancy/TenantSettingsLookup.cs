using Microsoft.EntityFrameworkCore;
using WTF.Domain.Data;

namespace WTF.Api.Common.Tenancy;

public record SeniorPwdSettings(bool Enabled, bool VatRegistered);

public static class TenantSettingsLookup
{
    public static async Task<SeniorPwdSettings> LoadSeniorPwdAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        var settings = await db.TenantSettings
            .AsNoTracking()
            .Select(s => new SeniorPwdSettings(s.SeniorPwdEnabled, s.VatRegistered))
            .FirstOrDefaultAsync(cancellationToken);

        return settings ?? new SeniorPwdSettings(false, false);
    }
}
