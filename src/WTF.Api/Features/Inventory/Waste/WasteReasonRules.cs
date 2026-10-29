using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Inventory.Waste.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Inventory.Waste;

internal static class WasteReasonRules
{
    public const int MaxNameLength = 60;

    public static WasteReasonDto ToDto(WasteReason reason) =>
        new(reason.Id, reason.Name, reason.RequiresNote, reason.SortOrder, reason.IsActive, reason.IsSystem);

    public static async Task<string> ValidateNameAsync(
        WTFDbContext db,
        string? name,
        int? exceptId,
        CancellationToken cancellationToken)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new InvalidOperationException("Enter a name for the reason.");
        }

        if (trimmed.Length > MaxNameLength)
        {
            throw new InvalidOperationException($"The reason name can be at most {MaxNameLength} characters.");
        }

        var lower = trimmed.ToLower();
        var taken = await db.WasteReasons.AnyAsync(
            r => r.Name.ToLower() == lower && (exceptId == null || r.Id != exceptId),
            cancellationToken);
        if (taken)
        {
            throw new InvalidOperationException($"A reason named \"{trimmed}\" already exists.");
        }

        return trimmed;
    }
}
