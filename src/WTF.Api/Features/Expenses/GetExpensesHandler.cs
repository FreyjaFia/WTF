using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.DTOs;
using WTF.Api.Features.Expenses.DTOs;
using WTF.Calculations.Sales;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Expenses;

public record GetExpensesQuery(
    DateTime? FromDate,
    DateTime? ToDate,
    byte? Category,
    bool? IncludeDeleted,
    string? SortBy = null,
    string? SortDirection = null,
    int Page = 1,
    int PageSize = 25) : IRequest<ExpenseListDto>;

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

        var paging = PagingRequest.From(request.Page, request.PageSize, 25);
        var totalCount = await query.CountAsync(cancellationToken);
        paging = paging.ClampToTotal(totalCount);

        var rows = await ApplySort(query, request)
            .ApplyPaging(paging)
            .Select(e => new { Expense = e, CreatedByName = e.CreatedByNavigation.Username })
            .ToListAsync(cancellationToken);

        var items = rows.Select(row => ExpenseRules.ToDto(row.Expense, row.CreatedByName)).ToList();
        var byCategory = totals
            .OrderBy(total => total.Category)
            .Select(total => new ExpenseCategoryTotalDto(total.Category, ExpenseCategories.NameOf(total.Category), total.Count, total.Amount))
            .ToList();

        return new ExpenseListDto(items, byCategory.Sum(total => total.Amount), byCategory, paging.Page, paging.PageSize, totalCount);
    }

    private static IQueryable<Expense> ApplySort(IQueryable<Expense> query, GetExpensesQuery request)
    {
        var ascending = string.Equals(request.SortDirection, "asc", StringComparison.OrdinalIgnoreCase);
        var column = request.SortBy?.Trim().ToLowerInvariant();

        return (column, ascending) switch
        {
            ("category", true) => query.OrderBy(e => e.Category).ThenBy(e => e.Id),
            ("category", false) => query.OrderByDescending(e => e.Category).ThenByDescending(e => e.Id),
            ("amount", true) => query.OrderBy(e => e.Amount).ThenBy(e => e.Id),
            ("amount", false) => query.OrderByDescending(e => e.Amount).ThenByDescending(e => e.Id),
            ("date", true) => query.OrderBy(e => e.ExpenseDate).ThenBy(e => e.CreatedAt).ThenBy(e => e.Id),
            _ => query.OrderByDescending(e => e.ExpenseDate).ThenByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id),
        };
    }
}
