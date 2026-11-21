using WTF.Calculations.Catalog;

namespace WTF.Tests.Calculations;

public class ProductAvailabilityTests
{
    private static readonly Guid Makati = Guid.NewGuid();
    private static readonly Guid Cebu = Guid.NewGuid();
    private static readonly Guid Bgc = Guid.NewGuid();

    [Fact]
    public void AProductWithNoRows_IsSoldAtEveryBranch_EvenOnesOpenedLater()
    {
        ProductAvailability.IsSoldAt([], Makati).ShouldBeTrue();
        ProductAvailability.IsSoldAt([], Guid.NewGuid()).ShouldBeTrue();
    }

    [Fact]
    public void AProductWithRows_IsSoldOnlyAtThoseBranches()
    {
        ProductAvailability.IsSoldAt([Cebu], Cebu).ShouldBeTrue();
        ProductAvailability.IsSoldAt([Cebu], Makati).ShouldBeFalse();
    }

    [Fact]
    public void ABranchOnlyProduct_IsOneBranch()
    {
        ProductAvailability.IsBranchOnly([Cebu]).ShouldBeTrue();
        ProductAvailability.IsBranchOnly([Cebu, Bgc]).ShouldBeFalse();
        ProductAvailability.IsBranchOnly([]).ShouldBeFalse();
    }

    [Fact]
    public void ABranchManager_MayChangeOnlyProductsLimitedToTheirBranches()
    {
        ProductAvailability.MayBranchEdit([], [Cebu]).ShouldBeFalse();
        ProductAvailability.MayBranchEdit([Cebu], [Cebu]).ShouldBeTrue();
        ProductAvailability.MayBranchEdit([Cebu, Bgc], [Cebu]).ShouldBeFalse();
        ProductAvailability.MayBranchEdit([Cebu, Bgc], [Cebu, Bgc]).ShouldBeTrue();
    }
}
