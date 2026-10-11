using Microsoft.EntityFrameworkCore;
using NSubstitute;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Customers;
using WTF.Api.Services;
using WTF.Domain.Entities;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Features.Customers;

internal static class CustomerSeed
{
    public static Customer NewCustomer(string first = "Ana", string last = "Cruz", string? address = "Manila", bool isActive = true) => new()
    {
        Id = Guid.NewGuid(),
        FirstName = first,
        LastName = last,
        Address = address,
        IsActive = isActive,
        CreatedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc),
        CreatedBy = Guid.NewGuid()
    };

    public static CustomerImage NewImage(Guid customerId, string url, out Image image)
    {
        image = new Image { ImageId = Guid.NewGuid(), ImageUrl = url, UploadedAt = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
        return new CustomerImage { CustomerId = customerId, ImageId = image.ImageId };
    }

    public static Task SeedAsync(string dbName, params object[] entities) => TestDb.SaveAsync(dbName, entities);
}
