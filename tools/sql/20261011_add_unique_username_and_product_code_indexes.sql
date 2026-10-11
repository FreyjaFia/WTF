SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Usernames and product codes must be unique. The application now rejects duplicates itself (create and update
-- user, create and update product), but nothing in the database stopped them, so two requests at the same moment
-- could still store the same name. These unique indexes are the last line of defense.
--
--   UX_Users_Username  - one account per username
--   UX_Products_Code   - one product per code
--
-- Both cover every row, including deactivated (soft-deleted) users and products, which matches the application
-- checks: a deleted user's name and a deleted product's code stay reserved until they are restored. Uniqueness
-- follows the column collation, so the match is case-insensitive.
--
-- The script is safe to run more than once. If duplicates already exist it lists them and stops with an error
-- without changing anything; resolve them (rename or remove one of each pair) and run the script again.
--
-- To look at the duplicates yourself first:
--   SELECT Username, COUNT(*) AS Occurrences FROM dbo.Users GROUP BY Username HAVING COUNT(*) > 1;
--   SELECT Code, COUNT(*) AS Occurrences FROM dbo.Products GROUP BY Code HAVING COUNT(*) > 1;
IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_Username' AND object_id = OBJECT_ID(N'dbo.Users'))
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Users GROUP BY Username HAVING COUNT(*) > 1)
    BEGIN
        SELECT Username, COUNT(*) AS Occurrences FROM dbo.Users GROUP BY Username HAVING COUNT(*) > 1;
        THROW 50001, N'Cannot create UX_Users_Username: duplicate usernames exist (listed above). Rename or remove the duplicates, then run this script again.', 1;
    END;

    CREATE UNIQUE NONCLUSTERED INDEX UX_Users_Username ON dbo.Users (Username);
END;
GO

IF OBJECT_ID(N'dbo.Products', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Products_Code' AND object_id = OBJECT_ID(N'dbo.Products'))
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Products GROUP BY Code HAVING COUNT(*) > 1)
    BEGIN
        SELECT Code, COUNT(*) AS Occurrences FROM dbo.Products GROUP BY Code HAVING COUNT(*) > 1;
        THROW 50002, N'Cannot create UX_Products_Code: duplicate product codes exist (listed above). Rename or remove the duplicates, then run this script again.', 1;
    END;

    CREATE UNIQUE NONCLUSTERED INDEX UX_Products_Code ON dbo.Products (Code);
END;
GO
