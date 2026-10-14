# WTF (Wake. Taste. Focus)

Project overview, architecture, conventions and the feature roadmap live in the files below. Read them rather than
guessing; they are the single source of truth, shared with GitHub Copilot.

@.github/copilot-instructions.md
@docs/ROADMAP.md

## C# files: always run the cleanup skill

After creating or editing any `.cs` file, run the **`dotnet-cs-cleanup`** skill on the files you touched, before
reporting the task as done. It removes unused usings, sorts them, and formats the file (`dotnet format`), in that order.

- Only the `.cs` files changed in the task (find them with `git diff --name-only` plus untracked files). Never the whole
  solution unless asked. Skip generated code and `Migrations/`.
- The rules it applies are in the root `.editorconfig`. Change the style there, not in ad hoc edits.
- Finish with `dotnet build` and report anything that failed. Cleanup must not change behavior.
- This machine has no Python, so the skill's `sort_usings.py` cannot run. Do the same sorting with perl instead: plain
  A-Z order, no System-first rule, exact duplicates removed, byte-order mark and line endings kept.

## Calculations live in one place

Any total, average, percentage, "what counts as a sale" rule or promotion price belongs in `src/WTF.Calculations`
(API side) or `src/wtf-pos/src/app/shared/calculations` (Angular side), never inline in a handler or component.

- The two sides are tested against the same sample file, `shared/calculations/calculation-cases.json`. The Angular specs
  load it, and `WTF.Tests/Calculations/SharedCasesTests.cs` loads it too. Change a rule and its answers in that file, and
  both test runs must pass.
- All tests for `WTF.Calculations` stay in `WTF.Tests`.
- The API is the authority for saved orders. The POS only previews cart totals (it must work offline).
- The Angular side does money in whole cents (`money.ts`) so it matches the API's decimal arithmetic exactly.

## Checking the running app: the Playwright skill

To check behavior in a real browser (calculations on screen, flows, layout), use the **`playwright-skill`** plugin skill
rather than describing what the UI should do.

- Never point the app at the real `WTF` database on `.\SQLEXPRESS`. Run the API against a throwaway LocalDB database
  (`ConnectionStrings__WtfDb` environment variable) seeded with known data, so every number on screen can be checked
  against a hand-worked answer.
- The API runs on `http://localhost:5282` (`dotnet run --no-launch-profile --urls http://localhost:5282` in
  `src/WTF.Api`) and the app on `http://localhost:4200` (`npx ng serve` in `src/wtf-pos`). The browser time zone must be
  `Asia/Manila`, because reports group by the shop's local day.
- Use test accounts created for the throwaway database only. Keep their credentials out of chat and out of the repo.
- Save reusable Playwright scripts outside the repo unless asked to keep them.

## Working in this repo

- Run the .NET tests with `dotnet test src/WTF.Tests` and the Angular ones with `npx ng test --watch=false` from
  `src/wtf-pos` (add `--include <spec file>` to run one).
- Many source files use CRLF line endings. When editing with scripts, normalize to one style first and restore it, or
  use the Edit tool.
- Update `docs/ROADMAP.md` when a feature's status or design changes.
