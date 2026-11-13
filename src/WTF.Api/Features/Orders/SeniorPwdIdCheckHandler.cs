using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record SeniorPwdIdCheckQuery(string IdNumber) : IRequest<SeniorPwdIdCheckDto>;

public class SeniorPwdIdCheckHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<SeniorPwdIdCheckQuery, SeniorPwdIdCheckDto>
{
    public async Task<SeniorPwdIdCheckDto> Handle(SeniorPwdIdCheckQuery request, CancellationToken cancellationToken)
    {
        var idNumber = request.IdNumber?.Trim() ?? string.Empty;
        if (idNumber.Length == 0)
        {
            return new SeniorPwdIdCheckDto(false, null);
        }

        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var localToday = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, timeZone).Date;
        var startOfToday = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(localToday, DateTimeKind.Unspecified), timeZone);

        var lastOrderNumber = await db.OrderSeniorPwdDiscounts
            .AsNoTracking()
            .Where(s => s.IdNumber == idNumber
                        && s.CreatedAt >= startOfToday
                        && s.Order.StatusId != (int)OrderStatusEnum.Cancelled
                        && s.Order.StatusId != (int)OrderStatusEnum.Refunded)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => (int?)s.Order.OrderNumber)
            .FirstOrDefaultAsync(cancellationToken);

        return new SeniorPwdIdCheckDto(lastOrderNumber.HasValue, lastOrderNumber);
    }
}
