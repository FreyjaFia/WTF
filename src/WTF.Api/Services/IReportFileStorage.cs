namespace WTF.Api.Services;

public interface IReportFileStorage
{
    Task SaveAsync(
        string relativePath,
        byte[] data,
        string contentType,
        CancellationToken cancellationToken);

    Task<byte[]?> ReadAllBytesAsync(
        string relativePath,
        CancellationToken cancellationToken);

    Task<ReportFileInfo?> GetInfoAsync(
        string relativePath,
        CancellationToken cancellationToken);
}

public sealed record ReportFileInfo(
    string RelativePath,
    long SizeBytes,
    DateTimeOffset LastModifiedUtc);
