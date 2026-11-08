using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using WTF.Api.Features.Branding;
using WTF.Api.Features.Subscriptions;
using WTF.Calculations.Branding;

namespace WTF.Tests.Features.Subscriptions;

public class SubscriptionHelpersTests
{
    private static readonly DateTime End = new(2026, 12, 1, 0, 0, 0, DateTimeKind.Utc);

    private static LeaseSigner NewSigner(string? pem = null) =>
        new(Options.Create(new SubscriptionOptions { LeaseSigningKeyPem = pem }), NullLogger<LeaseSigner>.Instance);

    private static LeasePayload Payload() => new(1, Guid.NewGuid(), End.AddDays(-20), End, 7, End.AddDays(7), 7);

    [Fact]
    public void Lease_SignedByTheServer_VerifiesAndCarriesTheDates()
    {
        using var signer = NewSigner();
        var payload = Payload();

        var lease = signer.Sign(payload);

        signer.Verify(lease).ShouldBe(payload);
    }

    [Fact]
    public void Lease_WithEditedPayload_IsRejected()
    {
        using var signer = NewSigner();
        var parts = signer.Sign(Payload()).Split('.');
        var forged = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(
                "{\"v\":1,\"tenantId\":\"00000000-0000-0000-0000-000000000001\",\"issuedAt\":\"2026-11-01T00:00:00Z\",\"periodEnd\":\"2099-01-01T00:00:00Z\",\"graceDays\":7,\"accessUntil\":\"2099-01-08T00:00:00Z\",\"maxAgeDays\":7}"))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        signer.Verify($"{forged}.{parts[1]}").ShouldBeNull();
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("a.b.c")]
    [InlineData("!!!.???")]
    public void Lease_Garbage_IsRejected(string lease)
    {
        using var signer = NewSigner();

        signer.Verify(lease).ShouldBeNull();
    }

    [Fact]
    public void Lease_FromAnotherKey_IsRejected_ButTheSameConfiguredKeyVerifies()
    {
        using var one = NewSigner();
        using var two = NewSigner();
        one.Sign(Payload()).ShouldNotBeNull();
        two.Verify(one.Sign(Payload())).ShouldBeNull();

        var pem = System.Security.Cryptography.ECDsa.Create(System.Security.Cryptography.ECCurve.NamedCurves.nistP256).ExportPkcs8PrivateKeyPem();
        using var a = NewSigner(pem);
        using var b = NewSigner(pem);
        b.Verify(a.Sign(Payload())).ShouldNotBeNull();
    }

    [Theory]
    [InlineData(10, null)]
    [InlineData(5, null)]
    [InlineData(7, "Your subscription ends in 7 days")]
    [InlineData(3, "Your subscription ends in 3 days")]
    [InlineData(1, "Your subscription ends in 1 day ")]
    [InlineData(2, null)]
    [InlineData(4, null)]
    public void Reminder_IsSentOnlyOnTheWarningDays(int daysBefore, string? expectedStart)
    {
        var reminder = SubscriptionReminderService.ReminderFor(End, 7, End.AddDays(-daysBefore).AddHours(1));

        if (expectedStart is null)
        {
            reminder.ShouldBeNull();
        }
        else
        {
            reminder!.Value.Body.ShouldStartWith(expectedStart.TrimEnd());
        }
    }

    [Fact]
    public void Reminder_EveryDayOfTheGrace_ThenNothingOnceLocked()
    {
        SubscriptionReminderService.ReminderFor(End, 7, End.AddDays(1)).ShouldNotBeNull();
        SubscriptionReminderService.ReminderFor(End, 7, End.AddDays(6)).ShouldNotBeNull();
        SubscriptionReminderService.ReminderFor(End, 7, End.AddDays(7)).ShouldBeNull();
    }

    [Fact]
    public void BrandValidation_AcceptsTheDefaults_AndRefusesBadValues()
    {
        Should.NotThrow(() => BrandDefaults.Validate(BrandDefaults.For("Moon Brew")));

        var good = BrandDefaults.For("Moon Brew");
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { ShopName = " " }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { ShopName = new string('x', 101) }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { PrimaryColor = "red" }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { PrimaryColor = "#ffee00" })).Message.ShouldContain("too light");
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { TimeZone = "Mars/Base" }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { CurrencyCode = "php" }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { CurrencyDecimals = 4 }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { CurrencySymbol = "" }));
        Should.Throw<InvalidOperationException>(() => BrandDefaults.Validate(good with { LogoUrl = "javascript:alert(1)" }));
        Should.NotThrow(() => BrandDefaults.Validate(good with { LogoUrl = "https://cdn.example.com/logo.png" }));
        Should.NotThrow(() => BrandDefaults.Validate(good with { LogoUrl = "/images/logo.png" }));
    }

    [Theory]
    [InlineData("#000000", true)]
    [InlineData("#6f4e37", true)]
    [InlineData("#767676", true)]
    [InlineData("#777777", false)]
    [InlineData("#ffffff", false)]
    [InlineData("6f4e37", false)]
    [InlineData("#6f4e3", false)]
    [InlineData(null, false)]
    public void ColorRules_WhiteTextMustBeReadable(string? hex, bool expected)
    {
        ColorRules.IsReadableWithWhiteText(hex).ShouldBe(expected);
    }
}
