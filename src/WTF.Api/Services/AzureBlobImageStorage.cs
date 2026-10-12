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

    public async Task<IReadOnlyList<StoredImageInfo>> ListAsync(CancellationToken cancellationToken)
    {
        var files = new List<StoredImageInfo>();
        await foreach (var blob in _containerClient.GetBlobsAsync(prefix: "images/", cancellationToken: cancellationToken))
        {
            var modified = blob.Properties.LastModified ?? DateTimeOffset.UtcNow;
            files.Add(new StoredImageInfo(
                blob.Name,
                _containerClient.GetBlobClient(blob.Name).Uri.ToString(),
                modified.ToUniversalTime()));
        }

        return files;
    }

    public string GetKey(string imageUrl) => ToBlobName(imageUrl);

    // A saved URL is https://account/container/images/...; the blob name inside the container starts at images/.
    private string ToBlobName(string imageUrl) => ImageKey.From(imageUrl, _containerClient.Name);
}
