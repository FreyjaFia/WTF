namespace WTF.Api.Features.Dashboard.DTOs;

public record OrdersByStatusDto(
    int Pending,
    int Completed,
    int Cancelled,
    int Refunded);
