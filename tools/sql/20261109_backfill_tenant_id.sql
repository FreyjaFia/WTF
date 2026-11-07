SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Multi-tenant support, step 2 of 3. Gives every existing row of a tenant-owned table to tenant #1
-- (00000000-0000-0000-0000-000000000001), in batches of 5000 so a large table does not hold a long lock. Only rows whose
-- TenantId is still NULL are touched, so rows that already belong to a tenant are never overwritten and a second run
-- changes nothing. The script fails at the end if any NULL is left, so the enforce step (3) is never run on unfinished data.
-- Run 20261108_add_tenants.sql first.

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
DECLARE @name SYSNAME, @sql NVARCHAR(MAX), @left INT, @remaining INT = 0, @total INT;

IF NOT EXISTS (SELECT 1 FROM dbo.Tenants WHERE Id = @tenantId)
BEGIN
    RAISERROR(N'Tenant #1 is missing. Run 20261108_add_tenants.sql first.', 16, 1);
    RETURN;
END

DECLARE tenant_tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
OPEN tenant_tables;
FETCH NEXT FROM tenant_tables INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @sql = N'WHILE 1 = 1 BEGIN UPDATE TOP (5000) dbo.' + QUOTENAME(@name)
        + N' SET TenantId = @tenantId WHERE TenantId IS NULL; IF @@ROWCOUNT = 0 BREAK; END';
    EXEC sys.sp_executesql @sql, N'@tenantId UNIQUEIDENTIFIER', @tenantId = @tenantId;

    SET @sql = N'SELECT @left = COUNT(*) FROM dbo.' + QUOTENAME(@name) + N' WHERE TenantId IS NULL';
    EXEC sys.sp_executesql @sql, N'@left INT OUTPUT', @left = @left OUTPUT;

    IF @left > 0
    BEGIN
        SET @remaining = @remaining + @left;
        RAISERROR(N'dbo.%s still has rows without a TenantId.', 10, 1, @name);
    END

    FETCH NEXT FROM tenant_tables INTO @name;
END
CLOSE tenant_tables;
DEALLOCATE tenant_tables;

IF @remaining > 0
BEGIN
    RAISERROR(N'Backfill incomplete: %d rows have no TenantId.', 16, 1, @remaining);
END
GO
