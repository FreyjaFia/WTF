SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Multi-tenant support, step 1 of 3 (docs plan: add, backfill, enforce). Adds the Tenants table, creates tenant #1 (the
-- shop that runs today, fixed id 00000000-0000-0000-0000-000000000001) and a NULLABLE TenantId column on every
-- tenant-owned table. Nothing reads the column yet while Tenancy:Mode is Single, so the running API is unaffected.
-- Global lookup tables stay without a TenantId: PaymentMethods, SchemaScriptHistory, Statuses, UserRoles, Tenants.
-- Status: 1 Trial, 2 Active, 3 Suspended, 4 Cancelled. Safe to run twice; existing data is never changed.
-- If tables were added after this script was written (for example Expenses), add them to the list in
-- 20261108_add_tenants.sql and 20261109_backfill_tenant_id.sql, or run the same loop for them in a later script.

IF OBJECT_ID(N'dbo.Tenants', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Tenants
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Tenants_Id DEFAULT (NEWID()),
        Name NVARCHAR(100) NOT NULL,
        Slug VARCHAR(50) NOT NULL,
        Status TINYINT NOT NULL
            CONSTRAINT DF_Tenants_Status DEFAULT 2,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_Tenants_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(7) NULL,
        CONSTRAINT PK_Tenants PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_Tenants_Status CHECK (Status IN (1, 2, 3, 4))
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Tenants_Slug' AND object_id = OBJECT_ID(N'dbo.Tenants'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_Tenants_Slug ON dbo.Tenants (Slug);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Tenants WHERE Id = '00000000-0000-0000-0000-000000000001')
BEGIN
    INSERT INTO dbo.Tenants (Id, Name, Slug, Status)
    VALUES ('00000000-0000-0000-0000-000000000001', N'WTF', 'wtf', 2);
END
GO

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

DECLARE @name SYSNAME, @sql NVARCHAR(MAX);
DECLARE tenant_tables CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @tables;
OPEN tenant_tables;
FETCH NEXT FROM tenant_tables INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    IF OBJECT_ID(N'dbo.' + QUOTENAME(@name), N'U') IS NULL
    BEGIN
        RAISERROR(N'Table dbo.%s does not exist.', 16, 1, @name);
    END
    ELSE IF COL_LENGTH(N'dbo.' + QUOTENAME(@name), N'TenantId') IS NULL
    BEGIN
        SET @sql = N'ALTER TABLE dbo.' + QUOTENAME(@name) + N' ADD TenantId UNIQUEIDENTIFIER NULL;';
        EXEC sys.sp_executesql @sql;
    END

    FETCH NEXT FROM tenant_tables INTO @name;
END
CLOSE tenant_tables;
DEALLOCATE tenant_tables;
GO
