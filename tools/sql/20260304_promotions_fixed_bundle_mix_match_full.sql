SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Promotions
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Promotions_Id DEFAULT NEWID(),
        Name NVARCHAR(100) NOT NULL,
        TypeId INT NOT NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_Promotions_IsActive DEFAULT (1),
        StartDate DATETIME2(7) NULL,
        EndDate DATETIME2(7) NULL,
        CreatedAt DATETIME NOT NULL
            CONSTRAINT DF_Promotions_CreatedAt DEFAULT (GETUTCDATE()),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt DATETIME NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_Promotions PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_Promotions_TypeId CHECK (TypeId IN (1, 2)),
        CONSTRAINT CK_Promotions_DateRange CHECK (EndDate IS NULL OR StartDate IS NULL OR StartDate <= EndDate)
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_Promotions_CreatedBy'
      AND parent_object_id = OBJECT_ID(N'dbo.Promotions')
)
BEGIN
    ALTER TABLE dbo.Promotions
    ADD CONSTRAINT FK_Promotions_CreatedBy
        FOREIGN KEY (CreatedBy)
        REFERENCES dbo.Users(Id);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_Promotions_UpdatedBy'
      AND parent_object_id = OBJECT_ID(N'dbo.Promotions')
)
BEGIN
    ALTER TABLE dbo.Promotions
    ADD CONSTRAINT FK_Promotions_UpdatedBy
        FOREIGN KEY (UpdatedBy)
        REFERENCES dbo.Users(Id);
END
GO

IF OBJECT_ID(N'dbo.PromotionImages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PromotionImages
    (
        PromotionId UNIQUEIDENTIFIER NOT NULL,
        ImageId UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_PromotionImages PRIMARY KEY CLUSTERED (PromotionId, ImageId),
        CONSTRAINT UQ_PromotionImages_PromotionId UNIQUE (PromotionId),
        CONSTRAINT UQ_PromotionImages_ImageId UNIQUE (ImageId),
        CONSTRAINT FK_PromotionImages_Promotions FOREIGN KEY (PromotionId)
            REFERENCES dbo.Promotions(Id),
        CONSTRAINT FK_PromotionImages_Images FOREIGN KEY (ImageId)
            REFERENCES dbo.Images(ImageId)
    );
END
GO

IF OBJECT_ID(N'dbo.FixedBundlePromotions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FixedBundlePromotions
    (
        PromotionId UNIQUEIDENTIFIER NOT NULL,
        BundlePrice DECIMAL(10, 2) NOT NULL,
        CONSTRAINT PK_FixedBundlePromotions PRIMARY KEY CLUSTERED (PromotionId),
        CONSTRAINT FK_FixedBundlePromotions_Promotions FOREIGN KEY (PromotionId)
            REFERENCES dbo.Promotions(Id)
            ON DELETE CASCADE,
        CONSTRAINT CK_FixedBundlePromotions_BundlePrice CHECK (BundlePrice >= 0)
    );
END
GO

IF OBJECT_ID(N'dbo.FixedBundlePromotionItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FixedBundlePromotionItems
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_FixedBundlePromotionItems_Id DEFAULT NEWID(),
        FixedBundlePromotionId UNIQUEIDENTIFIER NOT NULL,
        ProductId UNIQUEIDENTIFIER NOT NULL,
        Quantity INT NOT NULL,
        CONSTRAINT PK_FixedBundlePromotionItems PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_FixedBundlePromotionItems_FixedBundlePromotions FOREIGN KEY (FixedBundlePromotionId)
            REFERENCES dbo.FixedBundlePromotions(PromotionId)
            ON DELETE CASCADE,
        CONSTRAINT FK_FixedBundlePromotionItems_Products FOREIGN KEY (ProductId)
            REFERENCES dbo.Products(Id),
        CONSTRAINT CK_FixedBundlePromotionItems_Quantity CHECK (Quantity > 0)
    );
END
GO

IF OBJECT_ID(N'dbo.MixMatchPromotions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MixMatchPromotions
    (
        PromotionId UNIQUEIDENTIFIER NOT NULL,
        RequiredQuantity INT NOT NULL,
        MaxSelectionsPerOrder INT NULL,
        BundlePrice DECIMAL(10, 2) NOT NULL,
        CONSTRAINT PK_MixMatchPromotions PRIMARY KEY CLUSTERED (PromotionId),
        CONSTRAINT FK_MixMatchPromotions_Promotions FOREIGN KEY (PromotionId)
            REFERENCES dbo.Promotions(Id)
            ON DELETE CASCADE,
        CONSTRAINT CK_MixMatchPromotions_RequiredQuantity CHECK (RequiredQuantity > 0),
        CONSTRAINT CK_MixMatchPromotions_MaxSelectionsPerOrder CHECK (MaxSelectionsPerOrder IS NULL OR MaxSelectionsPerOrder > 0),
        CONSTRAINT CK_MixMatchPromotions_BundlePrice CHECK (BundlePrice >= 0)
    );
END
GO

IF OBJECT_ID(N'dbo.MixMatchPromotionProducts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MixMatchPromotionProducts
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_MixMatchPromotionProducts_Id DEFAULT NEWID(),
        MixMatchPromotionId UNIQUEIDENTIFIER NOT NULL,
        ProductId UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_MixMatchPromotionProducts PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_MixMatchPromotionProducts_MixMatchPromotions FOREIGN KEY (MixMatchPromotionId)
            REFERENCES dbo.MixMatchPromotions(PromotionId)
            ON DELETE CASCADE,
        CONSTRAINT FK_MixMatchPromotionProducts_Products FOREIGN KEY (ProductId)
            REFERENCES dbo.Products(Id)
    );
END
GO

IF OBJECT_ID(N'dbo.FixedBundlePromotionItemAddOns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FixedBundlePromotionItemAddOns
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_FixedBundlePromotionItemAddOns_Id DEFAULT NEWID(),
        FixedBundlePromotionItemId UNIQUEIDENTIFIER NOT NULL,
        AddOnProductId UNIQUEIDENTIFIER NOT NULL,
        Quantity INT NOT NULL,
        CONSTRAINT PK_FixedBundlePromotionItemAddOns PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_FixedBundlePromotionItemAddOns_Item FOREIGN KEY (FixedBundlePromotionItemId)
            REFERENCES dbo.FixedBundlePromotionItems(Id)
            ON DELETE CASCADE,
        CONSTRAINT FK_FixedBundlePromotionItemAddOns_Product FOREIGN KEY (AddOnProductId)
            REFERENCES dbo.Products(Id),
        CONSTRAINT CK_FixedBundlePromotionItemAddOns_Quantity CHECK (Quantity > 0)
    );
END
GO

IF OBJECT_ID(N'dbo.MixMatchPromotionProductAddOns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MixMatchPromotionProductAddOns
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_MixMatchPromotionProductAddOns_Id DEFAULT NEWID(),
        MixMatchPromotionProductId UNIQUEIDENTIFIER NOT NULL,
        AddOnProductId UNIQUEIDENTIFIER NOT NULL,
        Quantity INT NOT NULL,
        CONSTRAINT PK_MixMatchPromotionProductAddOns PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_MixMatchPromotionProductAddOns_Item FOREIGN KEY (MixMatchPromotionProductId)
            REFERENCES dbo.MixMatchPromotionProducts(Id)
            ON DELETE CASCADE,
        CONSTRAINT FK_MixMatchPromotionProductAddOns_Product FOREIGN KEY (AddOnProductId)
            REFERENCES dbo.Products(Id),
        CONSTRAINT CK_MixMatchPromotionProductAddOns_Quantity CHECK (Quantity > 0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Promotions_TypeId_IsActive' AND object_id = OBJECT_ID(N'dbo.Promotions'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Promotions_TypeId_IsActive
        ON dbo.Promotions(TypeId, IsActive)
        INCLUDE (StartDate, EndDate, Name);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Promotions_CreatedBy' AND object_id = OBJECT_ID(N'dbo.Promotions'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Promotions_CreatedBy
        ON dbo.Promotions(CreatedBy);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_FixedBundlePromotionItems_Promotion_Product' AND object_id = OBJECT_ID(N'dbo.FixedBundlePromotionItems'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_FixedBundlePromotionItems_Promotion_Product
        ON dbo.FixedBundlePromotionItems(FixedBundlePromotionId, ProductId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_FixedBundlePromotionItems_ProductId' AND object_id = OBJECT_ID(N'dbo.FixedBundlePromotionItems'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_FixedBundlePromotionItems_ProductId
        ON dbo.FixedBundlePromotionItems(ProductId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MixMatchPromotionProducts_Promotion_Product' AND object_id = OBJECT_ID(N'dbo.MixMatchPromotionProducts'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_MixMatchPromotionProducts_Promotion_Product
        ON dbo.MixMatchPromotionProducts(MixMatchPromotionId, ProductId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MixMatchPromotionProducts_ProductId' AND object_id = OBJECT_ID(N'dbo.MixMatchPromotionProducts'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_MixMatchPromotionProducts_ProductId
        ON dbo.MixMatchPromotionProducts(ProductId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_FixedBundlePromotionItemAddOns_Item_AddOn' AND object_id = OBJECT_ID(N'dbo.FixedBundlePromotionItemAddOns'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_FixedBundlePromotionItemAddOns_Item_AddOn
        ON dbo.FixedBundlePromotionItemAddOns(FixedBundlePromotionItemId, AddOnProductId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_MixMatchPromotionProductAddOns_Item_AddOn' AND object_id = OBJECT_ID(N'dbo.MixMatchPromotionProductAddOns'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX IX_MixMatchPromotionProductAddOns_Item_AddOn
        ON dbo.MixMatchPromotionProductAddOns(MixMatchPromotionProductId, AddOnProductId);
END
GO

IF COL_LENGTH(N'dbo.OrderItems', N'BundlePromotionId') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems
    ADD BundlePromotionId UNIQUEIDENTIFIER NULL;
END
GO

IF OBJECT_ID(N'dbo.Promotions', N'U') IS NOT NULL
   AND NOT EXISTS
(
    SELECT 1
    FROM sys.foreign_keys
    WHERE name = N'FK_OrderItems_BundlePromotion'
      AND parent_object_id = OBJECT_ID(N'dbo.OrderItems')
)
BEGIN
    ALTER TABLE dbo.OrderItems
    ADD CONSTRAINT FK_OrderItems_BundlePromotion
        FOREIGN KEY (BundlePromotionId)
        REFERENCES dbo.Promotions(Id);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_OrderItems_BundlePromotionId'
      AND object_id = OBJECT_ID(N'dbo.OrderItems')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_OrderItems_BundlePromotionId
        ON dbo.OrderItems(BundlePromotionId);
END
GO

IF OBJECT_ID(N'dbo.OrderBundlePromotions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrderBundlePromotions
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_OrderBundlePromotions_Id DEFAULT NEWID(),
        OrderId UNIQUEIDENTIFIER NOT NULL,
        PromotionId UNIQUEIDENTIFIER NOT NULL,
        Quantity INT NOT NULL,
        UnitPrice DECIMAL(10, 2) NOT NULL,
        CONSTRAINT PK_OrderBundlePromotions PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_OrderBundlePromotions_Quantity CHECK (Quantity > 0),
        CONSTRAINT CK_OrderBundlePromotions_UnitPrice CHECK (UnitPrice >= 0),
        CONSTRAINT FK_OrderBundlePromotions_Order FOREIGN KEY (OrderId)
            REFERENCES dbo.Orders(Id),
        CONSTRAINT FK_OrderBundlePromotions_Promotion FOREIGN KEY (PromotionId)
            REFERENCES dbo.Promotions(Id)
    );
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_OrderBundlePromotions_OrderId'
      AND object_id = OBJECT_ID(N'dbo.OrderBundlePromotions')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_OrderBundlePromotions_OrderId
        ON dbo.OrderBundlePromotions(OrderId);
END
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_OrderBundlePromotions_PromotionId'
      AND object_id = OBJECT_ID(N'dbo.OrderBundlePromotions')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_OrderBundlePromotions_PromotionId
        ON dbo.OrderBundlePromotions(PromotionId);
END
GO
