using System.ComponentModel.DataAnnotations.Schema;

namespace WTF.Domain.Entities;

public partial class Order
{
    // The prices this order's branch sets for products that have their own price there. Filled by whoever loads the order to
    // price it (BranchPriceLookup); never saved. Empty means every product costs its shop price.
    [NotMapped]
    public IReadOnlyDictionary<Guid, decimal>? BranchPrices { get; set; }

    public decimal ListPriceOf(Product product) =>
        BranchPrices is not null && BranchPrices.TryGetValue(product.Id, out var branchPrice) ? branchPrice : product.Price;
}
