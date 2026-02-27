SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 4)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Name = N'SuperAdmin')
    BEGIN
        INSERT INTO dbo.UserRoles (Id, Name)
        VALUES (4, N'SuperAdmin');
    END
END
GO

IF EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 4)
BEGIN
    UPDATE dbo.UserRoles
    SET Name = N'SuperAdmin'
    WHERE Id = 4
      AND Name <> N'SuperAdmin';
END
GO

DECLARE @SuperAdminRoleId INT;
SELECT TOP (1) @SuperAdminRoleId = Id
FROM dbo.UserRoles
WHERE Name = N'SuperAdmin'
ORDER BY CASE WHEN Id = 4 THEN 0 ELSE 1 END, Id;

IF @SuperAdminRoleId IS NOT NULL
BEGIN
    UPDATE dbo.Users
    SET RoleId = @SuperAdminRoleId
    WHERE Username = N'admin'
      AND RoleId <> @SuperAdminRoleId;
END
GO
