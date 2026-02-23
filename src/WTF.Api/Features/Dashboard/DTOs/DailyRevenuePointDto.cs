namespace WTF.Api.Features.Dashboard.DTOs;

public record DailyRevenuePointDto(
    DateTime Date,
    decimal Revenue,
    int Orders,
    decimal Tips);
