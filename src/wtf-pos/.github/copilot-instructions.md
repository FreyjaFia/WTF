# Angular Coding Standards (copilot-instructions)

## Source

- Official Angular Style Guide: [https://angular.dev/style-guide](https://angular.dev/style-guide)

## Mindset

### For Design & Layout Requests

**Think like a Senior UI/UX Developer:**

- Consider user experience first — intuitive navigation, accessibility, and usability
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

## Key Rules & Recommendations

### General Principles

- **Consistency:** When in doubt, prefer consistency within a file over strict adherence to the guide.
- **All UI code in `src/`:** Keep Angular UI code (TypeScript, HTML, styles) inside the `src` directory. Non-UI code (config, scripts) should be outside.
- **Bootstrap in `main.ts`:** The app entry point should be `src/main.ts`.

### Naming

- **Hyphens in file names:** Separate words in file names with hyphens (e.g., `user-profile.ts`).
- **Test files:** End test file names with `.spec.ts` (e.g., `user-profile.spec.ts`).
- **Match file names to identifiers:** File names should reflect the main TypeScript class or concept inside.
- **Component files:** Use the same base name for TypeScript, template, and style files (e.g., `user-profile.ts`, `user-profile.html`, `user-profile.css`).

### Project Structure

- **Feature-based folders:** Organize by feature area, not by code type (avoid `components/`, `services/` folders).
- **Group related files:** Keep component files and their tests together in the same directory.
- **One concept per file:** Prefer one component, directive, or service per file.

## Application Architecture

This application follows a **feature-based architecture** with clear separation of concerns:

### Directory Structure

```
src/app/
├── core/                      # App-wide singleton services and infrastructure
│   ├── guards/                # Route guards
│   │   ├── auth.guard.ts      # Authentication guard
│   │   ├── role.guard.ts      # Role-based access guard
│   │   └── unsaved-changes.guard.ts
│   ├── interceptors/          # HTTP interceptors
│   │   ├── auth.interceptor.ts
│   │   └── utc-date.interceptor.ts
│   └── services/              # App-wide API/data services
│       ├── alert.service.ts
│       ├── auth.service.ts
│       ├── customer.service.ts
│       ├── list-state.service.ts
│       ├── order.service.ts
│       ├── product.service.ts
│       └── user.service.ts
│
├── shared/                    # Reusable UI components and models
│   ├── components/            # Shared components
│   │   ├── addon-selector/
│   │   ├── addons-swapper/
│   │   ├── alert/
│   │   ├── avatar/
│   │   ├── badge/
│   │   ├── customer-dropdown/
│   │   ├── dock/
│   │   ├── filter-dropdown/
│   │   ├── global-alert/
│   │   ├── header/
│   │   ├── icons/
│   │   ├── layout/
│   │   ├── price-history-drawer/
│   │   └── products-swapper/
│   └── models/                # Shared data models/interfaces
│       ├── auth.models.ts
│       ├── cart.models.ts
│       ├── customer.models.ts
│       ├── order.models.ts
│       ├── product.models.ts
│       └── user.models.ts
│
└── features/                  # Feature modules
    ├── login/
    ├── management/
    │   ├── customers/
    │   │   ├── customer-details/
    │   │   ├── customer-editor/
    │   │   └── customer-list/
    │   ├── products/
    │   │   ├── product-details/
    │   │   ├── product-editor/
    │   │   └── product-list/
    │   └── users/
    │       ├── user-details/
    │       ├── user-editor/
    │       └── user-list/
    └── orders/
        ├── checkout-modal/
        ├── order-editor/
        └── order-list/
```

### Module Guidelines

**Core Module (`core/`)**

- Contains singleton services used app-wide
- Auth-related code (services, guards, interceptors)
- **API/data services** that are used across multiple features (ProductService, OrderService, etc.)
- Global state management services
- **When to use:** If a service is used in 2+ feature modules, put it in `core/services/`
- **Import core services anywhere in the app**
- Never import feature-specific code into core

**Shared Module (`shared/`)**

- Reusable UI components, directives, and pipes
- Shared data models and interfaces (DTOs, enums, types)
- **No services should be in shared/** (use `core/services/` instead)
- Shared components should be presentation-focused
- Can be imported by any feature module

**Features (`features/`)**

- Self-contained feature modules
- Each feature has its own components, templates, and styles
- Feature-specific logic stays within the feature
- Features can import from core and shared
- Features should not import from other features

### Code Style

**Control Flow Statements**

- **Always use braces:** All `if`, `else`, `for`, `while`, and `do-while` statements must use braces, even for single-line bodies.
- **Logical grouping:** Add blank lines to separate logical sections within methods for better readability.

**Example:**

```typescript
// ✓ Correct
if (condition) {
  doSomething();
}

// ✗ Incorrect
if (condition) doSomething();

// ✓ Correct - with logical grouping
protected login(): void {
  const credentials = this.getCredentials();

  if (!credentials.isValid) {
    this.showError('Invalid credentials');
    return;
  }

  this.auth.login(credentials);
  this.router.navigateByUrl('/home');
}
```

### Environment Configuration

**Environment Files**

- Use `src/environments/environment.development.ts` for development configuration
- Use `src/environments/environment.ts` for production configuration
- Always import from `environment.development.ts` in services (Angular handles file replacement during builds)

**Configuration Structure:**

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:5282/api',
};
```

**Usage:**

```typescript
import { environment } from '@environments/environment.development';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly baseUrl = `${environment.apiUrl}/products`;
}
```

**File Replacements:**

- Production builds automatically replace `environment.development.ts` with `environment.ts`
- Configured in `angular.json` under `configurations.production.fileReplacements`

### Dependency Injection

- **Prefer `inject()` over constructor injection:** Use the `inject()` function for dependencies for readability and type inference.

### Imports

- **Always use path aliases:** Use the configured TypeScript path aliases instead of relative paths for cross-module imports. The project defines these aliases in `tsconfig.json`:

| Alias              | Maps to              |
| ------------------ | -------------------- |
| `@app/*`           | `app/*`              |
| `@core/*`          | `app/core/*`         |
| `@features/*`      | `app/features/*`     |
| `@shared/*`        | `app/shared/*`       |
| `@environments/*`  | `environments/*`     |

- **When to use aliases:** For any import that crosses module boundaries (e.g., a feature importing from core or shared).
- **When relative paths are fine:** For imports within the same feature or module (sibling/child files).
- **Never use deep relative paths:** Avoid `../../../core/services/...` — use `@core/services/...` instead.

**Example:**

```typescript
// ✓ Correct — path aliases
import { AuthService } from '@core/services';
import { Product } from '@shared/models';
import { environment } from '@environments/environment.development';

// ✗ Incorrect — deep relative paths
import { AuthService } from '../../../core/services/auth.service';
import { Product } from '../../../shared/models/product.models';
import { environment } from '../../../environments/environment.development';
```

### Forms

- **Always use Reactive Forms:** Use `ReactiveFormsModule` with `FormControl`, `FormGroup`, and `FormBuilder` instead of template-driven forms (`ngModel`).
- **Form validation:** Apply validators to form controls for client-side validation.
- **Debounce user input:** Use RxJS operators like `debounceTime()` on `valueChanges` for search/filter inputs.

**Example:**

```typescript
protected readonly filterForm = new FormGroup({
  searchTerm: new FormControl(''),
  isActive: new FormControl(true)
});

public ngOnInit(): void {
  this.filterForm.valueChanges.pipe(debounceTime(300)).subscribe(() => {
    this.loadData();
  });
}
```

### Components & Directives

- **Selector naming:** Use application-specific prefixes for selectors.
- **Group Angular properties:** Place injected dependencies, inputs, outputs, and queries at the top of the class.
- **Presentation focus:** Keep components/directives focused on UI; refactor logic to other files if not UI-related.
- **Template logic:** Avoid complex logic in templates; use computed properties in TypeScript.
- **Protected members:** Use `protected` for class members only used in templates.
- **Readonly properties:** Mark properties initialized by Angular (inputs, outputs, queries) as `readonly`.
- **Prefer `class`/`style` bindings:** Use `[class]` and `[style]` bindings instead of `NgClass`/`NgStyle` for performance and clarity.
- **Event handler naming:** Name handlers for what they do, not the event (e.g., `saveUserData()` instead of `handleClick()`).
- **Lifecycle hooks:** Keep lifecycle methods simple; delegate logic to named methods.
- **Lifecycle interfaces:** Implement TypeScript interfaces for lifecycle hooks (e.g., `OnInit`).

### Access Modifiers & Return Types

- **Always use explicit modifiers:** Every variable and method must have an access modifier (`private`, `protected`, `public`, or `readonly`). Never leave members with implicit/default access.
- **Always specify return types on methods:** Every method must have an explicit return type (e.g., `void`, `string`, `Observable<Product[]>`). Do not rely on type inference for method return types.
- **Combine `readonly` with access modifiers:** For immutable properties, use both an access modifier and `readonly` (e.g., `private readonly`, `protected readonly`).
- **Use `protected` for template-bound members:** Members accessed only in the component template should be `protected`.
- **Use `private` for internal logic:** Members not accessed in the template or by subclasses should be `private`.
- **Use `public` sparingly:** Only use `public` for members that are part of the component's public API (accessed by parent components or external code).

**Example:**

```typescript
// ✓ Correct — explicit modifiers and return types
private readonly authService = inject(AuthService);
protected readonly isLoading = signal(false);

public ngOnInit(): void {
  this.loadData();
}

protected submitForm(): void {
  this.authService.login(this.form.value);
}

private loadData(): void {
  this.isLoading.set(true);
  // ...
}

private formatDate(date: Date): string {
  return date.toISOString();
}

// ✗ Incorrect — missing modifiers and return types
authService = inject(AuthService);
isLoading = signal(false);

ngOnInit() {
  this.loadData();
}

submitForm() {
  this.authService.login(this.form.value);
}

loadData() {
  this.isLoading.set(true);
}
```

### Class Member Ordering

Organize class members in a consistent, predictable order. Group by purpose and modifier, with lifecycle methods always first.

**Ordering rules:**

1. **Injected dependencies** (`private readonly` / `protected readonly` via `inject()`)
2. **Inputs, outputs, and queries** (`readonly input()`, `readonly output()`, `readonly viewChild()`)
3. **Public properties**
4. **Protected properties** (template-bound signals, computed, form groups, etc.)
5. **Private properties**
6. **Lifecycle methods** (`ngOnInit`, `ngOnChanges`, `ngOnDestroy`, etc.) — always come before other methods
7. **Public methods**
8. **Protected methods** (template event handlers, etc.)
9. **Private helper methods**

**Example:**

```typescript
@Component({ ... })
export class ProductEditorComponent implements OnInit, OnDestroy {
  // 1. Injected dependencies
  private readonly productService = inject(ProductService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // 2. Inputs, outputs, queries
  public readonly productId = input.required<number>();
  public readonly saved = output<Product>();

  // 3-5. Properties grouped by modifier
  protected readonly isLoading = signal(false);
  protected readonly form = new FormGroup({
    name: new FormControl('', Validators.required),
    price: new FormControl(0),
  });
  private previousValues: Partial<Product> | null = null;

  // 6. Lifecycle methods — always first among methods
  public ngOnInit(): void {
    this.loadProduct();
  }

  public ngOnDestroy(): void {
    this.cleanup();
  }

  // 7. Public methods
  // (none in this example)

  // 8. Protected methods (template handlers)
  protected submitForm(): void {
    if (!this.form.valid) {
      return;
    }

    this.productService.update(this.form.value);
    this.saved.emit(this.form.value as Product);
  }

  protected resetForm(): void {
    this.form.reset(this.previousValues);
  }

  // 9. Private helper methods
  private loadProduct(): void {
    this.isLoading.set(true);
    this.productService.getById(this.productId()).subscribe((p) => {
      this.previousValues = p;
      this.form.patchValue(p);
      this.isLoading.set(false);
    });
  }

  private cleanup(): void {
    // teardown logic
  }
}
```

## Styling

- **Prefer Tailwind CSS & DaisyUI:** Use Tailwind utility classes and DaisyUI components for styles whenever possible instead of creating new custom CSS.
- **Minimal component styles:** Only add component-scoped CSS when utility classes cannot express the required design.
- **Design tokens & theme:** Use the project's `tailwind.config.js` and DaisyUI themes for colors, spacing, and typography rather than hard-coded values.
- **Responsive utilities:** Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`) instead of hand-written media queries.
- **Accessibility:** Keep focus and contrast in mind; prefer DaisyUI components that follow accessible patterns and verify interactive controls have visible focus styles.
- **Reuse & extraction:** If a utility combination repeats, extract it to a reusable class or use `@apply` in a CSS file to keep templates readable.

## Editor Shortcuts & Code Hygiene

- **Format documents:** Always format files before committing. In VS Code use the shortcut `Alt+Shift+F` to format the current file.
- **Organize imports:** Use `Alt+Shift+O` to organize and remove unused imports in the current file.
- **Remove unused code:** Remove unused declarations, methods, and parameters. Prefer enabling TypeScript checks (`noUnusedLocals`, `noUnusedParameters`) in `tsconfig.json` and fix reported issues before committing.
  - **Why:** Removing dead code reduces maintenance burden and avoids compiler and lint warnings.
  - **How:** Use your editor's quick-fix actions, `tsc`, or automated tools (e.g., `eslint --fix`) to locate and remove unused symbols.

## Error Checking & Linting

**MANDATORY for every request:**

1. **Build the project** after making changes:

   ```bash
   npx ng build --configuration=development
   ```

   - Verify exit code is 0 (success)
   - Resolve ALL TypeScript compilation errors
   - No partial solutions — builds must be clean

2. **Check for lint errors:**
   - Run linter to catch style and logic issues
   - Fix all reported issues before completing work
   - Use `eslint --fix` for auto-fixable issues when appropriate

3. **Verify template compilation:**
   - Ensure all Angular template syntax is valid
   - Check for undefined properties and invalid bindings
   - Validate event handlers and directives match component code

4. **Test import paths:**
   - Verify all `import` statements resolve correctly
   - Check for circular dependencies
   - Ensure path aliases (`@core/`, `@shared/`, etc.) are valid

5. **Manual code review:**
   - Scan for unused variables, parameters, or methods
   - Check for unreachable code paths
   - Verify error handling is complete
   - Ensure console.error/log statements are removed (except in services)

**Workflow:**

- Make code changes
- Format with `Alt+Shift+F`
- Organize imports with `Alt+Shift+O`
- Run `npx ng build --configuration=development`
- Fix any errors until build succeeds
- Only then mark task as complete

**Why:** Catching errors early prevents broken builds in commits, ensures consistency, and maintains code quality standards.

## Additional Resources

- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
- [Angular Security Best Practices](https://angular.dev/best-practices/security)
- [Angular Accessibility Guide](https://angular.dev/best-practices/a11y)

---

_Last updated: February 6, 2026_

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

### Commit Strategy: Group by Logical Changes

**NEVER commit all changes at once.** Break large refactorings and features into logical, focused commits:

1. **Group related updates together:**
   - Commit all updates to a single service together
   - Commit all usages of a service together
   - Commit component changes together
   - **When the same type of change spans multiple files, group them into one commit** (e.g., adding access modifiers to all management components = one commit, not one per file)

2. **Separate concerns:**
   - Model changes in one commit
   - Service changes in another
   - Component implementations in separate commits
   - Index/export updates in their own commit
   - Style/UI changes last

3. **Group by change type, not by file:**
   - If multiple files receive the **same kind of change** (e.g., adding modifiers, renaming a method, updating imports), batch them into a single commit
   - If a single file receives **different kinds of changes** (e.g., a new feature + a style fix), split them into separate commits
   - The goal: each commit represents **one logical change** that can be described in a single subject line

4. **Example workflow:**

   ```
   Commit 1: Update product.models.ts - Add code field to DTOs
   Commit 2: Update product.service.ts - Add code field handling
   Commit 3: Update product-editor.ts - Implement code FormControl
   Commit 4: Update product-details.ts - Display code field
   Commit 5: Update shared/components/index.ts - Export new components
   Commit 6: Refactor alert system - Remove repetitive alerts
   Commit 7: Update templates - Integrate global alert
   ```

   **Grouping example (same change across files):**

   ```
   # ✓ Correct — one commit for the same change type across files
   git add src/app/features/management/customers/**
   git add src/app/features/management/products/**
   git add src/app/features/management/users/**
   git commit -m "Add access modifiers to management components"

   # ✗ Incorrect — separate commits for the same change per file
   git commit -m "Add modifiers to customer-list"
   git commit -m "Add modifiers to product-list"
   git commit -m "Add modifiers to user-list"
   ```

5. **Use git add with file paths:**
   - `git add src/app/core/services/product.service.ts` (single file)
   - `git add src/app/features/products/**` (feature changes only)
   - Avoid `git add .` (commits everything indiscriminately)

6. **Why this matters:**
   - Easier to review: reviewers can understand each commit's purpose
   - Easier to revert: remove one change without affecting others
   - Git history is cleaner: bisecting for bugs becomes tractable
   - Follows Git best practices and professional standards

---
