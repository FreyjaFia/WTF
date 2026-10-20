using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Extensions;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Inventory.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory;

public record GetItemAlertRecipientsQuery(Guid ItemId) : IRequest<ItemAlertRecipientsDto?>;

public record SetItemAlertRecipientsCommand(Guid ItemId, List<Guid> UserIds) : IRequest<ItemAlertRecipientsDto?>;

internal static class AlertRecipientCandidates
{
    // The people who can read stock notifications; only they can be told about an item.
    public static readonly string[] Roles = [AppRoles.SuperAdmin, AppRoles.Admin, AppRoles.AdminViewer, AppRoles.StockManager];

    public const string DefaultDescription = "Super Admins, Admins and Stock Managers";

    public static async Task<List<AlertRecipientDto>> LoadAsync(WTFDbContext db, CancellationToken cancellationToken)
    {
        var users = await db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && Roles.Contains(u.Role.Name))
            .OrderBy(u => u.FirstName)
            .ThenBy(u => u.LastName)
            .Select(u => new { u.Id, u.FirstName, u.LastName, Role = u.Role.Name })
            .ToListAsync(cancellationToken);

        return users.Select(u => new AlertRecipientDto(u.Id, $"{u.FirstName} {u.LastName}".Trim(), u.Role)).ToList();
    }
}

public class GetItemAlertRecipientsHandler(WTFDbContext db)
    : IRequestHandler<GetItemAlertRecipientsQuery, ItemAlertRecipientsDto?>
{
    public async Task<ItemAlertRecipientsDto?> Handle(GetItemAlertRecipientsQuery request, CancellationToken cancellationToken)
    {
        if (!await db.Items.AnyAsync(i => i.Id == request.ItemId, cancellationToken))
        {
            return null;
        }

        return await BuildAsync(db, request.ItemId, cancellationToken);
    }

    internal static async Task<ItemAlertRecipientsDto> BuildAsync(WTFDbContext db, Guid itemId, CancellationToken cancellationToken)
    {
        var selected = await db.ItemAlertRecipients
            .AsNoTracking()
            .Where(r => r.ItemId == itemId && r.IsActive && r.User.IsActive)
            .Select(r => r.UserId)
            .ToListAsync(cancellationToken);

        return new ItemAlertRecipientsDto(
            selected,
            await AlertRecipientCandidates.LoadAsync(db, cancellationToken),
            AlertRecipientCandidates.DefaultDescription);
    }
}

public class SetItemAlertRecipientsHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService) : IRequestHandler<SetItemAlertRecipientsCommand, ItemAlertRecipientsDto?>
{
    public async Task<ItemAlertRecipientsDto?> Handle(SetItemAlertRecipientsCommand request, CancellationToken cancellationToken)
    {
        var item = await db.Items.AsNoTracking().FirstOrDefaultAsync(i => i.Id == request.ItemId, cancellationToken);
        if (item is null)
        {
            return null;
        }

        var wanted = request.UserIds.Distinct().ToList();
        var candidates = await AlertRecipientCandidates.LoadAsync(db, cancellationToken);
        var allowed = candidates.Select(c => c.UserId).ToHashSet();
        if (wanted.Any(id => !allowed.Contains(id)))
        {
            throw new InvalidOperationException("Only active Super Admins, Admins, Admin Viewers and Stock Managers can receive stock alerts.");
        }

        var userId = httpContextAccessor.HttpContext!.User.GetUserId();
        var existing = await db.ItemAlertRecipients.Where(r => r.ItemId == item.Id).ToListAsync(cancellationToken);
        var before = existing.Where(r => r.IsActive).Select(r => r.UserId).OrderBy(id => id).ToList();

        foreach (var row in existing)
        {
            row.IsActive = wanted.Contains(row.UserId);
        }

        foreach (var id in wanted.Where(id => existing.All(r => r.UserId != id)))
        {
            db.ItemAlertRecipients.Add(new ItemAlertRecipient
            {
                ItemId = item.Id,
                UserId = id,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                CreatedBy = userId
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ItemAlertRecipientsUpdated,
            AuditEntityType.Item,
            item.Id.ToString(),
            oldValues: new { UserIds = before },
            newValues: new { UserIds = wanted.OrderBy(id => id).ToList() },
            userId: userId,
            cancellationToken: cancellationToken);

        return await GetItemAlertRecipientsHandler.BuildAsync(db, item.Id, cancellationToken);
    }
}
