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

Wake. Taste. Focus (WTF) is a coffee shop application. The monorepo contains:
- **WTF.Api** (`src/WTF.Api/`): ASP.NET Core Web API (backend) — includes all DTOs, commands, queries, enums, and handlers
- **WTF.Domain** (`src/WTF.Domain/`): Entity models and EF Core DbContext
- **wtf-pos** (`src/wtf-pos/`): Angular 19 POS frontend — customer-facing point-of-sale application

## Technologies & Dependencies

### Backend
- **.NET 10** (all projects target `net10.0`)
- **EF Core** with SQL Server
- **MediatR** for CQRS
- **JWT Bearer** authentication

### Frontend
- **Angular 19** with standalone components
- **Tailwind CSS** + **DaisyUI** for styling
- **RxJS** for reactive patterns
- **TypeScript** with strict mode

---

# Backend (WTF.Api + WTF.Domain)

## Architecture Patterns

The API uses **Vertical Slice Architecture** with MediatR:
- Features are organized by domain in `Features/{Domain}/{Handler}.cs`
- Each handler implements `IRequestHandler<TRequest, TResponse>`
- Commands/queries are defined as records **above the handler class** in the same file
- DTOs live in `Features/{Domain}/DTOs/`
- Enums live in `Features/{Domain}/Enums/`
- Endpoints are grouped using minimal APIs in `Endpoints/{Domain}Endpoints.cs`

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

### CQRS with MediatR
Commands and queries are **records** defined above the handler class in the same file. DTOs are separate files in `Features/{Domain}/DTOs/`:
```csharp
// In Features/Orders/DTOs/OrderDto.cs
namespace WTF.Api.Features.Orders.DTOs;
public record OrderDto(Guid Id, int OrderNumber, ...);

// In Features/Orders/GetOrdersHandler.cs
namespace WTF.Api.Features.Orders;
public record GetOrdersQuery(OrderStatusEnum Status, Guid? CustomerId) : IRequest<List<OrderDto>>;
public class GetOrdersHandler(WTFDbContext db) : IRequestHandler<GetOrdersQuery, List<OrderDto>>
{
    // ...
}
```

### Authentication Flow
1. Login POST to `/api/auth/login` returns JWT in `LoginDto`
2. Frontend stores token and injects it in Authorization header on API calls
3. API validates JWT via ASP.NET Core JWT Bearer middleware

## Database & Entity Framework
- **SQL Server** with EF Core scaffolded DbContext (`WTF.Domain/Data/WTFDbContext.cs`)
- Connection string in `appsettings.json` under `ConnectionStrings:WtfDb`
- Uses GUID primary keys with default value SQL: `(newid())`
- Order numbers auto-increment via SQL sequence: `OrderNumberSeq`

**Important:** DbContext is scaffolded from existing database. Do not modify `OnModelCreating` manually except in partial method `OnModelCreatingPartial`.

## Running the API
```bash
cd src/WTF.Api
dotnet run
# API runs on http://localhost:5000 (dev), https in production
```

## Adding New API Features
1. Create response DTOs in `WTF.Api/Features/{Domain}/DTOs/`
2. Create enums (if needed) in `WTF.Api/Features/{Domain}/Enums/`
3. Create handler in `WTF.Api/Features/{Domain}/{Action}Handler.cs` with command/query record above the handler class
4. Map endpoint in `WTF.Api/Endpoints/{Domain}Endpoints.cs`
5. Register endpoint group in `Program.cs`: `app.Map{Domain}()`

## C# Code Style

### Naming Conventions
- DTOs end with `Dto` suffix (e.g., `OrderDto`, `ProductDto`)
- Commands end with `Command` (e.g., `CreateOrderCommand`)
- Queries end with `Query` (e.g., `GetOrdersQuery`)
- Handlers end with `Handler` (e.g., `CreateOrderHandler`)

### Using Directives (Imports)
- **Always organize** using directives alphabetically (like Visual Studio's Ctrl+K, Ctrl+E)
- **Remove unused** using directives before committing
- **Do NOT group** by System/third-party/project - sort ALL imports alphabetically as a single list
- Use file-scoped namespaces when possible (C# 10+)

```csharp
// Good - organized alphabetically (single list, no grouping)
using MediatR;
using Microsoft.EntityFrameworkCore;
using WTF.Api.Features.Orders.DTOs;
using WTF.Api.Features.Orders.Enums;
using WTF.Domain.Data;

namespace WTF.Api.Features.Orders;

public record GetOrdersQuery(OrderStatusEnum Status, Guid? CustomerId) : IRequest<List<OrderDto>>;

public class GetOrdersHandler(WTFDbContext db) : IRequestHandler<GetOrdersQuery, List<OrderDto>>
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
if (order == null) return;  // ❌ Don't do this
```

### Access Modifiers
- **Always explicitly declare** access modifiers on all variables, fields, properties, and methods (`private`, `public`, `protected`, `internal`)
- **Always use `readonly`** on fields that are only assigned in the constructor or declaration
- Never rely on implicit access modifiers — be explicit even when the default would be the same

**Member ordering within a class (group by modifier/purpose):**
1. Constants (`private const`, `public const`)
2. Static fields and properties
3. Private readonly fields
4. Private fields
5. Public properties
6. Constructor(s)
7. Public methods
8. Private helper methods

```csharp
// Good - explicit modifiers, grouped by purpose
public class OrderService
{
    private const int MaxRetries = 3;

    private readonly WTFDbContext _db;
    private readonly ILogger<OrderService> _logger;

    private bool _isProcessing;

    public OrderService(WTFDbContext db, ILogger<OrderService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<OrderDto> CreateOrderAsync(CreateOrderCommand command)
    {
        // ...
    }

    private void ValidateItems(List<OrderItemRequestDto> items)
    {
        // ...
    }
}

// Bad - missing modifiers
class OrderService  // ❌ Missing public
{
    WTFDbContext _db;  // ❌ Missing private readonly
    void Process() { }  // ❌ Missing access modifier
}
```

### Comments
- **Do NOT add summary comments** to methods, properties, classes, constants, or fields
- No `/// <summary>` XML doc comments
- No `/** JSDoc-style */` descriptions above members
- No `// Descriptive sentence` comments above method/property declarations that merely restate what the code does
- Inline implementation comments (e.g. `// Prevent native scroll while pulling`) are acceptable when they explain *why*, not *what*
- Let clear naming and code structure be the documentation

### Async Methods
- Always suffix with `Async`
- Use `CancellationToken` for long-running operations
- **Always use proper new line spacing between members, regions, and logical code blocks for readability.**

## API Configuration

### appsettings.json Structure
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

## Common API Pitfalls
1. **HTTPS in Development**: API disables HTTPS redirect in dev for mobile app compatibility (see `Program.cs`)
2. **Enum Handling**: Feature enums (e.g., `OrderStatusEnum`) map to int in database (e.g., `StatusId`)
3. **User Context**: Get authenticated user ID via `HttpContext.User.GetUserId()` extension method
4. **Rate Limiting**: Loyalty endpoints use fixed window rate limiter (5 requests per 10 seconds)
5. **Unused Imports**: Always clean up unused using directives to keep code maintainable
6. **Missing Braces**: Always use braces for control flow statements to prevent bugs during refactoring
7. **Import Organization**: Sort ALL imports alphabetically as a single list (no grouping by namespace type)

## Testing & Debugging

### API Test Endpoints
Use `/api/test/protected` (requires auth) and `/api/test/public` to verify JWT flow.

---

# Frontend (wtf-pos)

## Architecture

The Angular frontend follows a **feature-based architecture** with clear separation of concerns:

```
src/app/
├── core/                      # App-wide singleton services and infrastructure
│   ├── guards/                # Route guards (auth, role, unsaved-changes)
│   ├── interceptors/          # HTTP interceptors (auth, utc-date)
│   └── services/              # App-wide API/data services
│
├── shared/                    # Reusable UI components and models
│   ├── components/            # Shared components (alert, avatar, badge, etc.)
│   └── models/                # Shared data models/interfaces
│
└── features/                  # Feature modules
    ├── login/
    ├── management/            # Customers, Products, Users CRUD
    └── orders/                # Order editor, checkout, order list
```

### Module Guidelines

**Core Module (`core/`):**
- Singleton services used app-wide (auth, API services, guards, interceptors)
- If a service is used in 2+ feature modules, put it in `core/services/`
- Never import feature-specific code into core

**Shared Module (`shared/`):**
- Reusable UI components, directives, and pipes
- Shared data models and interfaces (DTOs, enums, types)
- No services should be in shared (use `core/services/` instead)
- Can be imported by any feature module

**Features (`features/`):**
- Self-contained feature modules
- Features can import from core and shared
- Features should not import from other features

## Running the Frontend
```bash
cd src/wtf-pos
npm install
npx ng serve
# Runs on http://localhost:4200
```

## TypeScript Code Style

### Naming
- **Hyphens in file names:** `user-profile.ts`, `user-profile.spec.ts`
- **Match file names to identifiers:** File names reflect the main class/concept inside
- **Component files:** Same base name for TypeScript, template, and style files

### Imports
- **Always use path aliases** instead of deep relative paths:

| Alias              | Maps to              |
| ------------------ | -------------------- |
| `@app/*`           | `app/*`              |
| `@core/*`          | `app/core/*`         |
| `@features/*`      | `app/features/*`     |
| `@shared/*`        | `app/shared/*`       |
| `@environments/*`  | `environments/*`     |

```typescript
// ✓ Correct — path aliases
import { AuthService } from '@core/services';
import { Product } from '@shared/models';
import { environment } from '@environments/environment.development';

// ✗ Incorrect — deep relative paths
import { AuthService } from '../../../core/services/auth.service';
```

### Access Modifiers & Return Types
- **Always use explicit modifiers:** Every variable and method must have `private`, `protected`, `public`, or `readonly`
- **Always specify return types on methods:** `void`, `string`, `Observable<Product[]>`, etc.
- **Use `protected` for template-bound members**
- **Use `private` for internal logic**
- **Use `public` sparingly** — only for component public API

### Class Member Ordering
1. Injected dependencies (`private readonly` / `protected readonly` via `inject()`)
2. Inputs, outputs, and queries (`readonly input()`, `readonly output()`, `readonly viewChild()`)
3. Public properties
4. Protected properties (template-bound signals, computed, form groups, etc.)
5. Private properties
6. Lifecycle methods (`ngOnInit`, `ngOnChanges`, `ngOnDestroy`, etc.)
7. Public methods
8. Protected methods (template event handlers)
9. Private helper methods

```typescript
@Component({ ... })
export class ProductEditorComponent implements OnInit, OnDestroy {
  // 1. Injected dependencies
  private readonly productService = inject(ProductService);
  private readonly router = inject(Router);

  // 2. Inputs, outputs, queries
  public readonly productId = input.required<number>();
  public readonly saved = output<Product>();

  // 3-5. Properties grouped by modifier
  protected readonly isLoading = signal(false);
  private previousValues: Partial<Product> | null = null;

  // 6. Lifecycle methods
  public ngOnInit(): void {
    this.loadProduct();
  }

  // 8. Protected methods (template handlers)
  protected submitForm(): void {
    this.productService.update(this.form.value);
  }

  // 9. Private helper methods
  private loadProduct(): void {
    this.isLoading.set(true);
    // ...
  }
}
```

### Control Flow
- **Always use braces** for `if`, `else`, `for`, `while`, and `do-while` statements, even for single-line bodies
- **Logical grouping:** Add blank lines to separate logical sections within methods

### Dependency Injection
- **Prefer `inject()` over constructor injection**

### Forms
- **Always use Reactive Forms** with `FormControl`, `FormGroup`, and `FormBuilder`
- Apply validators to form controls for client-side validation
- Use `debounceTime()` on `valueChanges` for search/filter inputs

### Components & Directives
- Use application-specific prefixes for selectors
- Keep components focused on UI; refactor logic to other files if not UI-related
- Avoid complex logic in templates; use computed properties in TypeScript
- Use `protected` for members only used in templates
- Mark Angular-initialized properties (`input`, `output`, `viewChild`) as `readonly`
- Prefer `[class]`/`[style]` bindings over `NgClass`/`NgStyle`
- Name handlers for what they do, not the event (e.g., `saveUserData()` not `handleClick()`)
- Implement TypeScript interfaces for lifecycle hooks (e.g., `OnInit`)

### Comments
- **Do NOT add summary comments** to methods, properties, classes, constants, or fields
- No `/** JSDoc-style */` descriptions above members
- No `// Descriptive sentence` comments above method/property declarations that merely restate what the code does
- Inline implementation comments (e.g. `// Only start pull-to-refresh when scrolled to top`) are acceptable when they explain *why*, not *what*
- Let clear naming and code structure be the documentation

### Environment Configuration
- `src/environments/environment.development.ts` for development
- `src/environments/environment.ts` for production
- Angular handles file replacement during builds

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5282/api',
};
```

## Styling
- **Prefer Tailwind CSS & DaisyUI** for styles
- Minimal component-scoped CSS — only when utilities can't express the design
- Use `tailwind.config.js` and DaisyUI themes for colors, spacing, typography
- Responsive prefixes (`sm:`, `md:`, `lg:`) over hand-written media queries
- Accessibility: visible focus styles, contrast compliance
- **Prefer standard utility classes over arbitrary values** — use named scale values when Tailwind provides them:

| Avoid (arbitrary) | Prefer (standard) |
| ------------------ | ----------------- |
| `bottom-[5.5rem]` | `bottom-22` |
| `z-[100]` | `z-100` |
| `h-[18px]` | `h-4.5` |
| `w-[18px]` | `w-4.5` |

- **Use Tailwind v4 important syntax** — trailing `!` instead of leading `!`:

| Avoid (legacy) | Prefer (v4) |
| -------------- | ----------- |
| `md:!translate-y-0` | `md:translate-y-0!` |
| `md:!transition-none` | `md:transition-none!` |

- **Use current utility names** — Tailwind renames utilities over time; always use the latest:

| Deprecated | Current |
| ---------- | ------- |
| `break-words` | `wrap-break-word` |
| `order-none` | `order-0` |

## Frontend Error Checking

**MANDATORY for every request:**

1. **Build the project** after making changes:
   ```bash
   npx ng build --configuration=development
   ```
2. **Check for lint errors** — fix all before completing work
3. **Verify template compilation** — all Angular template syntax is valid
4. **Test import paths** — all `import` statements resolve, no circular dependencies
5. **Manual code review** — unused variables, unreachable code, error handling

---

# Shared Guidelines

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

❌ **Too vague:**
```
Update files

```
❌ **Not imperative mood:**
```
Fixed the bug in handler

```
❌ **Subject too long:**
```
Add new feature that allows users to create and edit merchants with validation

```
❌ **No body for complex changes:**
```
Refactor handlers

```
❌ **Subject ends with period:**
```
Add new endpoint.

```

### Grouping Commits by Changes

**Always group related changes into a single commit.** Do not mix unrelated changes in the same commit.

- **One concern per commit** — a bug fix, a feature, a refactor, or a style change should each be its own commit
- **Group files that change together** — if updating a handler also requires updating its endpoint, commit them together
- **Separate cleanup from features** — don't sneak formatting or import cleanup into a feature commit; make a separate commit
- **Commit in logical order** — if feature B depends on feature A, commit A first
- **Group by change type, not by file** — if multiple files receive the same kind of change, batch them into a single commit

```
# Good - grouped by concern
git commit -m "Add CreateProduct endpoint and handler"
git commit -m "Clean up unused imports in Product handlers"

# Bad - unrelated changes mixed together
git commit -m "Add CreateProduct endpoint and fix login bug"
```

### When to Write Detailed Commit Bodies

Write a detailed body when:
- The change is not obvious from the subject line
- The change affects multiple files or areas
- You're introducing a new pattern or approach
- The reasoning behind the change is important
- Future developers might ask "why was this done?"

### Multi-Line Commit Messages (MCP Tools / Programmatic Commits)

When committing via MCP tools (e.g., `mcp_gitkraken_git_add_or_commit`) or any programmatic API, **never use literal `\n` escape sequences** in the message string — they will be committed as-is, producing broken output like:

```
Fix bug\n\nThis fixes a crash when...
```

Instead, **write the commit message to a temporary file** and use `git commit -F <file>`:

```powershell
# 1. Write the message to a temp file (real newlines)
Set-Content -Path "tools/tmp-msg.txt" -Value @"
Fix crash on null customer lookup

The getCustomer handler threw when passed a GUID that
did not exist. Return 404 instead.
"@

# 2. Stage and commit using the file
git add src/handler.ts
git commit -F tools/tmp-msg.txt

# 3. Clean up
Remove-Item tools/tmp-msg.txt
```

**Key rule:** If the tool's message parameter does not support real newlines, always fall back to `-F <file>`.

---
