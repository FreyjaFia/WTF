using MediatR;

namespace WTF.Contracts.Customers.Commands;

public record UploadCustomerImageCommand(Guid CustomerId, byte[] ImageData, string FileName) : IRequest<CustomerDto?>;
