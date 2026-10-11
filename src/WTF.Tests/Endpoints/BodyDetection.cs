namespace WTF.Tests.Endpoints;

/// <summary>Lets a DefaultHttpContext advertise that its request can carry a body, which route binding checks.</summary>
internal sealed class BodyDetection : Microsoft.AspNetCore.Http.Features.IHttpRequestBodyDetectionFeature
{
    public bool CanHaveBody => true;
}
