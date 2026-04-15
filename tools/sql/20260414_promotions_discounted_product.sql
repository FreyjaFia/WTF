SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
BEGIN
    IF EXISTS (
        SELECT 1
        FROM sys.check_constraints
        WHERE name = N'CK_Promotions_TypeId'
          AND parent_object_id = OBJECT_ID(N'dbo.Promotions')
    )
    BEGIN
        ALTER TABLE dbo.Promotions DROP CONSTRAINT CK_Promotions_TypeId;
    END;

    ALTER TABLE dbo.Promotions
    ADD CONSTRAINT CK_Promotions_TypeId CHECK (TypeId IN (1, 2, 3));
END;
GO

IF OBJECT_ID(N'dbo.DiscountedProductPromotions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DiscountedProductPromotions
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_DiscountedProductPromotions_Id DEFAULT NEWID(),
        PromotionId UNIQUEIDENTIFIER NOT NULL,
        ProductId UNIQUEIDENTIFIER NOT NULL,
        FixedPrice DECIMAL(10, 2) NULL,
        PercentOff DECIMAL(5, 2) NULL,
        CONSTRAINT PK_DiscountedProductPromotions PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_DiscountedProductPromotions_Promotions FOREIGN KEY (PromotionId)
            REFERENCES dbo.Promotions(Id)
            ON DELETE CASCADE,
        CONSTRAINT FK_DiscountedProductPromotions_Products FOREIGN KEY (ProductId)
            REFERENCES dbo.Products(Id),
        CONSTRAINT CK_DiscountedProductPromotions_Values CHECK (
            (FixedPrice IS NOT NULL AND FixedPrice > 0 AND PercentOff IS NULL)
            OR (PercentOff IS NOT NULL AND PercentOff > 0 AND PercentOff <= 100 AND FixedPrice IS NULL)
        )
    );
END;
GO

IF OBJECT_ID(N'dbo.DiscountedProductPromotionAddOns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DiscountedProductPromotionAddOns
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_DiscountedProductPromotionAddOns_Id DEFAULT NEWID(),
        DiscountedProductPromotionId UNIQUEIDENTIFIER NOT NULL,
        AddOnProductId UNIQUEIDENTIFIER NOT NULL,
        Quantity INT NOT NULL,
        CONSTRAINT PK_DiscountedProductPromotionAddOns PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_DiscountedProductPromotionAddOns_Promotion FOREIGN KEY (DiscountedProductPromotionId)
            REFERENCES dbo.DiscountedProductPromotions(Id)
            ON DELETE CASCADE,
        CONSTRAINT FK_DiscountedProductPromotionAddOns_Product FOREIGN KEY (AddOnProductId)
            REFERENCES dbo.Products(Id),
        CONSTRAINT CK_DiscountedProductPromotionAddOns_Quantity CHECK (Quantity > 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DiscountedProductPromotions_ProductId' AND object_id = OBJECT_ID(N'dbo.DiscountedProductPromotions'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_DiscountedProductPromotions_ProductId
        ON dbo.DiscountedProductPromotions(ProductId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_DiscountedProductPromotions_Promotion_Product' AND object_id = OBJECT_ID(N'dbo.DiscountedProductPromotions'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_DiscountedProductPromotions_Promotion_Product
        ON dbo.DiscountedProductPromotions(PromotionId, ProductId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DiscountedProductPromotionAddOns_Promotion_AddOn' AND object_id = OBJECT_ID(N'dbo.DiscountedProductPromotionAddOns'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_DiscountedProductPromotionAddOns_Promotion_AddOn
        ON dbo.DiscountedProductPromotionAddOns(DiscountedProductPromotionId, AddOnProductId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DiscountedProductPromotionAddOns_AddOnProductId' AND object_id = OBJECT_ID(N'dbo.DiscountedProductPromotionAddOns'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_DiscountedProductPromotionAddOns_AddOnProductId
        ON dbo.DiscountedProductPromotionAddOns(AddOnProductId);
END;
GO
