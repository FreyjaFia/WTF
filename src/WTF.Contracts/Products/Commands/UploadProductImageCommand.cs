using MediatR;

namespace WTF.Contracts.Products.Commands;

public record UploadProductImageCommand(Guid ProductId, byte[] ImageData, string FileName) : IRequest<ProductDto?>;
