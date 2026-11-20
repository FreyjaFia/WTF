using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Tenancy;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Branches.DTOs;
using WTF.Api.Features.Inventory;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;

namespace WTF.Api.Features.Branches;

public record BranchRequest(string Name, string Code, string? Address, string? Phone);

public record CreateBranchCommand(string Name, string Code, string? Address, string? Phone) : IRequest<BranchDto>;

public record UpdateBranchCommand(Guid Id, string Name, string Code, string? Address, string? Phone) : IRequest<BranchDto?>;

public class CreateBranchHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    ICurrentTenant currentTenant,
    ICurrentBranch currentBranch,
    BranchScopeCache cache) : IRequestHandler<CreateBranchCommand, BranchDto>
{
    public async Task<BranchDto> Handle(CreateBranchCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var (name, code, address, phone) = BranchRules.Validate(request.Name, request.Code, request.Address, request.Phone);
        await BranchRules.EnsureCodeFreeAsync(db, code, null, cancellationToken);
        await BranchRules.EnsureCanAddBranchAsync(db, currentTenant, cancellationToken);

        var branch = new Branch
        {
            Id = Guid.NewGuid(),
            Name = name,
            Code = code,
            Address = address,
            Phone = phone,
            TimeZone = "Asia/Manila",
            IsActive = true,
            IsMain = false,
            CreatedAt = DateTime.UtcNow,
            CreatedBy = userId
        };

        db.Branches.Add(branch);

        // Someone limited to selected branches who opens a new one can use it at once. Everyone else stays where they are (ON-4).
        if (BranchRules.IsLimited(currentBranch))
        {
            db.UserBranches.Add(new UserBranch { UserId = userId, BranchId = branch.Id, CreatedAt = DateTime.UtcNow });
        }

        await db.SaveChangesAsync(cancellationToken);
        await StockBranchRows.AddBranchAsync(db, branch.Id, cancellationToken);
        cache.Forget();

        await auditService.LogAsync(
            AuditAction.BranchCreated,
            AuditEntityType.Branch,
            branch.Id.ToString(),
            newValues: new { branch.Name, branch.Code, branch.Address, branch.Phone },
            userId: userId,
            cancellationToken: cancellationToken);

        return new BranchDto(branch.Id, branch.Name, branch.Code, branch.Address, branch.Phone, true, false, 0, 0, branch.CreatedAt);
    }
}

public class UpdateBranchHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    ICurrentBranch currentBranch,
    BranchScopeCache cache) : IRequestHandler<UpdateBranchCommand, BranchDto?>
{
    public async Task<BranchDto?> Handle(UpdateBranchCommand request, CancellationToken cancellationToken)
    {
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var (name, code, address, phone) = BranchRules.Validate(request.Name, request.Code, request.Address, request.Phone);

        var branch = await BranchRules.AllOfShop(db).FirstOrDefaultAsync(b => b.Id == request.Id, cancellationToken);
        if (branch is null || (BranchRules.IsLimited(currentBranch) && !currentBranch.AllowedBranchIds.Contains(branch.Id)))
        {
            return null;
        }

        await BranchRules.EnsureCodeFreeAsync(db, code, branch.Id, cancellationToken);

        var before = new { branch.Name, branch.Code, branch.Address, branch.Phone };
        branch.Name = name;
        branch.Code = code;
        branch.Address = address;
        branch.Phone = phone;
        branch.UpdatedAt = DateTime.UtcNow;
        branch.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);
        cache.Forget();

        await auditService.LogAsync(
            AuditAction.BranchUpdated,
            AuditEntityType.Branch,
            branch.Id.ToString(),
            oldValues: before,
            newValues: new { branch.Name, branch.Code, branch.Address, branch.Phone },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await BranchQueries.ListAsync(db, currentBranch, null, null, branch.Id, cancellationToken)).First();
    }
}
