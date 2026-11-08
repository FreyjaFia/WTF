SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Purchase orders (Inventory Phase 8, slice 4). An order to one supplier, drafted from the reorder list or by hand, marked
-- sent, and received against (a receipt can name the order it fills, in several partial deliveries):
--   PurchaseOrders      - supplier, a number that counts up per shop, status (1 Draft, 2 Sent, 3 Partly received,
--                         4 Received, 5 Cancelled), the date it is expected, a note, and who drafted, sent and closed it.
--   PurchaseOrderLines  - item, the pack as ordered (name, units in a pack, price of a pack) and the packs ordered and
--                         received so far. Packs still to come count as "on order" in the reorder list.
--   StockReceipts.PurchaseOrderId - the order a receipt fills, if any.
-- Both new tables carry TenantId like the other tenant-owned tables (NOT NULL, foreign key to Tenants, default tenant #1),
-- and the order number is unique per shop. Run it after 20261115_add_stock_receipts.sql. Safe to run twice.

IF OBJECT_ID(N'dbo.PurchaseOrders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PurchaseOrders
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PurchaseOrders_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PurchaseOrders_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        PoNumber INT NOT NULL,
        SupplierId UNIQUEIDENTIFIER NOT NULL,
        Status TINYINT NOT NULL
            CONSTRAINT DF_PurchaseOrders_Status DEFAULT 1,
        ExpectedOn DATE NULL,
        Note NVARCHAR(500) NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_PurchaseOrders_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        SentAt DATETIME2(7) NULL,
        SentBy UNIQUEIDENTIFIER NULL,
        ClosedAt DATETIME2(7) NULL,
        ClosedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_PurchaseOrders PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_PurchaseOrders_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_PurchaseOrders_Status CHECK (Status IN (1, 2, 3, 4, 5)),
        CONSTRAINT FK_PurchaseOrders_Supplier FOREIGN KEY (SupplierId)
            REFERENCES dbo.Suppliers(Id),
        CONSTRAINT FK_PurchaseOrders_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_PurchaseOrders_SentBy FOREIGN KEY (SentBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_PurchaseOrders_ClosedBy FOREIGN KEY (ClosedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.PurchaseOrders', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_PurchaseOrders_Tenant_PoNumber' AND object_id = OBJECT_ID(N'dbo.PurchaseOrders'))
BEGIN
    CREATE UNIQUE INDEX UX_PurchaseOrders_Tenant_PoNumber ON dbo.PurchaseOrders (TenantId, PoNumber);
END;
GO

IF OBJECT_ID(N'dbo.PurchaseOrders', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PurchaseOrders_Status_CreatedAt' AND object_id = OBJECT_ID(N'dbo.PurchaseOrders'))
BEGIN
    CREATE INDEX IX_PurchaseOrders_Status_CreatedAt ON dbo.PurchaseOrders (Status, CreatedAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.PurchaseOrders', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PurchaseOrders_SupplierId' AND object_id = OBJECT_ID(N'dbo.PurchaseOrders'))
BEGIN
    CREATE INDEX IX_PurchaseOrders_SupplierId ON dbo.PurchaseOrders (SupplierId);
END;
GO

IF OBJECT_ID(N'dbo.PurchaseOrderLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PurchaseOrderLines
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PurchaseOrderLines_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PurchaseOrderLines_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        PurchaseOrderId UNIQUEIDENTIFIER NOT NULL,
        ItemId UNIQUEIDENTIFIER NOT NULL,
        PackName NVARCHAR(50) NULL,
        UnitsPerPack DECIMAL(18, 3) NOT NULL,
        PackPrice DECIMAL(18, 2) NULL,
        PacksOrdered DECIMAL(18, 3) NOT NULL,
        PacksReceived DECIMAL(18, 3) NOT NULL
            CONSTRAINT DF_PurchaseOrderLines_PacksReceived DEFAULT 0,
        CONSTRAINT PK_PurchaseOrderLines PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_PurchaseOrderLines_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_PurchaseOrderLines_Quantities CHECK (UnitsPerPack > 0 AND PacksOrdered > 0 AND PacksReceived >= 0),
        CONSTRAINT CK_PurchaseOrderLines_PackPrice CHECK (PackPrice IS NULL OR PackPrice >= 0),
        CONSTRAINT FK_PurchaseOrderLines_Order FOREIGN KEY (PurchaseOrderId)
            REFERENCES dbo.PurchaseOrders(Id),
        CONSTRAINT FK_PurchaseOrderLines_Item FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.PurchaseOrderLines', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_PurchaseOrderLines_Order_Item' AND object_id = OBJECT_ID(N'dbo.PurchaseOrderLines'))
BEGIN
    CREATE UNIQUE INDEX UX_PurchaseOrderLines_Order_Item ON dbo.PurchaseOrderLines (PurchaseOrderId, ItemId);
END;
GO

IF OBJECT_ID(N'dbo.PurchaseOrderLines', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_PurchaseOrderLines_Item' AND object_id = OBJECT_ID(N'dbo.PurchaseOrderLines'))
BEGIN
    CREATE INDEX IX_PurchaseOrderLines_Item ON dbo.PurchaseOrderLines (ItemId);
END;
GO

IF OBJECT_ID(N'dbo.StockReceipts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.StockReceipts', N'PurchaseOrderId') IS NULL
BEGIN
    ALTER TABLE dbo.StockReceipts ADD PurchaseOrderId UNIQUEIDENTIFIER NULL;
END;
GO

IF COL_LENGTH(N'dbo.StockReceipts', N'PurchaseOrderId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_StockReceipts_PurchaseOrder')
BEGIN
    ALTER TABLE dbo.StockReceipts ADD CONSTRAINT FK_StockReceipts_PurchaseOrder
        FOREIGN KEY (PurchaseOrderId) REFERENCES dbo.PurchaseOrders(Id);
END;
GO

IF COL_LENGTH(N'dbo.StockReceipts', N'PurchaseOrderId') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockReceipts_PurchaseOrderId' AND object_id = OBJECT_ID(N'dbo.StockReceipts'))
BEGIN
    CREATE INDEX IX_StockReceipts_PurchaseOrderId ON dbo.StockReceipts (PurchaseOrderId) WHERE PurchaseOrderId IS NOT NULL;
END;
GO
