SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Receiving (Inventory Phase 8, slice 2). A receipt is goods that arrived from one supplier on one day, with the
-- supplier's invoice number and total, instead of a bare stock-in:
--   StockReceipts      - supplier, received date, invoice number, the invoice total typed from the paper (to check the
--                        lines against), a note, who recorded it, and ClientRequestId so a retried request is not
--                        recorded twice. A receipt is never edited; a mistake is fixed with an adjustment.
--   StockReceiptLines  - one row per item: packs received, units in a pack, price of a pack, the units added to stock,
--                        the unit cost worked out from the pack, and the AddStock movement it wrote (MovementId).
-- StockMovements gets no new column: a received line is a movement of type AddStock with ReferenceType StockReceipt and
-- the receipt's id as ReferenceId, so the ledger, the costing and the alerts all work as before. Both tables carry TenantId
-- like the other tenant-owned tables (NOT NULL, foreign key to Tenants, default tenant #1). Run it after
-- 20261114_add_suppliers.sql. Safe to run twice.

IF OBJECT_ID(N'dbo.StockReceipts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockReceipts
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockReceipts_Id DEFAULT (NEWID()),
        SupplierId UNIQUEIDENTIFIER NOT NULL,
        ReceivedOn DATE NOT NULL,
        InvoiceNumber NVARCHAR(50) NULL,
        InvoiceTotal DECIMAL(18, 2) NULL,
        Note NVARCHAR(500) NULL,
        ClientRequestId UNIQUEIDENTIFIER NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_StockReceipts_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockReceipts_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_StockReceipts PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_StockReceipts_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_StockReceipts_InvoiceTotal CHECK (InvoiceTotal IS NULL OR InvoiceTotal >= 0),
        CONSTRAINT FK_StockReceipts_Supplier FOREIGN KEY (SupplierId)
            REFERENCES dbo.Suppliers(Id),
        CONSTRAINT FK_StockReceipts_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.StockReceipts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockReceipts_ReceivedOn' AND object_id = OBJECT_ID(N'dbo.StockReceipts'))
BEGIN
    CREATE INDEX IX_StockReceipts_ReceivedOn ON dbo.StockReceipts (ReceivedOn DESC, CreatedAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.StockReceipts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockReceipts_SupplierId' AND object_id = OBJECT_ID(N'dbo.StockReceipts'))
BEGIN
    CREATE INDEX IX_StockReceipts_SupplierId ON dbo.StockReceipts (SupplierId);
END;
GO

IF OBJECT_ID(N'dbo.StockReceipts', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_StockReceipts_ClientRequestId' AND object_id = OBJECT_ID(N'dbo.StockReceipts'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_StockReceipts_ClientRequestId
        ON dbo.StockReceipts (ClientRequestId)
        WHERE ClientRequestId IS NOT NULL;
END;
GO

IF OBJECT_ID(N'dbo.StockReceiptLines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockReceiptLines
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockReceiptLines_Id DEFAULT (NEWID()),
        ReceiptId UNIQUEIDENTIFIER NOT NULL,
        ItemId UNIQUEIDENTIFIER NOT NULL,
        PackName NVARCHAR(50) NULL,
        Packs DECIMAL(18, 3) NOT NULL,
        UnitsPerPack DECIMAL(18, 3) NOT NULL,
        PackPrice DECIMAL(18, 2) NULL,
        Quantity DECIMAL(18, 3) NOT NULL,
        UnitCost DECIMAL(18, 6) NULL,
        MovementId UNIQUEIDENTIFIER NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_StockReceiptLines_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_StockReceiptLines PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_StockReceiptLines_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_StockReceiptLines_Positive CHECK (Packs > 0 AND UnitsPerPack > 0 AND Quantity > 0),
        CONSTRAINT CK_StockReceiptLines_PackPrice CHECK (PackPrice IS NULL OR PackPrice >= 0),
        CONSTRAINT FK_StockReceiptLines_Receipt FOREIGN KEY (ReceiptId)
            REFERENCES dbo.StockReceipts(Id),
        CONSTRAINT FK_StockReceiptLines_Item FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.StockReceiptLines', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockReceiptLines_Receipt' AND object_id = OBJECT_ID(N'dbo.StockReceiptLines'))
BEGIN
    CREATE INDEX IX_StockReceiptLines_Receipt ON dbo.StockReceiptLines (ReceiptId);
END;
GO

IF OBJECT_ID(N'dbo.StockReceiptLines', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_StockReceiptLines_Item' AND object_id = OBJECT_ID(N'dbo.StockReceiptLines'))
BEGIN
    CREATE INDEX IX_StockReceiptLines_Item ON dbo.StockReceiptLines (ItemId);
END;
GO
