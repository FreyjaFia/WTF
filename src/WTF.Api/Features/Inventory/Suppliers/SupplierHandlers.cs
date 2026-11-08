using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Suppliers;

public record GetSuppliersQuery(bool IncludeInactive = false, string? Search = null) : IRequest<List<SupplierSummaryDto>>;

public record GetSupplierQuery(Guid Id) : IRequest<SupplierDto?>;

public record CreateSupplierCommand(SupplierFields Fields) : IRequest<SupplierDto>;

public record UpdateSupplierCommand(Guid Id, SupplierFields Fields) : IRequest<SupplierDto?>;

public record SetSupplierActiveCommand(Guid Id, bool IsActive) : IRequest<SupplierDto?>;

public class GetSuppliersHandler(WTFDbContext db) : IRequestHandler<GetSuppliersQuery, List<SupplierSummaryDto>>
{
    public async Task<List<SupplierSummaryDto>> Handle(GetSuppliersQuery request, CancellationToken cancellationToken)
    {
        var query = db.Suppliers.AsNoTracking();
        if (!request.IncludeInactive)
        {
            query = query.Where(s => s.IsActive);
        }

        var search = request.Search?.Trim();
        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(s => s.Name.Contains(search) || (s.ContactName != null && s.ContactName.Contains(search)));
        }

        var rows = await query
            .OrderBy(s => s.Name)
            .Select(s => new { Supplier = s, ItemCount = s.ItemSuppliers.Count })
            .ToListAsync(cancellationToken);

        return [.. rows.Select(r => SupplierRules.ToSummary(r.Supplier, r.ItemCount))];
    }
}

public class GetSupplierHandler(WTFDbContext db) : IRequestHandler<GetSupplierQuery, SupplierDto?>
{
    public Task<SupplierDto?> Handle(GetSupplierQuery request, CancellationToken cancellationToken) =>
        SupplierRules.LoadAsync(db, request.Id, cancellationToken);
}

public class CreateSupplierHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<CreateSupplierCommand, SupplierDto>
{
    public async Task<SupplierDto> Handle(CreateSupplierCommand request, CancellationToken cancellationToken)
    {
        var name = await SupplierRules.ValidateAsync(db, request.Fields, null, cancellationToken);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var supplier = new Supplier { IsActive = true, CreatedAt = DateTime.UtcNow, CreatedBy = userId };
        SupplierRules.Apply(supplier, request.Fields, name);

        db.Suppliers.Add(supplier);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.SupplierCreated,
            AuditEntityType.Supplier,
            supplier.Id.ToString(),
            newValues: new { supplier.Name, supplier.LeadTimeDays, supplier.PaymentTerms },
            userId: userId,
            cancellationToken: cancellationToken);

        return (await SupplierRules.LoadAsync(db, supplier.Id, cancellationToken))!;
    }
}

public class UpdateSupplierHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<UpdateSupplierCommand, SupplierDto?>
{
    public async Task<SupplierDto?> Handle(UpdateSupplierCommand request, CancellationToken cancellationToken)
    {
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == request.Id, cancellationToken);
        if (supplier is null)
        {
            return null;
        }

        var name = await SupplierRules.ValidateAsync(db, request.Fields, supplier.Id, cancellationToken);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var oldValues = new { supplier.Name, supplier.LeadTimeDays, supplier.PaymentTerms };

        SupplierRules.Apply(supplier, request.Fields, name);
        supplier.UpdatedAt = DateTime.UtcNow;
        supplier.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.SupplierUpdated,
            AuditEntityType.Supplier,
            supplier.Id.ToString(),
            oldValues: oldValues,
            newValues: new { supplier.Name, supplier.LeadTimeDays, supplier.PaymentTerms },
            userId: userId,
            cancellationToken: cancellationToken);

        return await SupplierRules.LoadAsync(db, supplier.Id, cancellationToken);
    }
}

public class SetSupplierActiveHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetSupplierActiveCommand, SupplierDto?>
{
    public async Task<SupplierDto?> Handle(SetSupplierActiveCommand request, CancellationToken cancellationToken)
    {
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == request.Id, cancellationToken);
        if (supplier is null)
        {
            return null;
        }

        if (supplier.IsActive != request.IsActive)
        {
            var userId = httpContextAccessor.HttpContext!.User.GetUserId();
            supplier.IsActive = request.IsActive;
            supplier.UpdatedAt = DateTime.UtcNow;
            supplier.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);

            await auditService.LogAsync(
                request.IsActive ? AuditAction.SupplierRestored : AuditAction.SupplierDeactivated,
                AuditEntityType.Supplier,
                supplier.Id.ToString(),
                newValues: new { supplier.Name },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return await SupplierRules.LoadAsync(db, supplier.Id, cancellationToken);
    }
}
