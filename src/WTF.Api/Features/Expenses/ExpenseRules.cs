using WTF.Api.Features.Expenses.DTOs;
using WTF.Calculations.Sales;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Expenses;

public static class ExpenseRules
{
    public const decimal MaxAmount = 100_000_000m;
    public const int NoteMaxLength = 200;

    public static void ValidateDate(DateOnly date, DateOnly today)
    {
        if (date.Year < 2000 || date > today.AddYears(1))
        {
            throw new InvalidOperationException("Choose a date from the last years and no more than a year ahead.");
        }
    }

    public static (byte Category, decimal Amount, string? Note) Validate(byte category, decimal amount, string? note)
    {
        if (!ExpenseCategories.IsValid(category))
        {
            throw new InvalidOperationException("Choose a category for the expense.");
        }

        if (amount <= 0m)
        {
            throw new InvalidOperationException("The amount must be more than zero.");
        }

        if (amount > MaxAmount)
        {
            throw new InvalidOperationException("The amount is too large.");
        }

        var trimmed = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (trimmed is null && ExpenseCategories.NeedsNote(category))
        {
            throw new InvalidOperationException("Say what the expense was for when the category is Other.");
        }

        if (trimmed is { Length: > NoteMaxLength })
        {
            throw new InvalidOperationException($"The note can be at most {NoteMaxLength} characters.");
        }

        return (category, Math.Round(amount, 2, MidpointRounding.AwayFromZero), trimmed);
    }

    public static ExpenseDto ToDto(Expense expense, string? createdByName) => new(
        expense.Id,
        expense.ExpenseDate,
        expense.Category,
        ExpenseCategories.NameOf(expense.Category),
        expense.Amount,
        expense.Note,
        expense.IsActive,
        expense.CreatedAt,
        createdByName);
}
