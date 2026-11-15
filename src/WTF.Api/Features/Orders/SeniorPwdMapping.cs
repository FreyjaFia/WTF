using WTF.Api.Common.Auth.Permissions;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Orders;

internal static class SeniorPwdMapping
{
    public static string MaskId(string idNumber)
    {
        var visible = Math.Min(4, Math.Max(0, idNumber.Length - 4));
        return new string('*', idNumber.Length - visible) + idNumber[^visible..];
    }

    public static List<OrderSeniorPwdDto>? ToDtos(IEnumerable<OrderSeniorPwdDiscount> rows, bool mask)
    {
        var list = rows
            .OrderBy(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .Select(r => new OrderSeniorPwdDto(
                r.Id,
                (SeniorPwdTypeEnum)r.Type,
                mask ? MaskId(r.IdNumber) : r.IdNumber,
                r.CustomerName,
                r.CoveredAmount,
                r.VatExemptAmount,
                r.DiscountAmount))
            .ToList();
        return list.Count == 0 ? null : list;
    }

    public static bool CanSeeFullId(IHttpContextAccessor? httpContextAccessor)
    {
        var user = httpContextAccessor?.HttpContext?.User;
        return PermissionChecks.HasAny(user, [PermissionKeys.OrdersSeniorPwdApply, PermissionKeys.OrdersOverride]);
    }
}
