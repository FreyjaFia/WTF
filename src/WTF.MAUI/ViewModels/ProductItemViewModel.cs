using WTF.Contracts.Products;
using WTF.Contracts.Products.Enums;

namespace WTF.MAUI.ViewModels;

public class ProductItemViewModel
{
    public ProductItemViewModel(ProductDto product)
    {
        Product = product ?? throw new ArgumentNullException(nameof(product));
    }

    public ProductDto Product { get; }

    // Convenience properties for XAML bindings to avoid converters
    public Guid Id => Product.Id;
    public string Name => Product.Name;

    // Use ImageUrl (absolute URL provided by API)
    public string? ImageUrl => Product.ImageUrl;

    public bool HasImage => !string.IsNullOrWhiteSpace(ImageUrl);
    public string DisplayType => Product.DisplayType;
    public string FormattedPrice => Product.FormattedPrice;

    // Map product type to a Material icon string to avoid ProductTypeIconConverter
    public string TypeIcon
    {
        get
        {
            return Product.Type switch
            {
                ProductTypeEnum.Drink => "\ue55b", // example icon
                ProductTypeEnum.Food => "\ue56c",
                ProductTypeEnum.Dessert => "\ue57a",
                _ => "\ue90d",
            };
        }
    }
}
