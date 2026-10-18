namespace WTF.Calculations.Sales;

/// <summary>
/// The ids stored in <c>Orders.StatusId</c>. The API's <c>OrderStatusEnum</c> uses the same values; a test keeps the two
/// from drifting.
/// </summary>
public static class OrderStatuses
{
    public const int Pending = 1;
    public const int Completed = 2;
    public const int Cancelled = 3;
    public const int Refunded = 4;
    public const int PendingApproval = 5;
    public const int PendingReview = 6;

    public static readonly int[] Unconfirmed = [PendingApproval, PendingReview];
}
