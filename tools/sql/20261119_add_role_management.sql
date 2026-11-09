SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- RBAC phase 3: custom roles. The six built-in roles stay as they are (TenantId NULL, IsSystem = 1) and their
-- permissions live in code. A custom role belongs to one shop (TenantId) and keeps its permission keys in
-- RolePermissions. Matches built-in roles by name, never by id. Safe to run twice; no existing row is changed
-- except the IsSystem flag on the six built-in roles.

IF COL_LENGTH('dbo.UserRoles', 'TenantId') IS NULL
BEGIN
    ALTER TABLE dbo.UserRoles ADD TenantId uniqueidentifier NULL;
END
GO

IF COL_LENGTH('dbo.UserRoles', 'IsSystem') IS NULL
BEGIN
    ALTER TABLE dbo.UserRoles ADD IsSystem bit NOT NULL CONSTRAINT DF_UserRoles_IsSystem DEFAULT (0);
END
GO

IF COL_LENGTH('dbo.UserRoles', 'Description') IS NULL
BEGIN
    ALTER TABLE dbo.UserRoles ADD Description nvarchar(200) NULL;
END
GO

IF COL_LENGTH('dbo.UserRoles', 'CreatedAt') IS NULL
BEGIN
    ALTER TABLE dbo.UserRoles ADD CreatedAt datetime2(7) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_UserRoles_Tenants')
BEGIN
    ALTER TABLE dbo.UserRoles ADD CONSTRAINT FK_UserRoles_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id);
END
GO

-- Names were varchar(30) and globally unique. Custom names are nvarchar(50), unique per shop and never equal to a
-- built-in name (the API checks that part).
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_UserRoles_Name' AND object_id = OBJECT_ID('dbo.UserRoles'))
BEGIN
    ALTER TABLE dbo.UserRoles DROP CONSTRAINT UQ_UserRoles_Name;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UserRoles') AND name = 'Name' AND max_length = 30)
BEGIN
    ALTER TABLE dbo.UserRoles ALTER COLUMN Name nvarchar(50) NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UserRoles_SystemName' AND object_id = OBJECT_ID('dbo.UserRoles'))
BEGIN
    CREATE UNIQUE INDEX UX_UserRoles_SystemName ON dbo.UserRoles (Name) WHERE TenantId IS NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UserRoles_TenantName' AND object_id = OBJECT_ID('dbo.UserRoles'))
BEGIN
    CREATE UNIQUE INDEX UX_UserRoles_TenantName ON dbo.UserRoles (TenantId, Name) WHERE TenantId IS NOT NULL;
END
GO

UPDATE dbo.UserRoles
SET IsSystem = 1
WHERE TenantId IS NULL
  AND IsSystem = 0
  AND Name IN (N'Owner', N'Admin', N'Cashier', N'AdminViewer', N'ItemManager', N'StockManager');
GO

IF OBJECT_ID('dbo.RolePermissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.RolePermissions
    (
        RoleId int NOT NULL,
        PermissionKey nvarchar(100) NOT NULL,
        CONSTRAINT PK_RolePermissions PRIMARY KEY (RoleId, PermissionKey),
        CONSTRAINT FK_RolePermissions_UserRoles FOREIGN KEY (RoleId) REFERENCES dbo.UserRoles (Id) ON DELETE CASCADE
    );
END
GO

-- Ids of custom roles come from this sequence; built-in roles use 1 to 99.
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'UserRoleIdSeq')
BEGIN
    CREATE SEQUENCE dbo.UserRoleIdSeq AS int START WITH 100 INCREMENT BY 1;
END
GO
