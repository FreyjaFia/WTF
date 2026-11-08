using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace WTF.Api.Features.Subscriptions;

public sealed record LeasePayload(
    int V,
    Guid TenantId,
    DateTime IssuedAt,
    DateTime PeriodEnd,
    int GraceDays,
    DateTime AccessUntil,
    int MaxAgeDays);

public interface ILeaseSigner
{
    string Sign(LeasePayload payload);

    LeasePayload? Verify(string lease);
}

// A lease is "payload.signature" (both base64url). Without a signing key the signature part is empty (dates only, no key setup);
// with Subscription:LeaseSigningKeyPem set it is ECDSA P-256 in the r||s form the browser's crypto API verifies offline.
public sealed class LeaseSigner : ILeaseSigner, IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly bool _signed;

    public LeaseSigner(IOptions<SubscriptionOptions> options)
    {
        var pem = options.Value.LeaseSigningKeyPem;
        if (!string.IsNullOrWhiteSpace(pem))
        {
            _key.ImportFromPem(pem);
            _signed = true;
        }
    }

    public string PublicKeyBase64 => Convert.ToBase64String(_key.ExportSubjectPublicKeyInfo());

    public string Sign(LeasePayload payload)
    {
        var body = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions));
        if (!_signed)
        {
            return $"{body}.";
        }

        var signature = _key.SignData(Encoding.ASCII.GetBytes(body), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"{body}.{Base64Url(signature)}";
    }

    public LeasePayload? Verify(string lease)
    {
        var parts = lease?.Split('.');
        if (parts is not { Length: 2 })
        {
            return null;
        }

        try
        {
            if (!_signed)
            {
                return JsonSerializer.Deserialize<LeasePayload>(FromBase64Url(parts[0]), JsonOptions);
            }

            var valid = _key.VerifyData(
                Encoding.ASCII.GetBytes(parts[0]), FromBase64Url(parts[1]), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
            return valid ? JsonSerializer.Deserialize<LeasePayload>(FromBase64Url(parts[0]), JsonOptions) : null;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or CryptographicException)
        {
            return null;
        }
    }

    public void Dispose() => _key.Dispose();

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] FromBase64Url(string value)
    {
        var padded = value.Replace('-', '+').Replace('_', '/');
        padded = padded.PadRight(padded.Length + ((4 - (padded.Length % 4)) % 4), '=');
        return Convert.FromBase64String(padded);
    }
}
