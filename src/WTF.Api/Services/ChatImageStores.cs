using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Options;
using WTF.Api.Features.Conversations;

namespace WTF.Api.Services;

/// <summary>Chat pictures in their own Azure container, created private (no public access), unlike the product images.</summary>
public sealed class AzureBlobChatImageStore : IChatImageStore
{
    private readonly BlobContainerClient _container;

    public AzureBlobChatImageStore(IConfiguration configuration, IOptions<ChatImageOptions> options)
    {
        var connectionString = configuration.GetConnectionString("BlobStorage")
            ?? configuration["Storage:AzureBlob:ConnectionString"]
            ?? configuration["Storage:ConnectionString"];
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("Storage connection string is not configured.");
        }

        _container = new BlobContainerClient(connectionString, options.Value.Container);
        _container.CreateIfNotExists(PublicAccessType.None);
    }

    public async Task SaveAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken)
    {
        var blob = _container.GetBlobClient(SafeKey(key));
        await blob.UploadAsync(
            BinaryData.FromBytes(data),
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } },
            cancellationToken);
    }

    public async Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken)
    {
        var blob = _container.GetBlobClient(SafeKey(key));
        if (!await blob.ExistsAsync(cancellationToken))
        {
            return null;
        }

        var download = await blob.DownloadContentAsync(cancellationToken);
        return download.Value.Content.ToArray();
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        await _container.GetBlobClient(SafeKey(key)).DeleteIfExistsAsync(cancellationToken: cancellationToken);

    internal static string SafeKey(string key)
    {
        var normalized = (key ?? string.Empty).Replace('\\', '/').TrimStart('/');
        if (normalized.Length == 0 || normalized.Contains("..", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Invalid chat image key.");
        }

        return normalized;
    }
}

/// <summary>For development: files under App_Data, which the web server does not serve.</summary>
public sealed class LocalChatImageStore(IWebHostEnvironment env) : IChatImageStore
{
    private string Root => Path.Combine(env.ContentRootPath, "App_Data", "chat-images");

    public async Task SaveAsync(string key, byte[] data, string contentType, CancellationToken cancellationToken)
    {
        var path = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, data, cancellationToken);
    }

    public async Task<byte[]?> ReadAsync(string key, CancellationToken cancellationToken)
    {
        var path = PathFor(key);
        return File.Exists(path) ? await File.ReadAllBytesAsync(path, cancellationToken) : null;
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        var path = PathFor(key);
        if (File.Exists(path))
        {
            File.Delete(path);
        }

        return Task.CompletedTask;
    }

    private string PathFor(string key) =>
        Path.Combine(Root, AzureBlobChatImageStore.SafeKey(key).Replace('/', Path.DirectorySeparatorChar));
}
