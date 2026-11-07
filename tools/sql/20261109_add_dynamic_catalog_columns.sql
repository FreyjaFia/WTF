SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Dynamic catalog: categories, sub-categories and add-on types become editable lists.
-- Safe to run more than once and on any copy of the data:
--   * every column is added only when it is missing, and the values derived for it are written only in that same step,
--     so a later run never overwrites what the owner has edited since;
--   * nothing is renamed, deleted or re-numbered: existing rows keep their ids, so every product and add-on link stays valid;
--   * each table is done in one transaction, so a failure leaves it exactly as it was.
-- The seeded rules match rows by id AND name, so a database whose ids or names differ is left alone.

-- ProductCategories
BEGIN TRAN;
IF COL_LENGTH(N'dbo.ProductCategories', N'SortOrder') IS NULL
BEGIN
    ALTER TABLE dbo.ProductCategories ADD SortOrder int NOT NULL CONSTRAINT DF_ProductCategories_SortOrder DEFAULT (0);
    EXEC (N'UPDATE dbo.ProductCategories SET SortOrder = Id');
END
IF COL_LENGTH(N'dbo.ProductCategories', N'IsActive') IS NULL
    ALTER TABLE dbo.ProductCategories ADD IsActive bit NOT NULL CONSTRAINT DF_ProductCategories_IsActive DEFAULT (1);
IF COL_LENGTH(N'dbo.ProductCategories', N'CreatedAt') IS NULL
    ALTER TABLE dbo.ProductCategories ADD CreatedAt datetime2 NOT NULL CONSTRAINT DF_ProductCategories_CreatedAt DEFAULT (SYSUTCDATETIME());
IF COL_LENGTH(N'dbo.ProductCategories', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.ProductCategories ADD UpdatedAt datetime2 NULL;
COMMIT;
GO

-- ProductSubCategories (+ parent category)
BEGIN TRAN;
IF COL_LENGTH(N'dbo.ProductSubCategories', N'SortOrder') IS NULL
BEGIN
    ALTER TABLE dbo.ProductSubCategories ADD SortOrder int NOT NULL CONSTRAINT DF_ProductSubCategories_SortOrder DEFAULT (0);
    EXEC (N'UPDATE dbo.ProductSubCategories SET SortOrder = Id');
END
IF COL_LENGTH(N'dbo.ProductSubCategories', N'IsActive') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD IsActive bit NOT NULL CONSTRAINT DF_ProductSubCategories_IsActive DEFAULT (1);
IF COL_LENGTH(N'dbo.ProductSubCategories', N'CreatedAt') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD CreatedAt datetime2 NOT NULL CONSTRAINT DF_ProductSubCategories_CreatedAt DEFAULT (SYSUTCDATETIME());
IF COL_LENGTH(N'dbo.ProductSubCategories', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD UpdatedAt datetime2 NULL;
IF COL_LENGTH(N'dbo.ProductSubCategories', N'CategoryId') IS NULL
BEGIN
    ALTER TABLE dbo.ProductSubCategories ADD CategoryId int NULL;
    -- Parent category from current usage: the category most products of the sub-category already use.
    -- A sub-category no product uses stays without a parent; the owner picks one on the Catalog page.
    EXEC (N'UPDATE s SET CategoryId = x.CategoryId
            FROM dbo.ProductSubCategories s
            CROSS APPLY (SELECT TOP 1 p.CategoryId FROM dbo.Products p WHERE p.SubCategoryId = s.Id
                         GROUP BY p.CategoryId ORDER BY COUNT(*) DESC, p.CategoryId) x');
END
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductSubCategories_Category')
    ALTER TABLE dbo.ProductSubCategories ADD CONSTRAINT FK_ProductSubCategories_Category
        FOREIGN KEY (CategoryId) REFERENCES dbo.ProductCategories (Id);
COMMIT;
GO

-- AddOnType (+ selection rules)
BEGIN TRAN;
IF COL_LENGTH(N'dbo.AddOnType', N'IsRequired') IS NULL
BEGIN
    ALTER TABLE dbo.AddOnType ADD IsRequired bit NOT NULL CONSTRAINT DF_AddOnType_IsRequired DEFAULT (0);
    ALTER TABLE dbo.AddOnType ADD MinSelect int NOT NULL CONSTRAINT DF_AddOnType_MinSelect DEFAULT (0);
    ALTER TABLE dbo.AddOnType ADD MaxSelect int NOT NULL CONSTRAINT DF_AddOnType_MaxSelect DEFAULT (0);
    -- The rules the code applied until now: Size and Flavor are pick exactly one, Sauce is at most one.
    EXEC (N'UPDATE dbo.AddOnType SET IsRequired = 1, MinSelect = 1, MaxSelect = 1
            WHERE (Id = 1 AND Name = N''Size'') OR (Id = 2 AND Name = N''Flavor'');
            UPDATE dbo.AddOnType SET MaxSelect = 1 WHERE Id = 5 AND Name = N''Sauce'';');
END
IF COL_LENGTH(N'dbo.AddOnType', N'SortOrder') IS NULL
BEGIN
    ALTER TABLE dbo.AddOnType ADD SortOrder int NOT NULL CONSTRAINT DF_AddOnType_SortOrder DEFAULT (0);
    -- The display order the screens used until now (Size, Flavor, Sauce, Topping, Extra); any other type goes after them in id order.
    EXEC (N'UPDATE dbo.AddOnType SET SortOrder = CASE
                WHEN Id = 1 AND Name = N''Size'' THEN 1 WHEN Id = 2 AND Name = N''Flavor'' THEN 2
                WHEN Id = 5 AND Name = N''Sauce'' THEN 3 WHEN Id = 3 AND Name = N''Topping'' THEN 4
                WHEN Id = 4 AND Name = N''Extra'' THEN 5 ELSE 100 + Id END');
END
IF COL_LENGTH(N'dbo.AddOnType', N'IsActive') IS NULL
    ALTER TABLE dbo.AddOnType ADD IsActive bit NOT NULL CONSTRAINT DF_AddOnType_IsActive DEFAULT (1);
IF COL_LENGTH(N'dbo.AddOnType', N'CreatedAt') IS NULL
    ALTER TABLE dbo.AddOnType ADD CreatedAt datetime2 NOT NULL CONSTRAINT DF_AddOnType_CreatedAt DEFAULT (SYSUTCDATETIME());
IF COL_LENGTH(N'dbo.AddOnType', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.AddOnType ADD UpdatedAt datetime2 NULL;
COMMIT;
GO
