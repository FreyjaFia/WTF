using WTF.Api.Features.Orders.Enums;

namespace WTF.Api.Features.Orders.DTOs;

public record SeniorPwdPersonRequestDto(SeniorPwdTypeEnum Type, string IdNumber, string CustomerName, bool IdChecked = false);
