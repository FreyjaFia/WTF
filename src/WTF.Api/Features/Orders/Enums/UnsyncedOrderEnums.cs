namespace WTF.Api.Features.Orders.Enums;

public enum UnsyncedOrderStatusEnum : byte
{
    Open = 1,
    Resolved = 2
}

public enum UnsyncedOrderResolutionEnum : byte
{
    Retried = 1,
    NoteOnly = 2,
    Discarded = 3
}
