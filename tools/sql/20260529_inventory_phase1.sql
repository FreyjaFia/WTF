SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.InventoryItems', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.InventoryItems
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_InventoryItems_Id DEFAULT NEWID(),
        Name NVARCHAR(100) NOT NULL,
        Sku NVARCHAR(50) NULL,
        Barcode NVARCHAR(100) NULL,
        UnitName NVARCHAR(30) NOT NULL
            CONSTRAINT DF_InventoryItems_UnitName DEFAULT N'piece',
        StockUnitName NVARCHAR(30) NULL,
        UnitsPerStockUnit DECIMAL(18, 3) NULL,
        CurrentQuantity DECIMAL(18, 3) NOT NULL
            CONSTRAINT DF_InventoryItems_CurrentQuantity DEFAULT 0,
        CostPrice DECIMAL(10, 2) NULL,
        WarningQuantity DECIMAL(18, 3) NULL,
        CriticalQuantity DECIMAL(18, 3) NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_InventoryItems_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_InventoryItems_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_InventoryItems PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_InventoryItems_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_InventoryItems_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT CK_InventoryItems_CurrentQuantity CHECK (CurrentQuantity >= 0),
        CONSTRAINT CK_InventoryItems_CostPrice CHECK (CostPrice IS NULL OR CostPrice >= 0),
        CONSTRAINT CK_InventoryItems_WarningQuantity CHECK (WarningQuantity IS NULL OR WarningQuantity >= 0),
        CONSTRAINT CK_InventoryItems_CriticalQuantity CHECK (CriticalQuantity IS NULL OR CriticalQuantity >= 0),
        CONSTRAINT CK_InventoryItems_UnitsPerStockUnit CHECK (UnitsPerStockUnit IS NULL OR UnitsPerStockUnit > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.ProductInventoryLinks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductInventoryLinks
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ProductInventoryLinks_Id DEFAULT NEWID(),
        ProductId UNIQUEIDENTIFIER NOT NULL,
        InventoryItemId UNIQUEIDENTIFIER NOT NULL,
        QuantityPerSale DECIMAL(18, 3) NOT NULL
            CONSTRAINT DF_ProductInventoryLinks_QuantityPerSale DEFAULT 1,
        IsActive BIT NOT NULL
            CONSTRAINT DF_ProductInventoryLinks_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_ProductInventoryLinks_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_ProductInventoryLinks PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_ProductInventoryLinks_Products FOREIGN KEY (ProductId)
            REFERENCES dbo.Products(Id),
        CONSTRAINT FK_ProductInventoryLinks_InventoryItems FOREIGN KEY (InventoryItemId)
            REFERENCES dbo.InventoryItems(Id),
        CONSTRAINT FK_ProductInventoryLinks_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_ProductInventoryLinks_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT CK_ProductInventoryLinks_QuantityPerSale CHECK (QuantityPerSale > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockMovements
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockMovements_Id DEFAULT NEWID(),
        InventoryItemId UNIQUEIDENTIFIER NOT NULL,
        MovementType NVARCHAR(30) NOT NULL,
        QuantityDelta DECIMAL(18, 3) NOT NULL,
        QuantityBefore DECIMAL(18, 3) NOT NULL,
        QuantityAfter DECIMAL(18, 3) NOT NULL,
        UnitCost DECIMAL(10, 2) NULL,
        ReferenceType NVARCHAR(30) NULL,
        ReferenceId UNIQUEIDENTIFIER NULL,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_StockMovements_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_StockMovements PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_StockMovements_InventoryItems FOREIGN KEY (InventoryItemId)
            REFERENCES dbo.InventoryItems(Id),
        CONSTRAINT FK_StockMovements_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT CK_StockMovements_MovementType CHECK (
            MovementType IN (
                N'AddStock',
                N'SaleDeduction',
                N'ManualAdjustment',
                N'Correction',
                N'Spoilage'
            )
        ),
        CONSTRAINT CK_StockMovements_QuantityDelta CHECK (QuantityDelta <> 0),
        CONSTRAINT CK_StockMovements_QuantityBefore CHECK (QuantityBefore >= 0),
        CONSTRAINT CK_StockMovements_QuantityAfter CHECK (QuantityAfter >= 0),
        CONSTRAINT CK_StockMovements_UnitCost CHECK (UnitCost IS NULL OR UnitCost >= 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_InventoryItems_Name' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_InventoryItems_Name
        ON dbo.InventoryItems(Name);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_InventoryItems_Sku' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_InventoryItems_Sku
        ON dbo.InventoryItems(Sku)
        WHERE Sku IS NOT NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_InventoryItems_Barcode' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_InventoryItems_Barcode
        ON dbo.InventoryItems(Barcode)
        WHERE Barcode IS NOT NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_InventoryItems_IsActive' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_InventoryItems_IsActive
        ON dbo.InventoryItems(IsActive);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductInventoryLinks_ProductId' AND object_id = OBJECT_ID(N'dbo.ProductInventoryLinks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ProductInventoryLinks_ProductId
        ON dbo.ProductInventoryLinks(ProductId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductInventoryLinks_InventoryItemId' AND object_id = OBJECT_ID(N'dbo.ProductInventoryLinks'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ProductInventoryLinks_InventoryItemId
        ON dbo.ProductInventoryLinks(InventoryItemId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ProductInventoryLinks_Product_Inventory' AND object_id = OBJECT_ID(N'dbo.ProductInventoryLinks'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_ProductInventoryLinks_Product_Inventory
        ON dbo.ProductInventoryLinks(ProductId, InventoryItemId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockMovements_InventoryItemId_CreatedAt' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockMovements_InventoryItemId_CreatedAt
        ON dbo.StockMovements(InventoryItemId, CreatedAt DESC);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockMovements_Reference' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_StockMovements_Reference
        ON dbo.StockMovements(ReferenceType, ReferenceId);
END;
GO
