using MediatR;
using WTF.Api.Common.Orders;
using WTF.Api.Features.Orders.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record CreateOrderBatchCommand(List<CreateOrderCommand> Orders) : IRequest<List<OrderDto>>;

public class CreateOrderBatchHandler(WTFDbContext db, ISender sender)
    : IRequestHandler<CreateOrderBatchCommand, List<OrderDto>>
{
    public async Task<List<OrderDto>> Handle(CreateOrderBatchCommand request, CancellationToken cancellationToken)
    {
        if (request.Orders.Count == 0)
        {
            return [];
        }

        using var gate = await PromotionLimitGate.EnterAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var results = new List<OrderDto>(request.Orders.Count);

        foreach (var order in request.Orders)
        {
            var result = await sender.Send(order with { GateHeld = true, HonorStock = true }, cancellationToken);
            results.Add(result);
        }

        await transaction.CommitAsync(cancellationToken);

        return results;
    }
}
