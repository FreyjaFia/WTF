using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Auth;
using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Common.Time;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Calculations.Orders;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record SeniorPwdIdCheckQuery(string IdNumber) : IRequest<SeniorPwdIdCheckDto>;

public class SeniorPwdIdCheckHandler(WTFDbContext db, IHttpContextAccessor httpContextAccessor)
    : IRequestHandler<SeniorPwdIdCheckQuery, SeniorPwdIdCheckDto>
{
    public async Task<SeniorPwdIdCheckDto> Handle(SeniorPwdIdCheckQuery request, CancellationToken cancellationToken)
    {
        if (!PermissionChecks.Has(httpContextAccessor.HttpContext?.User, PermissionKeys.OrdersSeniorPwdApply))
        {
            throw new ForbiddenActionException("You are not allowed to apply the Senior/PWD discount.");
        }

        var idNumber = SeniorPwdRules.NormalizeIdNumber(request.IdNumber);
        if (idNumber.Length == 0)
        {
            return new SeniorPwdIdCheckDto(false, null);
        }

        if (idNumber.Length > SeniorPwdOrders.MaxIdLength)
        {
            throw new InvalidOperationException($"The ID number is not valid ({SeniorPwdOrders.MaxIdLength} characters at most).");
        }

        var key = SeniorPwdRules.IdKey(idNumber);
        var startOfToday = RequestTimeZone.StartOfTodayUtc(RequestTimeZone.ResolveFromRequest(httpContextAccessor), DateTime.UtcNow);

        var lastOrderNumber = await db.OrderSeniorPwdDiscounts
            .AsNoTracking()
            .Where(s => s.CreatedAt >= startOfToday
                        && s.IdNumber.ToUpper().Replace(" ", "").Replace("-", "") == key
                        && s.Order.StatusId != (int)OrderStatusEnum.Cancelled
                        && s.Order.StatusId != (int)OrderStatusEnum.Refunded)
            .OrderByDescending(s => s.CreatedAt)
            .Select(s => (int?)s.Order.OrderNumber)
            .FirstOrDefaultAsync(cancellationToken);

        return new SeniorPwdIdCheckDto(lastOrderNumber.HasValue, lastOrderNumber);
    }
}
