SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Dynamic catalog: categories, sub-categories and add-on types become editable lists.
-- Existing rows keep their ids (1-4 and 1-5), so every product and add-on link stays valid. Safe to run more than once.

-- ProductCategory
IF COL_LENGTH(N'dbo.ProductCategories', N'SortOrder') IS NULL
    ALTER TABLE dbo.ProductCategories ADD SortOrder int NOT NULL CONSTRAINT DF_ProductCategories_SortOrder DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.ProductCategories', N'IsActive') IS NULL
    ALTER TABLE dbo.ProductCategories ADD IsActive bit NOT NULL CONSTRAINT DF_ProductCategories_IsActive DEFAULT (1);
GO
IF COL_LENGTH(N'dbo.ProductCategories', N'CreatedAt') IS NULL
    ALTER TABLE dbo.ProductCategories ADD CreatedAt datetime2 NOT NULL CONSTRAINT DF_ProductCategories_CreatedAt DEFAULT (SYSUTCDATETIME());
GO
IF COL_LENGTH(N'dbo.ProductCategories', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.ProductCategories ADD UpdatedAt datetime2 NULL;
GO
UPDATE dbo.ProductCategories SET SortOrder = Id WHERE SortOrder = 0;
GO

-- ProductSubCategory (+ parent category)
IF COL_LENGTH(N'dbo.ProductSubCategories', N'SortOrder') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD SortOrder int NOT NULL CONSTRAINT DF_ProductSubCategories_SortOrder DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.ProductSubCategories', N'IsActive') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD IsActive bit NOT NULL CONSTRAINT DF_ProductSubCategories_IsActive DEFAULT (1);
GO
IF COL_LENGTH(N'dbo.ProductSubCategories', N'CreatedAt') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD CreatedAt datetime2 NOT NULL CONSTRAINT DF_ProductSubCategories_CreatedAt DEFAULT (SYSUTCDATETIME());
GO
IF COL_LENGTH(N'dbo.ProductSubCategories', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD UpdatedAt datetime2 NULL;
GO
IF COL_LENGTH(N'dbo.ProductSubCategories', N'CategoryId') IS NULL
    ALTER TABLE dbo.ProductSubCategories ADD CategoryId int NULL;
GO
UPDATE dbo.ProductSubCategories SET SortOrder = Id WHERE SortOrder = 0;
GO
-- Parent category from current usage: the category most products of the sub-category already use.
UPDATE s SET CategoryId = x.CategoryId
FROM dbo.ProductSubCategories s
CROSS APPLY (SELECT TOP 1 p.CategoryId FROM dbo.Products p WHERE p.SubCategoryId = s.Id
             GROUP BY p.CategoryId ORDER BY COUNT(*) DESC) x
WHERE s.CategoryId IS NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductSubCategories_Category')
    ALTER TABLE dbo.ProductSubCategories ADD CONSTRAINT FK_ProductSubCategories_Category
        FOREIGN KEY (CategoryId) REFERENCES dbo.ProductCategories (Id);
GO

-- AddOnType (+ selection rules)
IF COL_LENGTH(N'dbo.AddOnType', N'IsRequired') IS NULL
    ALTER TABLE dbo.AddOnType ADD IsRequired bit NOT NULL CONSTRAINT DF_AddOnType_IsRequired DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.AddOnType', N'MinSelect') IS NULL
    ALTER TABLE dbo.AddOnType ADD MinSelect int NOT NULL CONSTRAINT DF_AddOnType_MinSelect DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.AddOnType', N'MaxSelect') IS NULL
    ALTER TABLE dbo.AddOnType ADD MaxSelect int NOT NULL CONSTRAINT DF_AddOnType_MaxSelect DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.AddOnType', N'SortOrder') IS NULL
    ALTER TABLE dbo.AddOnType ADD SortOrder int NOT NULL CONSTRAINT DF_AddOnType_SortOrder DEFAULT (0);
GO
IF COL_LENGTH(N'dbo.AddOnType', N'IsActive') IS NULL
    ALTER TABLE dbo.AddOnType ADD IsActive bit NOT NULL CONSTRAINT DF_AddOnType_IsActive DEFAULT (1);
GO
IF COL_LENGTH(N'dbo.AddOnType', N'CreatedAt') IS NULL
    ALTER TABLE dbo.AddOnType ADD CreatedAt datetime2 NOT NULL CONSTRAINT DF_AddOnType_CreatedAt DEFAULT (SYSUTCDATETIME());
GO
IF COL_LENGTH(N'dbo.AddOnType', N'UpdatedAt') IS NULL
    ALTER TABLE dbo.AddOnType ADD UpdatedAt datetime2 NULL;
GO
-- The rules the code applied until now: Size and Flavor are pick exactly one when a product offers them, Sauce is at most one.
UPDATE dbo.AddOnType SET SortOrder = Id WHERE SortOrder = 0;
UPDATE dbo.AddOnType SET IsRequired = 1, MinSelect = 1, MaxSelect = 1 WHERE Id IN (1, 2) AND MaxSelect = 0 AND IsRequired = 0;
UPDATE dbo.AddOnType SET MaxSelect = 1 WHERE Id = 5 AND MaxSelect = 0;
GO
