namespace WTF.Api.Services;

public interface IImageStorage
{
    Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken);
    Task DeleteAsync(string? imageUrl, CancellationToken cancellationToken);

    /// <summary>Lists every stored image file (only under the <c>images/</c> folder, never reports or other files).</summary>
    Task<IReadOnlyList<StoredImageInfo>> ListAsync(CancellationToken cancellationToken);

    /// <summary>
    /// The storage key of an image URL (for example <c>images/products/a.png</c>), so a URL saved in the database
    /// can be compared with a listed file whatever form the URL takes.
    /// </summary>
    string GetKey(string imageUrl);
}

public sealed record StoredImageInfo(string Key, string Url, DateTimeOffset LastModifiedUtc);
