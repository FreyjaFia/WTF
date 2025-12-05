using System.Net.Http.Json;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Commands;
using WTF.Contracts.Orders.Queries;

namespace WTF.MAUI.Services
{
    public interface IOrderService
    {
        Task<List<OrderDto>?> GetOrdersAsync(GetOrdersQuery query);
        Task<OrderDto?> GetOrderByIdAsync(Guid id);
        Task<OrderDto?> CreateOrderAsync(CreateOrderCommand command);
        Task<OrderDto?> UpdateOrderAsync(UpdateOrderCommand command);
        Task<bool> DeleteOrderAsync(Guid id);
    }

    public class OrderService(HttpClient httpClient) : IOrderService
    {
        public async Task<List<OrderDto>?> GetOrdersAsync(GetOrdersQuery query)
        {
            try
            {
                var queryString = $"?Page={query.Page}&PageSize={query.PageSize}&Status={query.Status}";
                
                if (query.CustomerId.HasValue)
                    queryString += $"&CustomerId={query.CustomerId.Value}";

                return await httpClient.GetFromJsonAsync<List<OrderDto>>($"api/orders{queryString}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error fetching orders: {ex.Message}");
                return null;
            }
        }

        public async Task<OrderDto?> GetOrderByIdAsync(Guid id)
        {
            try
            {
                return await httpClient.GetFromJsonAsync<OrderDto>($"api/orders/{id}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error fetching order: {ex.Message}");
                return null;
            }
        }

        public async Task<OrderDto?> CreateOrderAsync(CreateOrderCommand command)
        {
            try
            {
                var response = await httpClient.PostAsJsonAsync("api/orders", command);
                
                if (response.IsSuccessStatusCode)
                {
                    return await response.Content.ReadFromJsonAsync<OrderDto>();
                }

                Console.WriteLine($"Error creating order: {response.StatusCode}");
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error creating order: {ex.Message}");
                return null;
            }
        }

        public async Task<OrderDto?> UpdateOrderAsync(UpdateOrderCommand command)
        {
            try
            {
                var response = await httpClient.PutAsJsonAsync($"api/orders/{command.Id}", command);
                
                if (response.IsSuccessStatusCode)
                {
                    return await response.Content.ReadFromJsonAsync<OrderDto>();
                }

                Console.WriteLine($"Error updating order: {response.StatusCode}");
                return null;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error updating order: {ex.Message}");
                return null;
            }
        }

        public async Task<bool> DeleteOrderAsync(Guid id)
        {
            try
            {
                var response = await httpClient.DeleteAsync($"api/orders/{id}");
                return response.IsSuccessStatusCode;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error deleting order: {ex.Message}");
                return false;
            }
        }
    }
}
