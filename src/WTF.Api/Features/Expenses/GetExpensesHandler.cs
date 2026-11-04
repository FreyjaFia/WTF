using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Expenses.DTOs;
using WTF.Calculations.Sales;
using WTF.Domain.Data;

namespace WTF.Api.Features.Expenses;

public record GetExpensesQuery(DateTime? FromDate, DateTime? ToDate, byte? Category, bool? IncludeDeleted) : IRequest<ExpenseListDto>;

public record GetExpenseCategoriesQuery : IRequest<List<ExpenseCategoryDto>>;

public class GetExpenseCategoriesHandler : IRequestHandler<GetExpenseCategoriesQuery, List<ExpenseCategoryDto>>
{
    public Task<List<ExpenseCategoryDto>> Handle(GetExpenseCategoriesQuery request, CancellationToken cancellationToken) =>
        Task.FromResult(ExpenseCategories.All
            .Select(category => new ExpenseCategoryDto(category.Id, category.Name, ExpenseCategories.NeedsNote(category.Id)))
            .ToList());
}

public class GetExpensesHandler(WTFDbContext db) : IRequestHandler<GetExpensesQuery, ExpenseListDto>
{
    private const int MaxRows = 2000;

    public async Task<ExpenseListDto> Handle(GetExpensesQuery request, CancellationToken cancellationToken)
    {
        var query = db.Expenses.AsNoTracking().AsQueryable();

        if (request.IncludeDeleted != true)
        {
            query = query.Where(e => e.IsActive);
        }

        if (request.FromDate is { } from)
        {
            var fromDate = DateOnly.FromDateTime(from);
            query = query.Where(e => e.ExpenseDate >= fromDate);
        }

        if (request.ToDate is { } to)
        {
            var toDate = DateOnly.FromDateTime(to);
            query = query.Where(e => e.ExpenseDate <= toDate);
        }

        if (request.Category is { } category)
        {
            query = query.Where(e => e.Category == category);
        }

        // Totals are worked out over every matching expense, not only the rows listed, and never count deleted ones.
        var totals = await query
            .Where(e => e.IsActive)
            .GroupBy(e => e.Category)
            .Select(group => new { Category = group.Key, Count = group.Count(), Amount = group.Sum(e => e.Amount) })
            .ToListAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(e => e.ExpenseDate)
            .ThenByDescending(e => e.CreatedAt)
            .Take(MaxRows)
            .Select(e => new { Expense = e, CreatedByName = e.CreatedByNavigation.Username })
            .ToListAsync(cancellationToken);

        var items = rows.Select(row => ExpenseRules.ToDto(row.Expense, row.CreatedByName)).ToList();
        var byCategory = totals
            .OrderBy(total => total.Category)
            .Select(total => new ExpenseCategoryTotalDto(total.Category, ExpenseCategories.NameOf(total.Category), total.Count, total.Amount))
            .ToList();

        return new ExpenseListDto(items, byCategory.Sum(total => total.Amount), byCategory);
    }
}
