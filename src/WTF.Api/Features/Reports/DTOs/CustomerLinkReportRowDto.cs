namespace WTF.Api.Features.Reports.DTOs;

public sealed record CustomerLinkReportRowDto(
    Guid? LinkId,
    string CustomerName,
    int OrderCount,
    int AcceptedCount,
    int RejectedCount,
    int AwaitingCount,
    int PickupCount,
    int DeliveryCount,
    decimal Revenue,
    double? AverageMinutesToAccept,
    double? AverageMinutesToReady,
    string? RejectionReasons
);
