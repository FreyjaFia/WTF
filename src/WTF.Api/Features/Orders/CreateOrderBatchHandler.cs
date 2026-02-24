using MediatR;
using Microsoft.EntityFrameworkCore;
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

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var results = new List<OrderDto>(request.Orders.Count);

        foreach (var order in request.Orders)
        {
            var result = await sender.Send(order, cancellationToken);
            results.Add(result);
        }

        await transaction.CommitAsync(cancellationToken);

        return results;
    }
}
