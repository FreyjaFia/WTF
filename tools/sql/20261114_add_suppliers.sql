SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Suppliers (Inventory Phase 8, slice 1). Who the shop buys stock from, and what each supplier sells:
--   Suppliers                 - name, contact details, lead time in days, payment terms, notes. Inactive suppliers are
--                               kept for history but hidden from pickers.
--   ItemSuppliers             - one row per item and supplier: the supplier's own code, the pack it sells (name and how many
--                               of the item's unit are in it), the price of one pack, and whether it is the item's preferred
--                               supplier (at most one per item). Pack price is a cost, so only the cost roles read it.
--   ItemSupplierPriceHistory  - every change of a pack price, so creeping costs show.
-- All three tables belong to one shop: TenantId is NOT NULL with a foreign key to Tenants and the same default as the
-- other tenant-owned tables (tenant #1), and the supplier name is unique per shop. Run it after the tenant scripts
-- (20261108 to 20261110).
-- (The preferred-supplier index spans ItemId and IsPreferred on purpose: an index on ItemId alone would make the scaffold
-- read the item-to-supplier link as one-to-one.) Nothing existing changes, so the API from before this script keeps working. Safe to run twice.

IF OBJECT_ID(N'dbo.Suppliers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Suppliers
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Suppliers_Id DEFAULT (NEWID()),
        Name NVARCHAR(100) NOT NULL,
        ContactName NVARCHAR(100) NULL,
        Phone NVARCHAR(30) NULL,
        Email NVARCHAR(150) NULL,
        Address NVARCHAR(300) NULL,
        LeadTimeDays INT NULL,
        PaymentTerms NVARCHAR(100) NULL,
        Notes NVARCHAR(500) NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_Suppliers_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_Suppliers_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Suppliers_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_Suppliers PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_Suppliers_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_Suppliers_LeadTimeDays CHECK (LeadTimeDays IS NULL OR LeadTimeDays >= 0),
        CONSTRAINT FK_Suppliers_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_Suppliers_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.Suppliers', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Suppliers_Name' AND object_id = OBJECT_ID(N'dbo.Suppliers'))
BEGIN
    CREATE UNIQUE INDEX UX_Suppliers_Name ON dbo.Suppliers (TenantId, Name);
END;
GO

IF OBJECT_ID(N'dbo.ItemSuppliers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItemSuppliers
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ItemSuppliers_Id DEFAULT (NEWID()),
        ItemId UNIQUEIDENTIFIER NOT NULL,
        SupplierId UNIQUEIDENTIFIER NOT NULL,
        SupplierItemCode NVARCHAR(50) NULL,
        PackName NVARCHAR(50) NULL,
        UnitsPerPack DECIMAL(18, 3) NOT NULL
            CONSTRAINT DF_ItemSuppliers_UnitsPerPack DEFAULT 1,
        PackPrice DECIMAL(18, 2) NULL,
        IsPreferred BIT NOT NULL
            CONSTRAINT DF_ItemSuppliers_IsPreferred DEFAULT 0,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_ItemSuppliers_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ItemSuppliers_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_ItemSuppliers PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_ItemSuppliers_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_ItemSuppliers_UnitsPerPack CHECK (UnitsPerPack > 0),
        CONSTRAINT CK_ItemSuppliers_PackPrice CHECK (PackPrice IS NULL OR PackPrice >= 0),
        CONSTRAINT FK_ItemSuppliers_Item FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id),
        CONSTRAINT FK_ItemSuppliers_Supplier FOREIGN KEY (SupplierId)
            REFERENCES dbo.Suppliers(Id),
        CONSTRAINT FK_ItemSuppliers_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_ItemSuppliers_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.ItemSuppliers', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ItemSuppliers_Item_Supplier' AND object_id = OBJECT_ID(N'dbo.ItemSuppliers'))
BEGIN
    CREATE UNIQUE INDEX UX_ItemSuppliers_Item_Supplier ON dbo.ItemSuppliers (ItemId, SupplierId);
END;
GO

IF OBJECT_ID(N'dbo.ItemSuppliers', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_ItemSuppliers_Preferred' AND object_id = OBJECT_ID(N'dbo.ItemSuppliers'))
BEGIN
    CREATE UNIQUE INDEX UX_ItemSuppliers_Preferred ON dbo.ItemSuppliers (ItemId, IsPreferred) WHERE IsPreferred = 1;
END;
GO

IF OBJECT_ID(N'dbo.ItemSuppliers', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ItemSuppliers_SupplierId' AND object_id = OBJECT_ID(N'dbo.ItemSuppliers'))
BEGIN
    CREATE INDEX IX_ItemSuppliers_SupplierId ON dbo.ItemSuppliers (SupplierId);
END;
GO

IF OBJECT_ID(N'dbo.ItemSupplierPriceHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItemSupplierPriceHistory
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ItemSupplierPriceHistory_Id DEFAULT (NEWID()),
        ItemSupplierId UNIQUEIDENTIFIER NOT NULL,
        OldPackPrice DECIMAL(18, 2) NULL,
        NewPackPrice DECIMAL(18, 2) NOT NULL,
        Source NVARCHAR(20) NOT NULL
            CONSTRAINT DF_ItemSupplierPriceHistory_Source DEFAULT N'Manual',
        ChangedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_ItemSupplierPriceHistory_ChangedAt DEFAULT GETUTCDATE(),
        ChangedBy UNIQUEIDENTIFIER NOT NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ItemSupplierPriceHistory_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_ItemSupplierPriceHistory PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_ItemSupplierPriceHistory_Tenants FOREIGN KEY (TenantId)
            REFERENCES dbo.Tenants(Id),
        CONSTRAINT CK_ItemSupplierPriceHistory_Source CHECK (Source IN (N'Manual', N'Receipt')),
        CONSTRAINT FK_ItemSupplierPriceHistory_ItemSupplier FOREIGN KEY (ItemSupplierId)
            REFERENCES dbo.ItemSuppliers(Id),
        CONSTRAINT FK_ItemSupplierPriceHistory_ChangedBy FOREIGN KEY (ChangedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.ItemSupplierPriceHistory', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ItemSupplierPriceHistory_ItemSupplier_ChangedAt' AND object_id = OBJECT_ID(N'dbo.ItemSupplierPriceHistory'))
BEGIN
    CREATE INDEX IX_ItemSupplierPriceHistory_ItemSupplier_ChangedAt
        ON dbo.ItemSupplierPriceHistory (ItemSupplierId, ChangedAt DESC);
END;
GO
