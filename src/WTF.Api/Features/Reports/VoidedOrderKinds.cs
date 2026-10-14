using WTF.Api.Features.OrderLinks;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Reports;

internal static class VoidedOrderKinds
{
    public const string Refunded = "Refunded";
    public const string Rejected = "Rejected";
    public const string Cancelled = "Cancelled";

    public static string For(Order order)
    {
        if (order.StatusId == OrderStatuses.Refunded)
        {
            return Refunded;
        }

        return string.IsNullOrWhiteSpace(order.RejectionReason) ? Cancelled : Rejected;
    }

    public static string? ReasonFor(Order order)
    {
        var reason = For(order) == Rejected ? order.RejectionReason : order.Note;
        return string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
    }

    public static string? VoidedByName(Order order)
    {
        var user = order.UpdatedByNavigation;
        if (user is null)
        {
            return null;
        }

        return user.Username == SubmitPublicOrderHandler.SystemUsername ? null : $"{user.FirstName} {user.LastName}".Trim();
    }
}
