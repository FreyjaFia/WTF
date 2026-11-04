namespace WTF.Api.Features.Expenses.DTOs;

public sealed record ExpenseDto(
    Guid Id,
    DateOnly ExpenseDate,
    byte Category,
    string CategoryName,
    decimal Amount,
    string? Note,
    bool IsActive,
    DateTime CreatedAt,
    string? CreatedByName);

public sealed record ExpenseCategoryTotalDto(byte Category, string CategoryName, int Count, decimal Amount);

public sealed record ExpenseListDto(
    List<ExpenseDto> Items,
    decimal Total,
    List<ExpenseCategoryTotalDto> ByCategory);

public sealed record ExpenseCategoryDto(byte Id, string Name, bool NeedsNote);
