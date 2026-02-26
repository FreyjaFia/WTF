using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Audit.DTOs;
using WTF.Domain.Data;

namespace WTF.Api.Features.Audit;

public sealed record GetSchemaScriptHistoryQuery : IRequest<List<SchemaScriptHistoryDto>>;

public sealed class GetSchemaScriptHistoryHandler(WTFDbContext db)
    : IRequestHandler<GetSchemaScriptHistoryQuery, List<SchemaScriptHistoryDto>>
{
    public async Task<List<SchemaScriptHistoryDto>> Handle(
        GetSchemaScriptHistoryQuery request,
        CancellationToken cancellationToken)
    {
        return await db.SchemaScriptHistories
            .AsNoTracking()
            .OrderByDescending(s => s.AppliedAt)
            .ThenByDescending(s => s.Id)
            .Select(s => new SchemaScriptHistoryDto(
                s.Id,
                s.ScriptName,
                s.AppliedAt))
            .ToListAsync(cancellationToken);
    }
}
