# .NET 10.0 Upgrade Plan

## Execution Steps

Execute steps below sequentially one by one in the order they are listed.

1. Validate that a .NET 10.0 SDK required for this upgrade is installed on the machine and if not, help to get it installed.
2. Ensure that the SDK version specified in global.json files is compatible with the .NET 10.0 upgrade.
3. Upgrade WTF.Contracts.csproj
4. Upgrade WTF.Domain.csproj
5. Upgrade WTF.UI.csproj
6. Upgrade WTF.Api.csproj

## Settings

This section contains settings and data used by execution steps.

### Aggregate NuGet packages modifications across all projects

NuGet packages used across all selected projects or their dependencies that need version update in projects that reference them.

| Package Name                                      | Current Version | New Version | Description                                   |
|:--------------------------------------------------|:---------------:|:-----------:|:----------------------------------------------|
| Microsoft.AspNetCore.Authentication.JwtBearer     | 9.0.9           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.AspNetCore.Components.WebAssembly       | 9.0.8           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.AspNetCore.Components.WebAssembly.DevServer | 9.0.8       | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.AspNetCore.OpenApi                      | 9.0.8           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.EntityFrameworkCore                     | 9.0.8           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.EntityFrameworkCore.Design              | 9.0.8           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.EntityFrameworkCore.SqlServer           | 9.0.8           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.EntityFrameworkCore.Tools               | 9.0.8           | 10.0.0      | Recommended for .NET 10.0                     |
| Microsoft.Extensions.Http                         | 9.0.9           | 10.0.0      | Recommended for .NET 10.0                     |

### Project upgrade details
This section contains details about each project upgrade and modifications that need to be done in the project.

#### WTF.Contracts.csproj modifications

Project properties changes:
  - Target framework should be changed from `net9.0` to `net10.0`

#### WTF.Domain.csproj modifications

Project properties changes:
  - Target framework should be changed from `net9.0` to `net10.0`

NuGet packages changes:
  - Microsoft.EntityFrameworkCore should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)
  - Microsoft.EntityFrameworkCore.SqlServer should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)
  - Microsoft.EntityFrameworkCore.Tools should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)

#### WTF.UI.csproj modifications

Project properties changes:
  - Target framework should be changed from `net9.0` to `net10.0`

NuGet packages changes:
  - Microsoft.AspNetCore.Components.WebAssembly should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)
  - Microsoft.AspNetCore.Components.WebAssembly.DevServer should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)
  - Microsoft.Extensions.Http should be updated from `9.0.9` to `10.0.0` (*recommended for .NET 10.0*)

#### WTF.Api.csproj modifications

Project properties changes:
  - Target framework should be changed from `net9.0` to `net10.0`

NuGet packages changes:
  - Microsoft.AspNetCore.Authentication.JwtBearer should be updated from `9.0.9` to `10.0.0` (*recommended for .NET 10.0*)
  - Microsoft.AspNetCore.OpenApi should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)
  - Microsoft.EntityFrameworkCore.Design should be updated from `9.0.8` to `10.0.0` (*recommended for .NET 10.0*)
