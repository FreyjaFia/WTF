using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace WTF.Api.Services;

public sealed class AzureBlobReportFileStorage : IReportFileStorage
{
    private readonly BlobContainerClient _containerClient;

    public AzureBlobReportFileStorage(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("BlobStorage")
            ?? configuration["Storage:AzureBlob:ConnectionString"]
            ?? configuration["Storage:ConnectionString"];
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Storage connection string is not configured.");
        }

        var containerName = configuration["Storage:AzureBlob:Container"]
            ?? configuration["Storage:Container"]
            ?? "images";
        _containerClient = new BlobContainerClient(connectionString, containerName);
        _containerClient.CreateIfNotExists(PublicAccessType.Blob);
    }

    public async Task SaveAsync(
        string relativePath,
        byte[] data,
        string contentType,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(data);
        var blobName = SanitizeRelativePath(relativePath);
        var blobClient = _containerClient.GetBlobClient(blobName);
        var options = new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders
            {
                ContentType = string.IsNullOrWhiteSpace(contentType)
                    ? "application/octet-stream"
                    : contentType
            }
        };

        await blobClient.UploadAsync(BinaryData.FromBytes(data), options, cancellationToken);
    }

    public async Task<byte[]?> ReadAllBytesAsync(
        string relativePath,
        CancellationToken cancellationToken)
    {
        var blobName = SanitizeRelativePath(relativePath);
        var blobClient = _containerClient.GetBlobClient(blobName);
        if (!await blobClient.ExistsAsync(cancellationToken))
        {
            return null;
        }

        var download = await blobClient.DownloadContentAsync(cancellationToken);
        return download.Value.Content.ToArray();
    }

    public async Task<ReportFileInfo?> GetInfoAsync(
        string relativePath,
        CancellationToken cancellationToken)
    {
        var blobName = SanitizeRelativePath(relativePath);
        var blobClient = _containerClient.GetBlobClient(blobName);
        if (!await blobClient.ExistsAsync(cancellationToken))
        {
            return null;
        }

        var properties = await blobClient.GetPropertiesAsync(cancellationToken: cancellationToken);
        var info = new ReportFileInfo(
            blobName,
            properties.Value.ContentLength,
            properties.Value.LastModified.ToUniversalTime());

        return info;
    }

    private static string SanitizeRelativePath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            throw new InvalidOperationException("Report file path is required.");
        }

        var normalized = relativePath.Replace('\\', '/').TrimStart('/');
        if (normalized.Contains("..", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Invalid report file path.");
        }

        return normalized;
    }
}
