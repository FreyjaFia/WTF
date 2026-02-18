namespace WTF.Api.Services;

public interface IImageStorage
{
    Task<string> SaveAsync(string category, string fileName, byte[] data, CancellationToken cancellationToken);
    Task DeleteAsync(string? imageUrl, CancellationToken cancellationToken);
}
