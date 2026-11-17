using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Features.Branches.Enums;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Subscriptions;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Branches;

public static class BranchRules
{
    public const string BranchLimitCode = "plan_branch_limit";
    public const int NameMaxLength = 100;
    public const int AddressMaxLength = 300;
    public const int PhoneMaxLength = 30;

    public static readonly int[] OpenOrderStatuses = [(int)OrderStatusEnum.Pending, (int)OrderStatusEnum.PendingApproval, (int)OrderStatusEnum.PendingReview];

    // Every branch of the shop, whatever the branch the person is working in, so management screens and checks see the whole shop.
    public static IQueryable<Branch> AllOfShop(WTFDbContext db)
    {
        return db.Branches.IgnoreQueryFilters([WTFDbContext.BranchFilterName]);
    }

    public static IQueryable<Order> AllOrdersOfShop(WTFDbContext db)
    {
        return db.Orders.IgnoreQueryFilters([WTFDbContext.BranchFilterName]);
    }

    public static (string Name, string Code, string? Address, string? Phone) Validate(string? name, string? code, string? address, string? phone)
    {
        var cleanName = (name ?? string.Empty).Trim();
        if (cleanName.Length is 0 or > NameMaxLength)
        {
            throw new InvalidOperationException($"Branch name is required ({NameMaxLength} characters at most).");
        }

        var cleanCode = BranchCodes.Normalize(code);
        if (!BranchCodes.IsValid(cleanCode))
        {
            throw new InvalidOperationException("Branch code is required: 2 to 5 letters or numbers.");
        }

        var cleanAddress = string.IsNullOrWhiteSpace(address) ? null : address.Trim();
        if (cleanAddress is { Length: > AddressMaxLength })
        {
            throw new InvalidOperationException($"Address must be {AddressMaxLength} characters or fewer.");
        }

        var cleanPhone = string.IsNullOrWhiteSpace(phone) ? null : phone.Trim();
        if (cleanPhone is { Length: > PhoneMaxLength })
        {
            throw new InvalidOperationException($"Phone must be {PhoneMaxLength} characters or fewer.");
        }

        return (cleanName, cleanCode, cleanAddress, cleanPhone);
    }

    public static async Task EnsureCodeFreeAsync(WTFDbContext db, string code, Guid? exceptId, CancellationToken cancellationToken)
    {
        if (await AllOfShop(db).AnyAsync(b => b.Code == code && b.Id != exceptId, cancellationToken))
        {
            throw new InvalidOperationException("Another branch already uses that code.");
        }
    }

    public static async Task<int?> MaxBranchesAsync(WTFDbContext db, ICurrentTenant currentTenant, CancellationToken cancellationToken)
    {
        if (!currentTenant.FilterEnabled || currentTenant.TenantId is not { } tenantId)
        {
            return null;
        }

        return await db.TenantSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId)
            .Select(s => s.Plan.MaxBranches)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public static async Task EnsureCanAddBranchAsync(WTFDbContext db, ICurrentTenant currentTenant, CancellationToken cancellationToken)
    {
        var max = await MaxBranchesAsync(db, currentTenant, cancellationToken);
        if (max is null)
        {
            return;
        }

        var active = await AllOfShop(db).CountAsync(b => b.IsActive, cancellationToken);
        if (!BranchCapRules.CanAddBranch(active, max))
        {
            throw new ForbiddenActionException($"Your plan allows {max} {(max == 1 ? "branch" : "branches")}. Close a branch or move to a bigger plan to add more.", BranchLimitCode);
        }
    }

    public static bool IsLimited(ICurrentBranch branch) => branch.WriteCheckEnabled;

    public static BranchScopeEnum ScopeOf(User user) => (BranchScopeEnum)user.BranchScope;
}
