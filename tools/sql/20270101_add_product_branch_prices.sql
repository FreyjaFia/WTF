SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches: a price per branch (docs/roadmap/multiple-branches-and-tenants.md). Run after 20261220.
--   ProductBranchPrices: an optional price for one product (or add-on) in one branch. A branch with no row uses the
--   product's own price, so existing data and existing branches change nothing. Deleting the row goes back to the shop price.
-- No backfill: every branch starts on the shop price. Safe to run twice.

IF OBJECT_ID(N'dbo.ProductBranchPrices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductBranchPrices
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ProductBranchPrices_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ProductId UNIQUEIDENTIFIER NOT NULL,
        BranchId UNIQUEIDENTIFIER NOT NULL,
        Price DECIMAL(10, 2) NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProductBranchPrices_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy UNIQUEIDENTIFIER NULL,
        UpdatedAt DATETIME2 NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_ProductBranchPrices PRIMARY KEY (Id),
        CONSTRAINT FK_ProductBranchPrices_Products FOREIGN KEY (ProductId) REFERENCES dbo.Products (Id),
        CONSTRAINT FK_ProductBranchPrices_Branches FOREIGN KEY (BranchId) REFERENCES dbo.Branches (Id),
        CONSTRAINT FK_ProductBranchPrices_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT UQ_ProductBranchPrices_ProductBranch UNIQUE (ProductId, BranchId),
        CONSTRAINT CK_ProductBranchPrices_Price CHECK (Price >= 0)
    );

    CREATE INDEX IX_ProductBranchPrices_BranchId ON dbo.ProductBranchPrices (BranchId);
END
GO
