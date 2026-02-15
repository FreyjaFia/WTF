# GitHub Copilot Instructions for WTF Project

## Core Mindset

When providing assistance, adopt the appropriate professional mindset:

### For Design & Layout Requests
**Think like a Senior UI/UX Developer:**
- Consider user experience first - intuitive navigation, accessibility, and usability
- Apply modern design principles: consistency, visual hierarchy, whitespace, and responsive design
- Think about mobile-first design and cross-platform compatibility
- Recommend best practices for component composition and reusability
- Consider performance implications of UI choices (lazy loading, virtualization)
- Suggest appropriate color schemes, typography, and spacing that align with modern design systems
- Always prioritize user workflows and interaction patterns

### For Coding Questions & Requests
**Think like a Senior Developer:**
- Apply SOLID principles and clean code practices
- Consider maintainability, scalability, and testability
- Think about error handling, edge cases, and validation
- Recommend appropriate design patterns and architectural approaches
- Consider performance implications and optimization opportunities
- Suggest defensive programming practices and security considerations
- Think about future extensibility and backward compatibility
- Always explain the "why" behind technical decisions

## Project Overview
Wake. Taste. Focus (WTF) is a multi-platform application for a coffee shop, built with .NET 10. The solution consists of three main projects sharing a common domain model:
- **WTF.Api**: ASP.NET Core Web API (backend)
- **WTF.UI**: Blazor WebAssembly (web frontend)
- **WTF.MAUI**: .NET MAUI mobile application (cross-platform mobile)
- **WTF.Contracts**: Shared DTOs, commands, and queries
- **WTF.Domain**: Shared entity models and EF Core DbContext

## Architecture Patterns

### Backend (WTF.Api)
The API uses **Vertical Slice Architecture** with MediatR:
- Features are organized by domain in `Features/{Domain}/{Handler}.cs`
- Each handler implements `IRequestHandler<TRequest, TResponse>`
- Endpoints are grouped using minimal APIs in `Endpoints/{Domain}Endpoints.cs`
- Example: `Features/Orders/GetOrdersHandler.cs` handles `GetOrdersQuery` from `Contracts/Orders/Queries/`

**Key conventions:**
```csharp
// Handler with primary constructor (C# 14)
public class GetOrdersHandler(WTFDbContext db) : IRequestHandler<GetOrdersQuery, List<OrderDto>>

// Endpoint registration pattern
public static IEndpointRouteBuilder MapOrders(this IEndpointRouteBuilder app)
{
    var orderGroup = app.MapGroup("/api/orders").RequireAuthorization();
    orderGroup.MapGet("/", async ([AsParameters] GetOrdersQuery query, ISender sender) => {...});
}
```

### Frontend - Blazor (WTF.UI)
- **Feature-based folder structure**: `Features/{Domain}/{ComponentName}.razor`
- Services per feature: `Features/{Domain}/Services/{Service}.cs`
- Uses Blazored.LocalStorage for token persistence
- Primary constructor pattern for services: `public class ProductService(HttpClient httpClient)`

**Token authentication:**
- `TokenAuthMessageHandler` auto-injects JWT from LocalStorage on all API calls
- Token stored as `"accessToken"` key in LocalStorage

### Frontend - MAUI (WTF.MAUI)
- **MVVM pattern** using CommunityToolkit.Mvvm
- ViewModels use `[ObservableProperty]` and `[RelayCommand]` source generators
- Pages: `Views/{PageName}.xaml` + `Views/{PageName}.xaml.cs`
- ViewModels: `ViewModels/{PageName}ViewModel.cs`

**Custom navigation:**
- Uses `SidebarLayout` with `SidebarViewModel` for dynamic page loading
- Content pages loaded into `SidebarLayout.PageContent` via service provider
- Pages must be registered in `MauiProgram.cs` with correct lifetime (Singleton for container/content, Transient for forms)

**Token authentication:**
- `TokenService` manages tokens with SecureStorage (remember me) or in-memory (session only)
- `AuthTokenHandler` auto-injects JWT on HTTP requests

**ViewModel Organization:**
ViewModels follow a strict region-based organization pattern:
```csharp
public partial class OrderViewModel : ObservableObject
{
    #region Fields
    private readonly IOrderService _orderService;
    private bool _isRefreshingInternal = false;
    private CancellationTokenSource? _searchCancellationTokenSource;
    #endregion

    #region Constructor
    public OrderViewModel(IOrderService orderService)
    {
        _orderService = orderService;
    }
    #endregion

    #region Observable Properties
    [ObservableProperty]
    private ObservableCollection<OrderDto> orders = new();

    [ObservableProperty]
    private bool isLoading;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasOrders))]
    private string searchText = string.Empty;
    #endregion

    #region Computed Properties
    public bool HasOrders => Orders.Any();
    #endregion

    #region Public Methods
    public async Task InitializeAsync() { }
    #endregion

    #region Commands
    [RelayCommand]
    private async Task LoadOrdersAsync() { }

    [RelayCommand]
    private async Task RefreshOrdersAsync() { }
    #endregion

    #region Private Helper Methods
    private async Task FetchOrdersAsync() { }
    #endregion

    #region Partial Methods (Property Change Handlers)
    partial void OnSearchTextChanged(string value) { }
    partial void OnIsRefreshingChanged(bool value) { }
    #endregion
}
```

**Key rules:**
- Order: Fields ? Constructor ? Observable Properties ? Computed Properties ? Public Methods ? Commands ? Private Helper Methods ? Partial Methods
- Use `#region` for all sections
- Observable properties use `[ObservableProperty]` attribute on private fields (generates public properties)
- Commands use `[RelayCommand]` attribute on private methods (generates public commands)
- Computed properties are regular public properties that depend on observables
- Partial methods handle property change notifications from source generators
- **Always use proper new line spacing between members, regions, and logical code blocks for readability.**

**Always apply these code style and ViewModel organization rules when updating existing files, not just when creating new files.**

## Shared Patterns

### CQRS with MediatR
All request/response objects are **records** in `WTF.Contracts`:
```csharp
// Query
public record GetOrdersQuery(int Page, int PageSize, int Status) : IRequest<List<OrderDto>>;

// Command
public record CreateOrderCommand(...) : IRequest<OrderDto>;

// DTO
public record OrderDto(Guid Id, int OrderNumber, ...);
```

### Authentication Flow
1. Login POST to `/api/auth/login` returns JWT in `LoginDto`
2. Frontend stores token (LocalStorage for Blazor, SecureStorage/memory for MAUI)
3. Message handlers (`TokenAuthMessageHandler`/`AuthTokenHandler`) inject token in Authorization header
4. API validates JWT via ASP.NET Core JWT Bearer middleware

## Database & Entity Framework
- **SQL Server** with EF Core scaffolded DbContext (`WTF.Domain/Data/WTFDbContext.cs`)
- Connection string in `appsettings.json` under `ConnectionStrings:WtfDb`
- Uses GUID primary keys with default value SQL: `(newid())`
- Order numbers auto-increment via SQL sequence: `OrderNumberSeq`

**Important:** DbContext is scaffolded from existing database. Do not modify `OnModelCreating` manually except in partial method `OnModelCreatingPartial`.

## Development Workflows

### Running the Projects
**API:**
```bash
cd src/WTF.Api
dotnet run
# API runs on http://localhost:5000 (dev), https in production
```

**Blazor UI:**
```bash
cd src/WTF.UI
dotnet run
# WebAssembly app served at http://localhost:5001
```

**MAUI:**
```bash
cd src/WTF.MAUI
dotnet build -t:Run -f net10.0-android  # For Android
dotnet build -t:Run -f net10.0-windows  # For Windows
```

### Adding New Features

**API Endpoint:**
1. Create request/response DTOs in `WTF.Contracts/{Domain}/`
2. Create handler in `WTF.Api/Features/{Domain}/{Action}Handler.cs`
3. Map endpoint in `WTF.Api/Endpoints/{Domain}Endpoints.cs`
4. Register endpoint group in `Program.cs`: `app.Map{Domain}()`

**MAUI Page:**
1. Create XAML page in `Views/{PageName}.xaml`
2. Create ViewModel in `ViewModels/{PageName}ViewModel.cs` with `ObservableObject` base
3. Register both in `MauiProgram.cs` (lifetime matters!)
4. For SidebarLayout integration, implement `IInitializablePage` if needed

**Blazor Component:**
1. Create `.razor` file in `Features/{Domain}/{ComponentName}.razor`
2. Create code-behind `.razor.cs` with `partial class`
3. Register service in `Program.cs` if needed
4. Inject dependencies via `[Inject]` attribute

## Code Style

### Naming Conventions
- DTOs end with `Dto` suffix (e.g., `OrderDto`, `ProductDto`)
- Commands end with `Command` (e.g., `CreateOrderCommand`)
- Queries end with `Query` (e.g., `GetOrdersQuery`)
- Handlers end with `Handler` (e.g., `CreateOrderHandler`)
- ViewModels end with `ViewModel` (e.g., `OrderViewModel`)

### Using Directives (Imports)
- **Always organize** using directives alphabetically (like Visual Studio's Ctrl+K, Ctrl+E)
- **Remove unused** using directives before committing
- **Do NOT group** by System/third-party/project - sort ALL imports alphabetically as a single list
- Use file-scoped namespaces when possible (C# 10+)

```csharp
// Good - organized alphabetically (single list, no grouping)
using Blazored.LocalStorage;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;
using System.Net.Http.Json;
using WTF.Contracts.Orders;
using WTF.Contracts.Orders.Enums;
using WTF.Contracts.Orders.Queries;
using WTF.MAUI.Services;
using WTF.MAUI.Views;

namespace WTF.MAUI.ViewModels;

public partial class OrderViewModel : ObservableObject
{
    // ...
}
```

### Bracing and Control Flow
- **Always use braces** for `if`, `else`, `for`, `foreach`, `while`, and `using` statements, even for single-line bodies
- Place opening brace on the same line (K&R style) for consistency with C# conventions

```csharp
// Good - always use braces
if (order == null)
{
    return;
}

if (result)
{
    await LoadOrdersAsync();
}
else
{
    ErrorMessage = "Failed to delete order.";
}

// Bad - avoid single-line without braces
if (order == null) return;  // ? Don't do this
```

### Observable Properties (MAUI)
Use source generators, not manual implementation:
```csharp
[ObservableProperty]
private bool isLoading;  // Generates public IsLoading property

[ObservableProperty]
[NotifyPropertyChangedFor(nameof(HasOrders))]  // Trigger computed property
private ObservableCollection<OrderDto> orders = new();
```

### Async Methods
- Always suffix with `Async`
- Use `CancellationToken` for long-running operations
- MAUI: Wrap UI updates in `MainThread.InvokeOnMainThreadAsync()`

- **Always use proper new line spacing between members, regions, and logical code blocks for readability.**

**Always apply these code style and ViewModel organization rules when updating existing files, not just when creating new files.**

## Common Pitfalls

1. **MAUI Page Lifetimes**: Container/content pages must be Singleton to prevent recreation on navigation
2. **HTTPS in Development**: API disables HTTPS redirect in dev for mobile app compatibility (see `Program.cs`)
3. **Enum Handling**: Contract enums (e.g., `OrderStatusEnum`) map to int in database (e.g., `StatusId`)
4. **User Context**: Get authenticated user ID via `HttpContext.User.GetUserId()` extension method
5. **Rate Limiting**: Loyalty endpoints use fixed window rate limiter (5 requests per 10 seconds)
6. **Unused Imports**: Always clean up unused using directives to keep code maintainable
7. **Missing Braces**: Always use braces for control flow statements to prevent bugs during refactoring
8. **Import Organization**: Sort ALL imports alphabetically as a single list (no grouping by namespace type)

## Configuration

### appsettings.json Structure
All projects expect `WtfSettings` section:
```json
{
  "WtfSettings": {
    "BaseUrl": "http://localhost:5000"
  },
  "ConnectionStrings": {
    "WtfDb": "Server=...;Database=WTF;..."
  },
  "Jwt": {
    "Key": "...",
    "Issuer": "WTF.Api",
    "Audience": "WTF.Clients"
  }
}
```

### MAUI Embedded appsettings
The `appsettings.json` in MAUI is an embedded resource loaded via `GetManifestResourceStream("WTF.MAUI.appsettings.json")`.

## Testing & Debugging

### API Test Endpoints
Use `/api/test/protected` (requires auth) and `/api/test/public` to verify JWT flow.

### MAUI Debugging
- Use `System.Diagnostics.Debug.WriteLine()` for logging
- Check Visual Studio Output window (Debug pane)
- LoadingPage shown during auth validation in `App.xaml.cs`

## Technologies & Dependencies
- **.NET 10** (all projects target `net10.0`)
- **EF Core** with SQL Server
- **MediatR** for CQRS
- **CommunityToolkit.Mvvm** for MAUI MVVM
- **Blazored.LocalStorage** for Blazor token storage
- **JWT Bearer** authentication
- **Material Symbols Outlined** font for MAUI icons

## Git Commit Guidelines

Follow these rules for writing clear and consistent commit messages:

### The Seven Rules of a Great Git Commit Message

1. **Separate subject from body with a blank line**
2. **Limit the subject line to 50 characters**
3. **Capitalize the subject line**
4. **Do not end the subject line with a period**
5. **Use the imperative mood in the subject line**
6. **Wrap the body at 72 characters**
7. **Use the body to explain what and why vs. how**

### Commit Message Template

```
Capitalized, short (50 chars or less) summary

More detailed explanatory text, if necessary. Wrap it to about 72
characters or so. In some contexts, the first line is treated as the
subject of an email and the rest as the body. The blank line
separating the summary from the body is critical (unless you omit
the body entirely); tools like rebase can get confused if you run
the two together.

Write your commit message in the imperative: "Fix bug" and not
"Fixed bug" or "Fixes bug." This convention matches up with commit
messages generated by commands like git merge and git revert.

Further paragraphs come after blank lines.

- Bullet points are okay, too
- Use a hyphen or asterisk for the bullet
- Wrap at 72 characters

```

### Good Examples

**Example 1:**
```
Add comprehensive coding standards document

Create copilot-instructions.md to establish project-wide coding
standards and conventions.

This document provides:
- Project architecture overview (Vertical Slice, CQRS, Minimal API)
- Naming conventions for all code elements
- Code style rules (using directives, bracing, spacing)

Why: Ensures consistency across the codebase and helps developers
follow established patterns and conventions.

```
**Example 2:**
```
Adopt primary constructors in handler classes

Replace traditional constructor pattern with C# 12 primary
constructors in all MediatR handlers.

Changes:
- Remove private readonly fields
- Use constructor parameter directly in methods
- Applied to all handlers

Why: Primary constructors reduce boilerplate code and improve
readability while leveraging modern C# 12 features.

```
### Bad Examples

? **Too vague:**
```
Update files

```
? **Not imperative mood:**
```
Fixed the bug in handler

```
? **Subject too long:**
```
Add new feature that allows users to create and edit merchants with validation

```
? **No body for complex changes:**
```
Refactor handlers

```
? **Subject ends with period:**
```
Add new endpoint.

```
### When to Write Detailed Commit Bodies

Write a detailed body when:
- The change is not obvious from the subject line
- The change affects multiple files or areas
- You're introducing a new pattern or approach
- The reasoning behind the change is important
- Future developers might ask "why was this done?"

---
