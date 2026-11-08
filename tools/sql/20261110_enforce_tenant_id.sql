SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Multi-tenant support, step 3 of 3 (add, backfill, ENFORCE). Run it right before the API that knows about tenants is
-- deployed, after taking a backup, and only after 20261108 and 20261109 left no NULL TenantId.
--   1. Fails (and changes nothing for that table) if any tenant-owned row still has no TenantId.
--   2. TenantId becomes NOT NULL, with a foreign key to Tenants and a default of tenant #1. The default keeps the
--      previous API version able to insert rows during the deploy window; the new API always writes the tenant itself.
--      Drop the defaults in a later script once the old API is gone.
--   3. Unique indexes that were global become per tenant (TenantId first): Items Sku and Barcode, Products Code,
--      Orders OrderNumber and OfflineLocalId, WasteReasons Name. Secrets and ids stay global (link, refresh and push
--      tokens, usernames).
--   4. TenantCounters: the next order number per tenant. Tenant #1 continues from the OrderNumberSeq sequence (or the
--      highest number in use, if larger); a new tenant starts at 1. The sequence stays as the column default so the
--      previous API version still works.
-- Safe to run twice. Tables added after this script was written (for example Expenses) need the same treatment: add
-- them to the list below.

DECLARE @tables TABLE (Name SYSNAME NOT NULL);
INSERT INTO @tables (Name) VALUES
    ('AddOnType'),
    ('AuditLog'),
    ('ConversationMessages'),
    ('Conversations'),
    ('CustomerImages'),
    ('Customers'),
    ('DiscountedProductPromotionAddOns'),
    ('DiscountedProductPromotions'),
    ('Expenses'),
    ('FixedBundlePromotionItemAddOns'),
    ('FixedBundlePromotionItems'),
    ('FixedBundlePromotions'),
    ('Images'),
    ('ItemAlertRecipients'),
    ('ItemPriceHistory'),
    ('Items'),
    ('LoyaltyPoints'),
    ('MixMatchPromotionProductAddOns'),
    ('MixMatchPromotionProducts'),
    ('MixMatchPromotions'),
    ('Notifications'),
    ('OrderBundlePromotions'),
    ('OrderItems'),
    ('Orders'),
    ('ProductAddOnPriceOverrides'),
    ('ProductAddOns'),
    ('ProductCategories'),
    ('ProductImages'),
    ('ProductItemLinks'),
    ('ProductPriceHistory'),
    ('Products'),
    ('ProductSizeAmounts'),
    ('ProductSubCategories'),
    ('PromotionImages'),
    ('Promotions'),
    ('PushNotificationTokens'),
    ('RefreshTokens'),
    ('ShortLinks'),
    ('StockCountLines'),
    ('StockCounts'),
    ('StockMovements'),
    ('StockWastes'),
    ('UserImages'),
    ('Users'),
    ('WasteReasons')
;

DECLARE @tenantId UNIQUEIDENTIFIER = '00000000-0000-0000-0000-000000000001';
DECLARE @name SYSNAME, @sql NVARCHAR(MAX), @left INT;

IF NOT EXISTS (SELECT 1 FROM dbo.Tenants WHERE Id = @tenantId)
BEGIN
    THROW 50000, N'Tenant #1 is missing. Run 20261108_add_tenants.sql first.', 1;
END

DECLARE tenant_tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
OPEN tenant_tables;
FETCH NEXT FROM tenant_tables INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF COL_LENGTH(N'dbo.' + QUOTENAME(@name), N'TenantId') IS NULL
    BEGIN
        THROW 50000, N'A table has no TenantId column. Run 20261108_add_tenants.sql first.', 1;
    END

    SET @sql = N'SELECT @left = COUNT(*) FROM dbo.' + QUOTENAME(@name) + N' WHERE TenantId IS NULL';
    EXEC sys.sp_executesql @sql, N'@left INT OUTPUT', @left = @left OUTPUT;
    IF @left > 0
    BEGIN
        DECLARE @message NVARCHAR(200) = N'dbo.' + @name + N' still has rows without a TenantId. Run 20261109_backfill_tenant_id.sql.';
        THROW 50000, @message, 1;
    END

    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@name)) AND name = N'TenantId' AND is_nullable = 1)
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ALTER COLUMN TenantId UNIQUEIDENTIFIER NOT NULL;';
        EXEC sys.sp_executesql @sql;
    END

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints
                   WHERE parent_object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@name))
                     AND parent_column_id = COLUMNPROPERTY(OBJECT_ID(N'dbo.' + QUOTENAME(@name)), N'TenantId', 'ColumnId'))
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ADD CONSTRAINT ' + QUOTENAME(N'DF_' + @name + N'_TenantId')
            + N' DEFAULT (''00000000-0000-0000-0000-000000000001'') FOR TenantId;';
        EXEC sys.sp_executesql @sql;
    END

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_' + @name + N'_Tenants')
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ADD CONSTRAINT ' + QUOTENAME(N'FK_' + @name + N'_Tenants')
            + N' FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id);';
        EXEC sys.sp_executesql @sql;
    END

    FETCH NEXT FROM tenant_tables INTO @name;
END
CLOSE tenant_tables;
DEALLOCATE tenant_tables;
GO

-- Every query filters on TenantId, so the biggest tables get an index for it.
DECLARE @big TABLE (Name SYSNAME NOT NULL);
INSERT INTO @big (Name) VALUES ('Orders'), ('OrderItems'), ('AuditLog'), ('StockMovements'), ('Notifications'),
    ('ConversationMessages'), ('LoyaltyPoints'), ('Products'), ('Customers'), ('Items');

DECLARE @bigName SYSNAME, @bigSql NVARCHAR(MAX);
DECLARE big_tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @big;
OPEN big_tables;
FETCH NEXT FROM big_tables INTO @bigName;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'IX_' + @bigName + N'_TenantId' AND object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@bigName)))
    BEGIN
        SET @bigSql = N'CREATE NONCLUSTERED INDEX ' + QUOTENAME(N'IX_' + @bigName + N'_TenantId')
            + N' ON dbo.' + QUOTENAME(@bigName) + N' (TenantId);';
        EXEC sys.sp_executesql @bigSql;
    END

    FETCH NEXT FROM big_tables INTO @bigName;
END
CLOSE big_tables;
DEALLOCATE big_tables;
GO

-- Unique indexes become per tenant. A rebuild happens only when the index does not have TenantId yet.
DECLARE @indexes TABLE (TableName SYSNAME, IndexName SYSNAME, KeyColumns NVARCHAR(200), FilterSql NVARCHAR(200) NULL);
INSERT INTO @indexes (TableName, IndexName, KeyColumns, FilterSql) VALUES
    ('Items', 'UX_Items_Barcode', 'Barcode', '[Barcode] IS NOT NULL'),
    ('Items', 'UX_Items_Sku', 'Sku', '[Sku] IS NOT NULL'),
    ('Orders', 'UQ_Orders_OrderNumber', 'OrderNumber', NULL),
    ('Orders', 'UX_Orders_OfflineLocalId', 'OfflineLocalId', '[OfflineLocalId] IS NOT NULL'),
    ('Products', 'UX_Products_Code', 'Code', NULL),
    ('WasteReasons', 'UX_WasteReasons_Name', 'Name', NULL);

DECLARE @table SYSNAME, @index SYSNAME, @columns NVARCHAR(200), @filter NVARCHAR(200), @ddl NVARCHAR(MAX);
DECLARE unique_indexes CURSOR LOCAL FAST_FORWARD FOR SELECT TableName, IndexName, KeyColumns, FilterSql FROM @indexes;
OPEN unique_indexes;
FETCH NEXT FROM unique_indexes INTO @table, @index, @columns, @filter;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @objectId INT = OBJECT_ID(N'dbo.' + QUOTENAME(@table));
    DECLARE @hasTenant BIT = 0;

    IF EXISTS (SELECT 1 FROM sys.indexes i
               JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
               JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
               WHERE i.object_id = @objectId AND i.name = @index AND c.name = N'TenantId')
    BEGIN
        SET @hasTenant = 1;
    END

    IF @hasTenant = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE parent_object_id = @objectId AND name = @index)
        BEGIN
            SET @ddl = N'ALTER TABLE dbo.' + QUOTENAME(@table) + N' DROP CONSTRAINT ' + QUOTENAME(@index) + N';';
            EXEC sys.sp_executesql @ddl;
        END
        ELSE IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = @objectId AND name = @index)
        BEGIN
            SET @ddl = N'DROP INDEX ' + QUOTENAME(@index) + N' ON dbo.' + QUOTENAME(@table) + N';';
            EXEC sys.sp_executesql @ddl;
        END

        SET @ddl = N'CREATE UNIQUE NONCLUSTERED INDEX ' + QUOTENAME(@index) + N' ON dbo.' + QUOTENAME(@table)
            + N' (TenantId, ' + @columns + N')' + ISNULL(N' WHERE ' + @filter, N'') + N';';
        EXEC sys.sp_executesql @ddl;
    END

    FETCH NEXT FROM unique_indexes INTO @table, @index, @columns, @filter;
END
CLOSE unique_indexes;
DEALLOCATE unique_indexes;
GO

-- The next order number per tenant.
IF OBJECT_ID(N'dbo.TenantCounters', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenantCounters
    (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        Name VARCHAR(50) NOT NULL,
        NextValue BIGINT NOT NULL,
        CONSTRAINT PK_TenantCounters PRIMARY KEY CLUSTERED (TenantId, Name),
        CONSTRAINT FK_TenantCounters_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.TenantCounters
               WHERE TenantId = '00000000-0000-0000-0000-000000000001' AND Name = 'OrderNumber')
BEGIN
    DECLARE @sequenceValue BIGINT = 0;
    SELECT @sequenceValue = CONVERT(BIGINT, current_value) FROM sys.sequences WHERE name = N'OrderNumberSeq';

    DECLARE @highest BIGINT = ISNULL((SELECT MAX(CONVERT(BIGINT, OrderNumber)) FROM dbo.Orders), 0);
    DECLARE @next BIGINT = CASE WHEN @sequenceValue > @highest THEN @sequenceValue ELSE @highest END + 1;

    INSERT INTO dbo.TenantCounters (TenantId, Name, NextValue)
    VALUES ('00000000-0000-0000-0000-000000000001', 'OrderNumber', @next);
END
GO
