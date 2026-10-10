@echo off
echo ============================================================
echo  Scaffolding DbContext and Entities
echo ============================================================

dotnet ef dbcontext scaffold "Name=ConnectionStrings:WtfDb" Microsoft.EntityFrameworkCore.SqlServer ^
 -o Entities ^
 --context WTFDbContext ^
 --context-dir Data ^
 --project ..\src\WTF.Domain\WTF.Domain.csproj ^
 --startup-project ..\src\WTF.Api\WTF.Api.csproj ^
 --force

if errorlevel 1 (
    echo.
    echo ============================================================
    echo  Scaffolding FAILED. Check the errors above.
    echo  If the API is running in the debugger, stop it and try again.
    echo ============================================================
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Scaffolding completed successfully.
echo ============================================================
pause
