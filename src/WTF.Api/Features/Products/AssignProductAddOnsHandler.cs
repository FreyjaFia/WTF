using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Contracts.Products.Commands;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Products;

public class AssignProductAddOnsHandler(WTFDbContext db) : IRequestHandler<AssignProductAddOnsCommand, bool>
{
    public async Task<bool> Handle(AssignProductAddOnsCommand request, CancellationToken cancellationToken)
    {
        var product = await db.Products
            .Include(p => p.AddOns)
            .FirstOrDefaultAsync(p => p.Id == request.ProductId, cancellationToken);

        if (product == null)
        {
            return false;
        }

        if (product.IsAddOn)
        {
            throw new InvalidOperationException("Cannot assign add-ons to a product that is itself an add-on.");
        }

        // Validate all add-on IDs exist and are marked as add-ons
        var addOns = await db.Products
            .Where(p => request.AddOnIds.Contains(p.Id))
            .ToListAsync(cancellationToken);

        if (addOns.Count != request.AddOnIds.Count)
        {
            throw new InvalidOperationException("One or more add-on IDs are invalid.");
        }

        var nonAddOns = addOns.Where(p => !p.IsAddOn).ToList();
        if (nonAddOns.Count != 0)
        {
            throw new InvalidOperationException(
                $"The following products are not marked as add-ons: {string.Join(", ", nonAddOns.Select(p => p.Name))}");
        }

        // Clear existing add-ons
        product.AddOns.Clear();

        // Assign new add-ons
        foreach (var addOn in addOns)
        {
            product.AddOns.Add(addOn);
        }

        await db.SaveChangesAsync(cancellationToken);

        return true;
    }
}
