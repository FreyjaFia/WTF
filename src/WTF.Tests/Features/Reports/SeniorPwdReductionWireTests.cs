using System.Text.Json;
using WTF.Api.Features.Reports.DTOs;

namespace WTF.Tests.Features.Reports;

public class SeniorPwdReductionWireTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void TheReductionColumns_KeepTheJsonNameTheAppReads()
    {
        var daily = JsonSerializer.Serialize(new DailySalesReportRowDto(default, 0m, 0, 0m, 0m, 0, SeniorPwdReduction: 30m), Web);
        var payments = JsonSerializer.Serialize(new PaymentsReportRowDto("Cash", 1, 0m, 0m, SeniorPwdReduction: 30m), Web);

        daily.ShouldContain("\"seniorPwdDiscounts\":30");
        payments.ShouldContain("\"seniorPwdDiscounts\":30");
        daily.ShouldNotContain("seniorPwdReduction");
    }
}
