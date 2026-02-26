namespace WTF.Api.Features.Audit.DTOs;

public sealed record SchemaScriptHistoryDto(
    int Id,
    string ScriptName,
    DateTime AppliedAt
);
