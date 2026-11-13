namespace WTF.Domain.Entities;

// Kept outside the scaffolded Product.cs so a rescaffold does not lose it: a new product can take the Senior/PWD discount
// unless its owner switches that off.
public partial class Product
{
    public Product()
    {
        IsSeniorPwdEligible = true;
    }
}
