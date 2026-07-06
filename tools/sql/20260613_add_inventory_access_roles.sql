SET NOCOUNT ON;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 5)
   AND NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Name = N'ItemManager')
BEGIN
    INSERT INTO dbo.UserRoles (Id, Name)
    VALUES (5, N'ItemManager');
END
GO

IF EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 5)
BEGIN
    UPDATE dbo.UserRoles
    SET Name = N'ItemManager'
    WHERE Id = 5
      AND Name <> N'ItemManager';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 6)
   AND NOT EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Name = N'StockManager')
BEGIN
    INSERT INTO dbo.UserRoles (Id, Name)
    VALUES (6, N'StockManager');
END
GO

IF EXISTS (SELECT 1 FROM dbo.UserRoles WHERE Id = 6)
BEGIN
    UPDATE dbo.UserRoles
    SET Name = N'StockManager'
    WHERE Id = 6
      AND Name <> N'StockManager';
END
GO
