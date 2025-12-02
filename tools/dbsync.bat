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

echo.
echo ============================================================
echo  Scaffolding completed successfully.
echo ============================================================
