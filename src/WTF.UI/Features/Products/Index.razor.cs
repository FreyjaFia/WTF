using Microsoft.AspNetCore.Components;
using WTF.Contracts.Products;
using WTF.Contracts.Products.Commands;
using WTF.Contracts.Products.Enums;
using WTF.Contracts.Products.Queries;
using WTF.UI.Features.Products.Services;

namespace WTF.UI.Features.Products;

public partial class Index : ComponentBase
{
    [Inject] private IProductService ProductService { get; set; } = default!;

    private ProductListDto? productList;
    private bool isLoading = true;
    private string? errorMessage;
    private string? successMessage;

    // Filters
    private string searchTerm = string.Empty;
    private string selectedType = string.Empty;
    private string selectedIsAddOn = string.Empty;
    private string selectedIsActive = "true";

    // Pagination
    private int currentPage = 1;
    private int pageSize = 10;

    // Modal states
    private bool showModal = false;
    private bool showDeleteConfirm = false;
    private bool isSaving = false;
    private bool isDeleting = false;

    // Editing/Deleting
    private ProductDto? editingProduct = null;
    private ProductDto? deletingProduct = null;
    private ProductRequestDto productForm = new();

    protected override async Task OnInitializedAsync()
    {
        await LoadProductsAsync();
    }

    private async Task LoadProductsAsync()
    {
        isLoading = true;
        errorMessage = null;
        successMessage = null;
        StateHasChanged();

        try
        {
            var query = new GetProductsQuery
            {
                Page = currentPage,
                PageSize = pageSize,
                SearchTerm = string.IsNullOrWhiteSpace(searchTerm) ? null : searchTerm,
                Type = string.IsNullOrWhiteSpace(selectedType) ? null : (ProductTypeEnum)int.Parse(selectedType),
                IsAddOn = string.IsNullOrWhiteSpace(selectedIsAddOn) ? null : bool.Parse(selectedIsAddOn),
                IsActive = string.IsNullOrWhiteSpace(selectedIsActive) ? null : bool.Parse(selectedIsActive)
            };

            productList = await ProductService.GetProductsAsync(query);

            if (productList == null)
            {
                errorMessage = "Failed to load products. Please try again.";
            }
        }
        catch (Exception ex)
        {
            errorMessage = $"Error: {ex.Message}";
            Console.WriteLine($"Error loading products: {ex}");
        }
        finally
        {
            isLoading = false;
            StateHasChanged();
        }
    }

    private async Task ApplyFilters()
    {
        currentPage = 1;
        await LoadProductsAsync();
    }

    private async Task ResetFilters()
    {
        searchTerm = string.Empty;
        selectedType = string.Empty;
        selectedIsAddOn = string.Empty;
        selectedIsActive = "true";
        currentPage = 1;
        await LoadProductsAsync();
    }

    private async Task PreviousPage()
    {
        if (productList?.HasPrevious == true)
        {
            currentPage--;
            await LoadProductsAsync();
        }
    }

    private async Task NextPage()
    {
        if (productList?.HasNext == true)
        {
            currentPage++;
            await LoadProductsAsync();
        }
    }

    private void ShowCreateModal()
    {
        editingProduct = null;
        productForm = new ProductRequestDto
        {
            Name = string.Empty,
            Price = 0,
            Type = ProductTypeEnum.Drink,
            IsAddOn = false,
            IsActive = true
        };
        errorMessage = null;
        successMessage = null;
        showModal = true;
    }

    private void ShowEditModal(ProductDto product)
    {
        editingProduct = product;
        productForm = new ProductRequestDto
        {
            Name = product.Name,
            Price = product.Price,
            Type = product.Type,
            IsAddOn = product.IsAddOn,
            IsActive = product.IsActive
        };
        errorMessage = null;
        successMessage = null;
        showModal = true;
    }

    private void CloseModal()
    {
        showModal = false;
        editingProduct = null;
        errorMessage = null;
        productForm = new();
    }

    private async Task SaveProduct()
    {
        isSaving = true;
        errorMessage = null;
        StateHasChanged();

        try
        {
            if (editingProduct == null)
            {
                // Create new product
                var command = new CreateProductCommand
                {
                    Name = productForm.Name.Trim(),
                    Price = productForm.Price,
                    Type = productForm.Type,
                    IsAddOn = productForm.IsAddOn,
                    IsActive = productForm.IsActive
                };

                var result = await ProductService.CreateProductAsync(command);
                if (result != null)
                {
                    successMessage = $"Product '{result.Name}' created successfully!";
                    CloseModal();
                    await LoadProductsAsync();
                }
                else
                {
                    errorMessage = "Failed to create product. Please try again.";
                }
            }
            else
            {
                // Update existing product
                var command = new UpdateProductCommand
                {
                    Id = editingProduct.Id,
                    Name = productForm.Name.Trim(),
                    Price = productForm.Price,
                    Type = productForm.Type,
                    IsAddOn = productForm.IsAddOn,
                    IsActive = productForm.IsActive
                };

                var result = await ProductService.UpdateProductAsync(command);
                if (result != null)
                {
                    successMessage = $"Product '{result.Name}' updated successfully!";
                    CloseModal();
                    await LoadProductsAsync();
                }
                else
                {
                    errorMessage = "Failed to update product. Please try again.";
                }
            }
        }
        catch (Exception ex)
        {
            errorMessage = $"Error: {ex.Message}";
            Console.WriteLine($"Error saving product: {ex}");
        }
        finally
        {
            isSaving = false;
            StateHasChanged();
        }
    }

    private void ShowDeleteConfirmation(ProductDto product)
    {
        deletingProduct = product;
        errorMessage = null;
        successMessage = null;
        showDeleteConfirm = true;
    }

    private void CloseDeleteConfirmation()
    {
        showDeleteConfirm = false;
        deletingProduct = null;
        errorMessage = null;
    }

    private async Task ConfirmDelete()
    {
        if (deletingProduct == null) return;

        isDeleting = true;
        errorMessage = null;
        StateHasChanged();

        try
        {
            var success = await ProductService.DeleteProductAsync(deletingProduct.Id);
            if (success)
            {
                successMessage = $"Product '{deletingProduct.Name}' deleted successfully!";
                CloseDeleteConfirmation();
                await LoadProductsAsync();
            }
            else
            {
                errorMessage = "Failed to delete product. Please try again.";
            }
        }
        catch (Exception ex)
        {
            errorMessage = $"Error: {ex.Message}";
            Console.WriteLine($"Error deleting product: {ex}");
        }
        finally
        {
            isDeleting = false;
            StateHasChanged();
        }
    }
}
