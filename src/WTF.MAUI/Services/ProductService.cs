using System.Net.Http.Json;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Queries;

namespace WTF.MAUI.Services;

public interface IProductService
{
    Task<ProductListDto?> GetProductsAsync(GetProductsQuery query);
    Task<ProductDto?> GetProductByIdAsync(Guid id);
}

public class ProductService(HttpClient httpClient) : IProductService
{
    public async Task<ProductListDto?> GetProductsAsync(GetProductsQuery query)
    {
        try
        {
            var queryString = $"?Page={query.Page}&PageSize={query.PageSize}";
            
            if (!string.IsNullOrWhiteSpace(query.SearchTerm))
            {
                queryString += $"&SearchTerm={Uri.EscapeDataString(query.SearchTerm)}";
            }
            
            if (query.Type.HasValue)
            {
                queryString += $"&Type={query.Type.Value}";
            }
            
            if (query.IsAddOn.HasValue)
            {
                queryString += $"&IsAddOn={query.IsAddOn.Value}";
            }
            
            if (query.IsActive.HasValue)
            {
                queryString += $"&IsActive={query.IsActive.Value}";
            }

            return await httpClient.GetFromJsonAsync<ProductListDto>($"api/products{queryString}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error fetching products: {ex.Message}");
            return null;
        }
    }

    public async Task<ProductDto?> GetProductByIdAsync(Guid id)
    {
        try
        {
            return await httpClient.GetFromJsonAsync<ProductDto>($"api/products/{id}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error fetching product: {ex.Message}");
            return null;
        }
    }
}
