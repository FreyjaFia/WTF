SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ProductInventoryLinks', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductInventoryLinks_Products')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT FK_ProductInventoryLinks_Products;

    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductInventoryLinks_InventoryItems')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT FK_ProductInventoryLinks_InventoryItems;

    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductInventoryLinks_CreatedBy')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT FK_ProductInventoryLinks_CreatedBy;

    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductInventoryLinks_UpdatedBy')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT FK_ProductInventoryLinks_UpdatedBy;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ProductInventoryLinks_QuantityPerSale')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT CK_ProductInventoryLinks_QuantityPerSale;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductInventoryLinks_Id')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT DF_ProductInventoryLinks_Id;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductInventoryLinks_QuantityPerSale')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT DF_ProductInventoryLinks_QuantityPerSale;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductInventoryLinks_IsActive')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT DF_ProductInventoryLinks_IsActive;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductInventoryLinks_CreatedAt')
        ALTER TABLE dbo.ProductInventoryLinks DROP CONSTRAINT DF_ProductInventoryLinks_CreatedAt;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductInventoryLinks_ProductId' AND object_id = OBJECT_ID(N'dbo.ProductInventoryLinks'))
        DROP INDEX IX_ProductInventoryLinks_ProductId ON dbo.ProductInventoryLinks;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductInventoryLinks_InventoryItemId' AND object_id = OBJECT_ID(N'dbo.ProductInventoryLinks'))
        DROP INDEX IX_ProductInventoryLinks_InventoryItemId ON dbo.ProductInventoryLinks;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ProductInventoryLinks_Product_Inventory' AND object_id = OBJECT_ID(N'dbo.ProductInventoryLinks'))
        DROP INDEX UX_ProductInventoryLinks_Product_Inventory ON dbo.ProductInventoryLinks;

    EXEC sp_rename N'dbo.ProductInventoryLinks', N'ProductItemLinks';
    EXEC sp_rename N'dbo.PK_ProductInventoryLinks', N'PK_ProductItemLinks', 'OBJECT';
END

IF OBJECT_ID(N'dbo.InventoryItems', N'U') IS NOT NULL
   AND OBJECT_ID(N'dbo.Items', N'U') IS NULL
BEGIN
    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_StockMovements_InventoryItems')
        ALTER TABLE dbo.StockMovements DROP CONSTRAINT FK_StockMovements_InventoryItems;

    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_InventoryItems_CreatedBy')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT FK_InventoryItems_CreatedBy;

    IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_InventoryItems_UpdatedBy')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT FK_InventoryItems_UpdatedBy;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_InventoryItems_CurrentQuantity')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT CK_InventoryItems_CurrentQuantity;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_InventoryItems_CostPrice')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT CK_InventoryItems_CostPrice;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_InventoryItems_WarningQuantity')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT CK_InventoryItems_WarningQuantity;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_InventoryItems_CriticalQuantity')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT CK_InventoryItems_CriticalQuantity;

    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_InventoryItems_UnitsPerStockUnit')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT CK_InventoryItems_UnitsPerStockUnit;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_InventoryItems_Id')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT DF_InventoryItems_Id;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_InventoryItems_UnitName')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT DF_InventoryItems_UnitName;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_InventoryItems_CurrentQuantity')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT DF_InventoryItems_CurrentQuantity;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_InventoryItems_IsActive')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT DF_InventoryItems_IsActive;

    IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_InventoryItems_CreatedAt')
        ALTER TABLE dbo.InventoryItems DROP CONSTRAINT DF_InventoryItems_CreatedAt;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_InventoryItems_Name' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
        DROP INDEX IX_InventoryItems_Name ON dbo.InventoryItems;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_InventoryItems_Sku' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
        DROP INDEX UX_InventoryItems_Sku ON dbo.InventoryItems;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_InventoryItems_Barcode' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
        DROP INDEX UX_InventoryItems_Barcode ON dbo.InventoryItems;

    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_InventoryItems_IsActive' AND object_id = OBJECT_ID(N'dbo.InventoryItems'))
        DROP INDEX IX_InventoryItems_IsActive ON dbo.InventoryItems;

    EXEC sp_rename N'dbo.InventoryItems', N'Items';
    EXEC sp_rename N'dbo.PK_InventoryItems', N'PK_Items', 'OBJECT';
END

IF COL_LENGTH(N'dbo.ProductItemLinks', N'InventoryItemId') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductItemLinks', N'ItemId') IS NULL
BEGIN
    EXEC sp_rename N'dbo.ProductItemLinks.InventoryItemId', N'ItemId', N'COLUMN';
END

IF COL_LENGTH(N'dbo.StockMovements', N'InventoryItemId') IS NOT NULL
   AND COL_LENGTH(N'dbo.StockMovements', N'ItemId') IS NULL
BEGIN
    EXEC sp_rename N'dbo.StockMovements.InventoryItemId', N'ItemId', N'COLUMN';
END

IF OBJECT_ID(N'dbo.Items', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Items_Id')
        ALTER TABLE dbo.Items ADD CONSTRAINT DF_Items_Id DEFAULT NEWID() FOR Id;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Items_UnitName')
        ALTER TABLE dbo.Items ADD CONSTRAINT DF_Items_UnitName DEFAULT N'piece' FOR UnitName;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Items_CurrentQuantity')
        ALTER TABLE dbo.Items ADD CONSTRAINT DF_Items_CurrentQuantity DEFAULT 0 FOR CurrentQuantity;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Items_IsActive')
        ALTER TABLE dbo.Items ADD CONSTRAINT DF_Items_IsActive DEFAULT 1 FOR IsActive;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_Items_CreatedAt')
        ALTER TABLE dbo.Items ADD CONSTRAINT DF_Items_CreatedAt DEFAULT GETUTCDATE() FOR CreatedAt;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_CurrentQuantity')
        ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_CurrentQuantity CHECK (CurrentQuantity >= 0);

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_CostPrice')
        ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_CostPrice CHECK (CostPrice IS NULL OR CostPrice >= 0);

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_WarningQuantity')
        ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_WarningQuantity CHECK (WarningQuantity IS NULL OR WarningQuantity >= 0);

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_CriticalQuantity')
        ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_CriticalQuantity CHECK (CriticalQuantity IS NULL OR CriticalQuantity >= 0);

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_UnitsPerStockUnit')
        ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_UnitsPerStockUnit CHECK (UnitsPerStockUnit IS NULL OR UnitsPerStockUnit > 0);

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Items_CreatedBy')
        ALTER TABLE dbo.Items ADD CONSTRAINT FK_Items_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(Id);

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Items_UpdatedBy')
        ALTER TABLE dbo.Items ADD CONSTRAINT FK_Items_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(Id);
END

IF OBJECT_ID(N'dbo.ProductItemLinks', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductItemLinks_Id')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT DF_ProductItemLinks_Id DEFAULT NEWID() FOR Id;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductItemLinks_QuantityPerSale')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT DF_ProductItemLinks_QuantityPerSale DEFAULT 1 FOR QuantityPerSale;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductItemLinks_IsActive')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT DF_ProductItemLinks_IsActive DEFAULT 1 FOR IsActive;

    IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE name = N'DF_ProductItemLinks_CreatedAt')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT DF_ProductItemLinks_CreatedAt DEFAULT GETUTCDATE() FOR CreatedAt;

    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_ProductItemLinks_QuantityPerSale')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT CK_ProductItemLinks_QuantityPerSale CHECK (QuantityPerSale > 0);

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductItemLinks_Products')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT FK_ProductItemLinks_Products FOREIGN KEY (ProductId) REFERENCES dbo.Products(Id);

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductItemLinks_Items')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT FK_ProductItemLinks_Items FOREIGN KEY (ItemId) REFERENCES dbo.Items(Id);

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductItemLinks_CreatedBy')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT FK_ProductItemLinks_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(Id);

    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_ProductItemLinks_UpdatedBy')
        ALTER TABLE dbo.ProductItemLinks ADD CONSTRAINT FK_ProductItemLinks_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(Id);
END

IF OBJECT_ID(N'dbo.StockMovements', N'U') IS NOT NULL
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_StockMovements_Items')
        ALTER TABLE dbo.StockMovements ADD CONSTRAINT FK_StockMovements_Items FOREIGN KEY (ItemId) REFERENCES dbo.Items(Id);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Items_Name' AND object_id = OBJECT_ID(N'dbo.Items'))
    CREATE NONCLUSTERED INDEX IX_Items_Name ON dbo.Items(Name);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Items_Sku' AND object_id = OBJECT_ID(N'dbo.Items'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_Items_Sku ON dbo.Items(Sku) WHERE Sku IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Items_Barcode' AND object_id = OBJECT_ID(N'dbo.Items'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_Items_Barcode ON dbo.Items(Barcode) WHERE Barcode IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Items_IsActive' AND object_id = OBJECT_ID(N'dbo.Items'))
    CREATE NONCLUSTERED INDEX IX_Items_IsActive ON dbo.Items(IsActive);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductItemLinks_ProductId' AND object_id = OBJECT_ID(N'dbo.ProductItemLinks'))
    CREATE NONCLUSTERED INDEX IX_ProductItemLinks_ProductId ON dbo.ProductItemLinks(ProductId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ProductItemLinks_ItemId' AND object_id = OBJECT_ID(N'dbo.ProductItemLinks'))
    CREATE NONCLUSTERED INDEX IX_ProductItemLinks_ItemId ON dbo.ProductItemLinks(ItemId);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ProductItemLinks_Product_Item' AND object_id = OBJECT_ID(N'dbo.ProductItemLinks'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_ProductItemLinks_Product_Item ON dbo.ProductItemLinks(ProductId, ItemId);

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockMovements_InventoryItemId_CreatedAt' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
    DROP INDEX IX_StockMovements_InventoryItemId_CreatedAt ON dbo.StockMovements;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockMovements_ItemId_CreatedAt' AND object_id = OBJECT_ID(N'dbo.StockMovements'))
    CREATE NONCLUSTERED INDEX IX_StockMovements_ItemId_CreatedAt ON dbo.StockMovements(ItemId, CreatedAt DESC);

COMMIT TRANSACTION;
GO
