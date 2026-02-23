namespace WTF.Api.Features.Dashboard.DTOs;

public record HourlyRevenuePointDto(
    int Hour,
    decimal Revenue,
    int Orders,
    decimal Tips);
