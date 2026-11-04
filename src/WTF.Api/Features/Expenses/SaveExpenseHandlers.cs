using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Common.Extensions;
using WTF.Api.Common.Time;
using WTF.Api.Features.Audit.Enums;
using WTF.Api.Features.Expenses.DTOs;
using WTF.Api.Services;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Expenses;

public record ExpenseRequest(DateOnly ExpenseDate, byte Category, decimal Amount, string? Note);

public record CreateExpenseCommand(DateOnly ExpenseDate, byte Category, decimal Amount, string? Note) : IRequest<ExpenseDto>;

public record UpdateExpenseCommand(Guid Id, DateOnly ExpenseDate, byte Category, decimal Amount, string? Note) : IRequest<ExpenseDto?>;

public record DeleteExpenseCommand(Guid Id) : IRequest<ExpenseDto?>;

public record RestoreExpenseCommand(Guid Id) : IRequest<ExpenseDto?>;

public class CreateExpenseHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    TimeProvider timeProvider) : IRequestHandler<CreateExpenseCommand, ExpenseDto>
{
    public async Task<ExpenseDto> Handle(CreateExpenseCommand request, CancellationToken cancellationToken)
    {
        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(timeProvider.GetUtcNow().UtcDateTime, timeZone));
        ExpenseRules.ValidateDate(request.ExpenseDate, today);
        var (category, amount, note) = ExpenseRules.Validate(request.Category, request.Amount, request.Note);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var expense = new Expense
        {
            ExpenseDate = request.ExpenseDate,
            Category = category,
            Amount = amount,
            Note = note,
            IsActive = true,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
            CreatedBy = userId
        };

        db.Expenses.Add(expense);
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ExpenseCreated,
            AuditEntityType.Expense,
            expense.Id.ToString(),
            newValues: new { expense.ExpenseDate, expense.Category, expense.Amount, expense.Note },
            userId: userId,
            cancellationToken: cancellationToken);

        var name = await db.Users.Where(u => u.Id == userId).Select(u => u.Username).FirstOrDefaultAsync(cancellationToken);
        return ExpenseRules.ToDto(expense, name);
    }
}

public class UpdateExpenseHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    TimeProvider timeProvider) : IRequestHandler<UpdateExpenseCommand, ExpenseDto?>
{
    public async Task<ExpenseDto?> Handle(UpdateExpenseCommand request, CancellationToken cancellationToken)
    {
        var expense = await db.Expenses.Include(e => e.CreatedByNavigation).FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken);
        if (expense is null)
        {
            return null;
        }

        if (!expense.IsActive)
        {
            throw new InvalidOperationException("This expense was deleted. Restore it before changing it.");
        }

        var timeZone = RequestTimeZone.ResolveFromRequest(httpContextAccessor);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(timeProvider.GetUtcNow().UtcDateTime, timeZone));
        ExpenseRules.ValidateDate(request.ExpenseDate, today);
        var (category, amount, note) = ExpenseRules.Validate(request.Category, request.Amount, request.Note);
        var userId = httpContextAccessor.HttpContext!.User.GetUserId();

        var before = new { expense.ExpenseDate, expense.Category, expense.Amount, expense.Note };
        expense.ExpenseDate = request.ExpenseDate;
        expense.Category = category;
        expense.Amount = amount;
        expense.Note = note;
        expense.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
        expense.UpdatedBy = userId;
        await db.SaveChangesAsync(cancellationToken);

        await auditService.LogAsync(
            AuditAction.ExpenseUpdated,
            AuditEntityType.Expense,
            expense.Id.ToString(),
            oldValues: before,
            newValues: new { expense.ExpenseDate, expense.Category, expense.Amount, expense.Note },
            userId: userId,
            cancellationToken: cancellationToken);

        return ExpenseRules.ToDto(expense, expense.CreatedByNavigation.Username);
    }
}

public class DeleteExpenseHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    TimeProvider timeProvider) : IRequestHandler<DeleteExpenseCommand, ExpenseDto?>
{
    public async Task<ExpenseDto?> Handle(DeleteExpenseCommand request, CancellationToken cancellationToken)
    {
        var expense = await db.Expenses.Include(e => e.CreatedByNavigation).FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken);
        if (expense is null)
        {
            return null;
        }

        if (expense.IsActive)
        {
            var userId = httpContextAccessor.HttpContext!.User.GetUserId();
            expense.IsActive = false;
            expense.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
            expense.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);

            await auditService.LogAsync(
                AuditAction.ExpenseDeleted,
                AuditEntityType.Expense,
                expense.Id.ToString(),
                oldValues: new { IsActive = true, expense.Amount },
                newValues: new { IsActive = false },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return ExpenseRules.ToDto(expense, expense.CreatedByNavigation.Username);
    }
}

public class RestoreExpenseHandler(
    WTFDbContext db,
    IHttpContextAccessor httpContextAccessor,
    IAuditService auditService,
    TimeProvider timeProvider) : IRequestHandler<RestoreExpenseCommand, ExpenseDto?>
{
    public async Task<ExpenseDto?> Handle(RestoreExpenseCommand request, CancellationToken cancellationToken)
    {
        var expense = await db.Expenses.Include(e => e.CreatedByNavigation).FirstOrDefaultAsync(e => e.Id == request.Id, cancellationToken);
        if (expense is null)
        {
            return null;
        }

        if (!expense.IsActive)
        {
            var userId = httpContextAccessor.HttpContext!.User.GetUserId();
            expense.IsActive = true;
            expense.UpdatedAt = timeProvider.GetUtcNow().UtcDateTime;
            expense.UpdatedBy = userId;
            await db.SaveChangesAsync(cancellationToken);

            await auditService.LogAsync(
                AuditAction.ExpenseRestored,
                AuditEntityType.Expense,
                expense.Id.ToString(),
                oldValues: new { IsActive = false },
                newValues: new { IsActive = true, expense.Amount },
                userId: userId,
                cancellationToken: cancellationToken);
        }

        return ExpenseRules.ToDto(expense, expense.CreatedByNavigation.Username);
    }
}
