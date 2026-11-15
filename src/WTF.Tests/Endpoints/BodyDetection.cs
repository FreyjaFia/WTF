namespace WTF.Tests.Endpoints;

internal sealed class BodyDetection : Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature
{
    public bool CanHaveBody => true;
}
