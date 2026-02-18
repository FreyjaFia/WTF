using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace WTF.Api.Services;

public class AzureBlobImageStorage : IImageStorage
{
    private readonly BlobContainerClient _containerClient;

    public AzureBlobImageStorage(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("BlobStorage")
            ?? configuration["Storage:AzureBlob:ConnectionString"]
            ?? configuration["Storage:ConnectionString"];
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Storage connection string is not configured.");
        }

        var containerName = configuration["Storage:AzureBlob:Container"] ?? configuration["Storage:Container"] ?? "images";
        _containerClient = new BlobContainerClient(connectionString, containerName);
        _containerClient.CreateIfNotExists(PublicAccessType.Blob);
    }

    public async Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken)
    {
        var blobName = $"images/{category}/{fileName}";
        var blobClient = _containerClient.GetBlobClient(blobName);

        await blobClient.UploadAsync(BinaryData.FromBytes(data), overwrite: true, cancellationToken);
        return blobClient.Uri.ToString();
    }

    public async Task DeleteAsync(string? imageUrl, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(imageUrl))
        {
            return;
        }

        var blobName = ToBlobName(imageUrl);
        if (string.IsNullOrWhiteSpace(blobName))
        {
            return;
        }

        var blobClient = _containerClient.GetBlobClient(blobName);
        await blobClient.DeleteIfExistsAsync(cancellationToken: cancellationToken);
    }

    private static string ToBlobName(string imageUrl)
    {
        if (Uri.TryCreate(imageUrl, UriKind.Absolute, out var absoluteUri))
        {
            return absoluteUri.AbsolutePath.TrimStart('/');
        }

        return imageUrl.TrimStart('/');
    }
}
