namespace WTF.Api.Services;

public sealed class LocalReportFileStorage(IWebHostEnvironment env) : IReportFileStorage
{
    private readonly string _webRootPath = !string.IsNullOrWhiteSpace(env.WebRootPath)
        ? env.WebRootPath
        : Path.Combine(env.ContentRootPath, "wwwroot");

    public async Task SaveAsync(
        string relativePath,
        byte[] data,
        string contentType,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(data);
        var safeRelativePath = SanitizeRelativePath(relativePath);
        var fullPath = Path.Combine(_webRootPath, safeRelativePath.Replace('/', Path.DirectorySeparatorChar));
        var directory = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(directory))
        {
            throw new InvalidOperationException("Report file directory is invalid.");
        }

        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(fullPath, data, cancellationToken);
    }

    public async Task<byte[]?> ReadAllBytesAsync(
        string relativePath,
        CancellationToken cancellationToken)
    {
        var safeRelativePath = SanitizeRelativePath(relativePath);
        var fullPath = Path.Combine(_webRootPath, safeRelativePath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(fullPath))
        {
            return null;
        }

        return await File.ReadAllBytesAsync(fullPath, cancellationToken);
    }

    public Task<ReportFileInfo?> GetInfoAsync(
        string relativePath,
        CancellationToken cancellationToken)
    {
        var safeRelativePath = SanitizeRelativePath(relativePath);
        var fullPath = Path.Combine(_webRootPath, safeRelativePath.Replace('/', Path.DirectorySeparatorChar));
        if (!File.Exists(fullPath))
        {
            return Task.FromResult<ReportFileInfo?>(null);
        }

        var file = new FileInfo(fullPath);
        var info = new ReportFileInfo(
            safeRelativePath,
            file.Length,
            new DateTimeOffset(file.LastWriteTimeUtc, TimeSpan.Zero));

        return Task.FromResult<ReportFileInfo?>(info);
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
