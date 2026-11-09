SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Renames the SuperAdmin role to Owner (RBAC phase 1). Users keep their RoleId; only the stored name changes.
-- Matches by name, never by id. Does nothing if there is no SuperAdmin role or an Owner role already exists.
-- Tokens signed in before the rename still say SuperAdmin and are refused, so everyone signs in again.
-- Safe to run twice.

IF EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Name = N'SuperAdmin')
   AND NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Name = N'Owner')
BEGIN
    UPDATE dbo.UserRoles
    SET Name = N'Owner'
    WHERE Name = N'SuperAdmin';
END
GO
