using MediatR;
using Microsoft.AspNetCore.Http;
using WTF.Api.Features.Reports;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;
using WTF.Domain.Tenancy;
using WTF.Tests.Infrastructure;

namespace WTF.Tests.Branches;

public class WorkbookBranchScopeTests
{
    private const string SharedPath = "reports/monthly/2026-03/WTF-Monthly-Reports-2026-03.xlsx";

    private sealed record Shop(WTFDbContext Db, Guid Makati, Guid Cebu, MemoryStorage Storage);

    private static async Task<Shop> OpenShopAsync()
    {
        var db = TestDb.Create();
        var makati = db.Branches.Single(b => b.IsMain).Id;
        var cebu = Guid.NewGuid();
        db.Branches.Add(new Branch
        {
            Id = cebu,
            TenantId = TenantDefaults.DefaultTenantId,
            Name = "Cebu",
            Code = "CEB",
            TimeZone = "Asia/Manila",
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
        return new Shop(db, makati, cebu, new MemoryStorage());
    }

    private static MonthlyReportWorkbookService Service(Shop shop, ICurrentBranch branch) =>
        new(new EmptyReports(), new HttpContextAccessor(), shop.Storage, shop.Db, branch);

    [Fact]
    public async Task LimitedUser_DoesNotSeeOrDownloadTheShopWideWorkbook()
    {
        var shop = await OpenShopAsync();
        shop.Storage.Files[SharedPath] = [1, 2, 3];
        var limited = Service(shop, new FixedBranch([shop.Makati], shop.Makati, true));

        (await limited.GetStatusAsync(2026, 3, CancellationToken.None)).Exists.ShouldBeFalse();
        (await limited.GetFileAsync(2026, 3, CancellationToken.None)).ShouldBeNull();
    }

    [Fact]
    public async Task LimitedUser_GeneratingDoesNotOverwriteTheShopWideWorkbook()
    {
        var shop = await OpenShopAsync();
        shop.Storage.Files[SharedPath] = [1, 2, 3];
        var limited = Service(shop, new FixedBranch([shop.Makati], shop.Makati, true));

        var status = await limited.GenerateThroughDateAsync(2026, 3, new DateTime(2026, 3, 31), "Asia/Manila", null, CancellationToken.None);

        status.Exists.ShouldBeTrue();
        shop.Storage.Files[SharedPath].ShouldBe([1, 2, 3]);
        shop.Storage.Files.Count.ShouldBe(2);
    }

    [Fact]
    public async Task UserWhoSeesEveryBranch_UsesTheShopWideWorkbook()
    {
        var shop = await OpenShopAsync();
        shop.Storage.Files[SharedPath] = [1, 2, 3];
        var everything = Service(shop, new FixedBranch([shop.Makati, shop.Cebu], null, false));

        (await everything.GetStatusAsync(2026, 3, CancellationToken.None)).Exists.ShouldBeTrue();
    }

    [Fact]
    public async Task EachBranchChoice_GetsItsOwnWorkbook()
    {
        var shop = await OpenShopAsync();
        var makati = Service(shop, new FixedBranch([shop.Makati], shop.Makati, false, [shop.Makati, shop.Cebu]));
        var cebu = Service(shop, new FixedBranch([shop.Cebu], shop.Cebu, false, [shop.Makati, shop.Cebu]));

        await makati.GenerateThroughDateAsync(2026, 3, new DateTime(2026, 3, 31), "Asia/Manila", null, CancellationToken.None);

        (await makati.GetStatusAsync(2026, 3, CancellationToken.None)).Exists.ShouldBeTrue();
        (await cebu.GetStatusAsync(2026, 3, CancellationToken.None)).Exists.ShouldBeFalse();
    }

    private sealed class EmptyReports : ISender
    {
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default) =>
            Task.FromResult((TResponse)Activator.CreateInstance(typeof(TResponse))!);

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default)
            where TRequest : IRequest => Task.CompletedTask;

        public Task<object?> Send(object request, CancellationToken cancellationToken = default) => Task.FromResult<object?>(null);

        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class MemoryStorage : IReportFileStorage
    {
        public Dictionary<string, byte[]> Files { get; } = [];

        public Task SaveAsync(string relativePath, byte[] data, string contentType, DateTimeOffset? generatedAtUtc, CancellationToken cancellationToken)
        {
            Files[relativePath] = data;
            return Task.CompletedTask;
        }

        public Task<byte[]?> ReadAllBytesAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(Files.TryGetValue(relativePath, out var data) ? data : null);

        public Task<ReportFileInfo?> GetInfoAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(Files.TryGetValue(relativePath, out var data)
                ? new ReportFileInfo(relativePath, data.Length, DateTimeOffset.UtcNow)
                : null);
    }
}
