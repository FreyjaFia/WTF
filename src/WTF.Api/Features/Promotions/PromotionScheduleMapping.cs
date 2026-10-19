using System.Globalization;
using WTF.Api.Features.Promotions.DTOs;
using WTF.Calculations.Orders;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Promotions;

internal static class PromotionScheduleMapping
{
    public const int MaxRedemptionsLimit = 1_000_000;

    private static readonly string[] TimeFormats = ["HH:mm", "HH:mm:ss"];

    public static void EnsureValid(PromotionScheduleRequest? request)
    {
        if (request is null)
        {
            return;
        }

        if (request.DaysOfWeek is { } days && (days < 1 || days > PromotionSchedule.EveryDay))
        {
            throw new InvalidOperationException("Pick at least one day, or leave the days empty for every day.");
        }

        var start = ParseTime(request.StartTime);
        var end = ParseTime(request.EndTime);
        if (start.HasValue != end.HasValue)
        {
            throw new InvalidOperationException("Set both a start time and an end time, or neither.");
        }

        if (start.HasValue && start == end)
        {
            throw new InvalidOperationException("The start time and the end time cannot be the same.");
        }

        if (request.MaxRedemptions is { } max && (max < 1 || max > MaxRedemptionsLimit))
        {
            throw new InvalidOperationException($"The usage limit must be between 1 and {MaxRedemptionsLimit:N0}.");
        }

        if (request.MaxPerOrder is { } perOrder && (perOrder < 1 || perOrder > MaxRedemptionsLimit))
        {
            throw new InvalidOperationException($"The limit per order must be between 1 and {MaxRedemptionsLimit:N0}.");
        }
    }

    // A request without a schedule leaves the promotion as it is; one with empty fields clears it.
    public static void Apply(Promotion promotion, PromotionScheduleRequest? request)
    {
        if (request is null)
        {
            return;
        }

        promotion.DaysOfWeek = request.DaysOfWeek is null or PromotionSchedule.EveryDay ? null : request.DaysOfWeek;
        promotion.StartTime = ParseTime(request.StartTime);
        promotion.EndTime = ParseTime(request.EndTime);
        promotion.MaxRedemptions = request.MaxRedemptions;
        promotion.MaxPerOrder = request.MaxPerOrder;
    }

    public static PromotionScheduleDto ToDto(Promotion promotion, int redemptions)
    {
        return new PromotionScheduleDto(
            promotion.DaysOfWeek,
            promotion.StartTime?.ToString("HH:mm", CultureInfo.InvariantCulture),
            promotion.EndTime?.ToString("HH:mm", CultureInfo.InvariantCulture),
            promotion.MaxRedemptions,
            redemptions,
            promotion.MaxPerOrder);
    }

    private static TimeOnly? ParseTime(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        if (TimeOnly.TryParseExact(text.Trim(), TimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
        {
            return time;
        }

        throw new InvalidOperationException("Times must look like 14:30.");
    }
}
