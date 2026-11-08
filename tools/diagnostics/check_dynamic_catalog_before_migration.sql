-- READ ONLY. Changes nothing: it only runs SELECT statements and PRINTs.
-- Run it on the production database BEFORE tools/sql/20261109_add_dynamic_catalog_columns.sql, in SSMS or sqlcmd,
-- and send back (or keep) the output. It shows what that migration will find and what it will derive.
-- Written against the schema of release v1.19.0, where ProductCategories, ProductSubCategories and AddOnType
-- have only Id and Name. The migration needs none of the scripts that came after v1.19.0.
SET NOCOUNT ON;

PRINT '=== 1. Is the migration needed? ===';
SELECT 'ProductCategories' AS TableName,
       CASE WHEN COL_LENGTH(N'dbo.ProductCategories', N'SortOrder') IS NULL THEN 'old shape (migration will add columns)' ELSE 'already migrated' END AS State
UNION ALL SELECT 'ProductSubCategories',
       CASE WHEN COL_LENGTH(N'dbo.ProductSubCategories', N'CategoryId') IS NULL THEN 'old shape (migration will add columns)' ELSE 'already migrated' END
UNION ALL SELECT 'AddOnType',
       CASE WHEN COL_LENGTH(N'dbo.AddOnType', N'IsRequired') IS NULL THEN 'old shape (migration will add columns)' ELSE 'already migrated' END;

PRINT '=== 2. Tables and columns the migration reads ===';
SELECT 'dbo.Products.CategoryId' AS Needed, CASE WHEN COL_LENGTH(N'dbo.Products', N'CategoryId') IS NULL THEN 'MISSING' ELSE 'ok' END AS State
UNION ALL SELECT 'dbo.Products.SubCategoryId', CASE WHEN COL_LENGTH(N'dbo.Products', N'SubCategoryId') IS NULL THEN 'MISSING' ELSE 'ok' END
UNION ALL SELECT 'dbo.ProductCategories.Name', CASE WHEN COL_LENGTH(N'dbo.ProductCategories', N'Name') IS NULL THEN 'MISSING' ELSE 'ok' END
UNION ALL SELECT 'dbo.ProductSubCategories.Name', CASE WHEN COL_LENGTH(N'dbo.ProductSubCategories', N'Name') IS NULL THEN 'MISSING' ELSE 'ok' END
UNION ALL SELECT 'dbo.ProductAddOns.AddOnTypeId', CASE WHEN COL_LENGTH(N'dbo.ProductAddOns', N'AddOnTypeId') IS NULL THEN 'MISSING' ELSE 'ok' END
UNION ALL SELECT 'dbo.AddOnType.Name', CASE WHEN COL_LENGTH(N'dbo.AddOnType', N'Name') IS NULL THEN 'MISSING' ELSE 'ok' END;

PRINT '=== 3. Categories (id, name, products using it) ===';
SELECT c.Id, c.Name, (SELECT COUNT(*) FROM dbo.Products p WHERE p.CategoryId = c.Id) AS Products
FROM dbo.ProductCategories c ORDER BY c.Id;

PRINT '=== 4. Sub-categories: products per category (the migration picks the parent from this) ===';
SELECT s.Id AS SubCategoryId, s.Name AS SubCategory, c.Id AS CategoryId, c.Name AS Category, COUNT(p.Id) AS Products
FROM dbo.ProductSubCategories s
LEFT JOIN dbo.Products p ON p.SubCategoryId = s.Id
LEFT JOIN dbo.ProductCategories c ON c.Id = p.CategoryId
GROUP BY s.Id, s.Name, c.Id, c.Name
ORDER BY s.Id, COUNT(p.Id) DESC;

PRINT '=== 5. Parent category the migration will give each sub-category (most used; ties go to the lower id; none if unused) ===';
SELECT s.Id AS SubCategoryId, s.Name AS SubCategory, x.CategoryId AS ParentCategoryId, c.Name AS ParentCategory,
       CASE WHEN x.CategoryId IS NULL THEN 'no products: stays without a parent, set it on the Catalog page'
            WHEN (SELECT COUNT(DISTINCT p.CategoryId) FROM dbo.Products p WHERE p.SubCategoryId = s.Id) > 1
                 THEN 'MIXED: products of this sub-category sit in several categories, check the parent after migrating'
            ELSE 'clear' END AS Note
FROM dbo.ProductSubCategories s
OUTER APPLY (SELECT TOP 1 p.CategoryId FROM dbo.Products p WHERE p.SubCategoryId = s.Id
             GROUP BY p.CategoryId ORDER BY COUNT(*) DESC, p.CategoryId) x
LEFT JOIN dbo.ProductCategories c ON c.Id = x.CategoryId
ORDER BY s.Id;

PRINT '=== 6. Add-on types and the rules the migration will seed ===';
-- Size (id 1) and Flavor (id 2) become required, pick exactly one; Sauce (id 5) becomes at most one. Matched by id AND name.
SELECT t.Id, t.Name,
       CASE WHEN t.Id = 1 AND t.Name = N'Size'   THEN 'required, exactly 1'
            WHEN t.Id = 2 AND t.Name = N'Flavor' THEN 'required, exactly 1'
            WHEN t.Id = 5 AND t.Name = N'Sauce'  THEN 'optional, at most 1'
            ELSE 'optional, any number' END AS RuleAfterMigration,
       CASE WHEN t.Id = 1 AND t.Name = N'Size' THEN 1 WHEN t.Id = 2 AND t.Name = N'Flavor' THEN 2
            WHEN t.Id = 5 AND t.Name = N'Sauce' THEN 3 WHEN t.Id = 3 AND t.Name = N'Topping' THEN 4
            WHEN t.Id = 4 AND t.Name = N'Extra' THEN 5 ELSE 100 + t.Id END AS SortOrderAfterMigration,
       (SELECT COUNT(*) FROM dbo.ProductAddOns pa WHERE pa.AddOnTypeId = t.Id) AS ProductAddOnLinks
FROM dbo.AddOnType t ORDER BY t.Id;

PRINT '=== 7. Warnings (an empty result is good) ===';
SELECT 'Standard add-on type missing or renamed: ' + n.Expected AS Warning
FROM (VALUES (1, N'Size'), (2, N'Flavor'), (3, N'Topping'), (4, N'Extra'), (5, N'Sauce')) n(Id, Expected)
WHERE NOT EXISTS (SELECT 1 FROM dbo.AddOnType t WHERE t.Id = n.Id AND t.Name = n.Expected)
UNION ALL
SELECT 'Products point to a missing category id ' + CAST(p.CategoryId AS varchar(20)) + ' (' + CAST(COUNT(*) AS varchar(20)) + ' products)'
FROM dbo.Products p WHERE NOT EXISTS (SELECT 1 FROM dbo.ProductCategories c WHERE c.Id = p.CategoryId) GROUP BY p.CategoryId
UNION ALL
SELECT 'Products point to a missing sub-category id ' + CAST(p.SubCategoryId AS varchar(20)) + ' (' + CAST(COUNT(*) AS varchar(20)) + ' products)'
FROM dbo.Products p WHERE p.SubCategoryId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.ProductSubCategories s WHERE s.Id = p.SubCategoryId) GROUP BY p.SubCategoryId
UNION ALL
SELECT 'Sub-category with no products: ' + s.Name FROM dbo.ProductSubCategories s
WHERE NOT EXISTS (SELECT 1 FROM dbo.Products p WHERE p.SubCategoryId = s.Id)
UNION ALL
SELECT 'The app treats sub-category id 4 as Retail, but id 4 is: ' + ISNULL((SELECT Name FROM dbo.ProductSubCategories WHERE Id = 4), '(missing)')
WHERE ISNULL((SELECT Name FROM dbo.ProductSubCategories WHERE Id = 4), '') <> N'Retail'
UNION ALL
SELECT 'The app treats category id 4 as Other (add-on products), but id 4 is: ' + ISNULL((SELECT Name FROM dbo.ProductCategories WHERE Id = 4), '(missing)')
WHERE ISNULL((SELECT Name FROM dbo.ProductCategories WHERE Id = 4), '') <> N'Other';

PRINT '=== 7b. Name problems the new Catalog page would reject (an empty result is good) ===';
SELECT 'Duplicate category name: ' + Name AS Problem FROM dbo.ProductCategories GROUP BY Name HAVING COUNT(*) > 1
UNION ALL SELECT 'Duplicate sub-category name: ' + Name FROM dbo.ProductSubCategories GROUP BY Name HAVING COUNT(*) > 1
UNION ALL SELECT 'Duplicate add-on type name: ' + Name FROM dbo.AddOnType GROUP BY Name HAVING COUNT(*) > 1
UNION ALL SELECT 'Blank or very long name (category/sub-category/add-on type id ' + CAST(Id AS varchar(20)) + ')' FROM dbo.ProductCategories WHERE LTRIM(RTRIM(Name)) = N'' OR LEN(Name) > 100
UNION ALL SELECT 'Blank or very long name (sub-category id ' + CAST(Id AS varchar(20)) + ')' FROM dbo.ProductSubCategories WHERE LTRIM(RTRIM(Name)) = N'' OR LEN(Name) > 100
UNION ALL SELECT 'Blank or very long name (add-on type id ' + CAST(Id AS varchar(20)) + ')' FROM dbo.AddOnType WHERE LTRIM(RTRIM(Name)) = N'' OR LEN(Name) > 100;

PRINT '=== 8. Scripts already recorded as applied on this database (latest 5) ===';
SELECT TOP (5) * FROM dbo.SchemaScriptHistory ORDER BY 1 DESC;
