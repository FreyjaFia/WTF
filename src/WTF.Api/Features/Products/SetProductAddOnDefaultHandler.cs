using MediatR;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using WTF.Domain.Data;

namespace WTF.Api.Features.Products;

public record SetProductAddOnDefaultCommand : IRequest<bool>
{
    [Required] public Guid ProductId { get; init; }
    [Required] public Guid AddOnId { get; init; }
    public bool IsDefault { get; init; }
}

public class SetProductAddOnDefaultHandler(WTFDbContext db) : IRequestHandler<SetProductAddOnDefaultCommand, bool>
{
    public async Task<bool> Handle(SetProductAddOnDefaultCommand request, CancellationToken cancellationToken)
    {
        var links = await db.ProductAddOns
            .Include(pa => pa.AddOnType)
            .Where(pa => pa.ProductId == request.ProductId && pa.IsActive)
            .ToListAsync(cancellationToken);

        var link = links.FirstOrDefault(pa => pa.AddOnId == request.AddOnId);
        if (link is null)
        {
            return false;
        }

        if (!request.IsDefault)
        {
            link.IsDefault = false;
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        if (link.AddOnType is null || !link.AddOnType.IsRequired)
        {
            throw new InvalidOperationException("Only an option of a required add-on type can be pre-selected.");
        }

        foreach (var sibling in links.Where(pa => pa.AddOnTypeId == link.AddOnTypeId))
        {
            sibling.IsDefault = sibling.AddOnId == request.AddOnId;
        }

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }
}
