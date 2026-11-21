SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches: which branches sell a product (docs/roadmap/multiple-branches.md, "Products and branches"). Run after 20270102.
--   ProductBranches: one row per product and branch that sells it. A product with NO row is sold at every branch (also at
--   branches opened later), so existing data and one-branch shops change nothing. A product with rows is sold only at those
--   branches; a branch-only product is a product with one row.
-- No backfill: every product starts sold everywhere. Safe to run twice.

IF OBJECT_ID(N'dbo.ProductBranches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductBranches
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_ProductBranches_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ProductId UNIQUEIDENTIFIER NOT NULL,
        BranchId UNIQUEIDENTIFIER NOT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProductBranches_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CreatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_ProductBranches PRIMARY KEY (Id),
        CONSTRAINT FK_ProductBranches_Products FOREIGN KEY (ProductId) REFERENCES dbo.Products (Id),
        CONSTRAINT FK_ProductBranches_Branches FOREIGN KEY (BranchId) REFERENCES dbo.Branches (Id),
        CONSTRAINT FK_ProductBranches_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT UQ_ProductBranches_ProductBranch UNIQUE (ProductId, BranchId)
    );

    CREATE INDEX IX_ProductBranches_BranchId ON dbo.ProductBranches (BranchId);
END
GO
