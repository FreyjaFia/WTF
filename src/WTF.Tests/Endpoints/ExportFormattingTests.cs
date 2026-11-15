using Microsoft.AspNetCore.Http;
using WTF.Api.Endpoints;

namespace WTF.Tests.Endpoints;

public class ExportFormattingTests
{
    private static DefaultHttpContext Request(string? accept)
    {
        var context = new DefaultHttpContext();
        if (accept is not null)
        {
            context.Request.Headers.Accept = accept;
        }

        return context;
    }

    [Theory]
    [InlineData(null, ReportFileFormat.None)]
    [InlineData("application/json", ReportFileFormat.None)]
    [InlineData("*/*", ReportFileFormat.None)]
    [InlineData("application/pdf", ReportFileFormat.Pdf)]
    [InlineData("APPLICATION/PDF, text/html", ReportFileFormat.Pdf)]
    [InlineData("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ReportFileFormat.Excel)]
    [InlineData("application/vnd.ms-excel", ReportFileFormat.Excel)]
    [InlineData("application/pdf, application/vnd.ms-excel", ReportFileFormat.Excel)]
    [InlineData("spreadsheetml.sheet", ReportFileFormat.None)]
    public void RequestedFormat_FollowsTheAcceptHeader(string? accept, ReportFileFormat expected)
    {
        ExportFormatting.RequestedFormat(Request(accept)).ShouldBe(expected);
        ExportFormatting.IsFileExport(Request(accept)).ShouldBe(expected != ReportFileFormat.None);
    }
}
