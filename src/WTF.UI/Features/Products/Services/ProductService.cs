using System.Net.Http.Json;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Commands;
using WTF.Contracts.Products.Queries;

namespace WTF.UI.Features.Products.Services;

public interface IProductService
{
    Task<ProductListDto?> GetProductsAsync(GetProductsQuery query);
    Task<ProductDto?> GetProductByIdAsync(Guid id);
    Task<ProductDto?> CreateProductAsync(CreateProductCommand command);
    Task<ProductDto?> UpdateProductAsync(UpdateProductCommand command);
    Task<bool> DeleteProductAsync(Guid id);
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

    public async Task<ProductDto?> CreateProductAsync(CreateProductCommand command)
    {
        try
        {
            var response = await httpClient.PostAsJsonAsync("api/products", command);
            
            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadFromJsonAsync<ProductDto>();
            }

            Console.WriteLine($"Error creating product: {response.StatusCode}");
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error creating product: {ex.Message}");
            return null;
        }
    }

    public async Task<ProductDto?> UpdateProductAsync(UpdateProductCommand command)
    {
        try
        {
            var response = await httpClient.PutAsJsonAsync($"api/products/{command.Id}", command);
            
            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadFromJsonAsync<ProductDto>();
            }

            Console.WriteLine($"Error updating product: {response.StatusCode}");
            return null;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error updating product: {ex.Message}");
            return null;
        }
    }

    public async Task<bool> DeleteProductAsync(Guid id)
    {
        try
        {
            var response = await httpClient.DeleteAsync($"api/products/{id}");
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error deleting product: {ex.Message}");
            return false;
        }
    }
}
