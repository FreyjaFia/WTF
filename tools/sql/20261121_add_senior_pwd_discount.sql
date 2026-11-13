SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Senior citizen / PWD discount (see docs/roadmap/senior-pwd-discount.md). It is a checkout discount, not a promotion.
--   OrderSeniorPwdDiscounts - one row per person on an order: Type (1 Senior, 2 PWD), the ID number and the name on the ID,
--                             and what the person's covered items came to (CoveredAmount, VatExemptAmount, DiscountAmount).
--                             Append-only in intent: the app adds and removes rows with the order, never edits them.
--   OrderItems              - SeniorPwdDiscountId points at the person who covers the line (parent lines only; add-ons are
--                             covered with their parent); SeniorPwdVatExempt and SeniorPwdDiscount are that line's amounts
--                             in pesos, the order total subtracts both.
--   Products                - IsSeniorPwdEligible: only food and drinks can be covered. Default 1, so nothing changes silently.
--   TenantSettings          - SeniorPwdEnabled (off: the app hides the button and the API refuses it) and VatRegistered (off:
--                             20% comes off the price and there is no VAT-exempt amount). Both default 0.
--   Permission orders.seniorpwd.apply - built-in roles get it from code; custom roles that hold orders.write get it here.
-- Safe to run twice; it never changes an existing row except to add the permission to custom roles.

IF OBJECT_ID(N'dbo.OrderSeniorPwdDiscounts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OrderSeniorPwdDiscounts
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_OrderSeniorPwdDiscounts_Id DEFAULT (NEWID()),
        OrderId UNIQUEIDENTIFIER NOT NULL,
        [Type] TINYINT NOT NULL,
        IdNumber NVARCHAR(50) NOT NULL,
        CustomerName NVARCHAR(100) NOT NULL,
        CoveredAmount DECIMAL(10, 2) NOT NULL,
        VatExemptAmount DECIMAL(10, 2) NOT NULL,
        DiscountAmount DECIMAL(10, 2) NOT NULL,
        RecordedBy UNIQUEIDENTIFIER NOT NULL,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_OrderSeniorPwdDiscounts_CreatedAt DEFAULT GETUTCDATE(),
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_OrderSeniorPwdDiscounts_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_OrderSeniorPwdDiscounts PRIMARY KEY (Id),
        CONSTRAINT FK_OrderSeniorPwdDiscounts_Order FOREIGN KEY (OrderId) REFERENCES dbo.Orders (Id),
        CONSTRAINT FK_OrderSeniorPwdDiscounts_RecordedBy FOREIGN KEY (RecordedBy) REFERENCES dbo.Users (Id),
        CONSTRAINT FK_OrderSeniorPwdDiscounts_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderSeniorPwdDiscounts_OrderId' AND object_id = OBJECT_ID(N'dbo.OrderSeniorPwdDiscounts'))
BEGIN
    CREATE INDEX IX_OrderSeniorPwdDiscounts_OrderId ON dbo.OrderSeniorPwdDiscounts (OrderId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderSeniorPwdDiscounts_TenantId_IdNumber_CreatedAt' AND object_id = OBJECT_ID(N'dbo.OrderSeniorPwdDiscounts'))
BEGIN
    CREATE INDEX IX_OrderSeniorPwdDiscounts_TenantId_IdNumber_CreatedAt ON dbo.OrderSeniorPwdDiscounts (TenantId, IdNumber, CreatedAt);
END
GO

IF COL_LENGTH(N'dbo.OrderItems', N'SeniorPwdDiscountId') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems ADD SeniorPwdDiscountId UNIQUEIDENTIFIER NULL;
END
GO

IF COL_LENGTH(N'dbo.OrderItems', N'SeniorPwdVatExempt') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems ADD SeniorPwdVatExempt DECIMAL(10, 2) NULL;
END
GO

IF COL_LENGTH(N'dbo.OrderItems', N'SeniorPwdDiscount') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems ADD SeniorPwdDiscount DECIMAL(10, 2) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_OrderItems_SeniorPwdDiscount')
BEGIN
    ALTER TABLE dbo.OrderItems ADD CONSTRAINT FK_OrderItems_SeniorPwdDiscount
        FOREIGN KEY (SeniorPwdDiscountId) REFERENCES dbo.OrderSeniorPwdDiscounts (Id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OrderItems_SeniorPwdDiscountId' AND object_id = OBJECT_ID(N'dbo.OrderItems'))
BEGIN
    CREATE INDEX IX_OrderItems_SeniorPwdDiscountId ON dbo.OrderItems (SeniorPwdDiscountId) WHERE SeniorPwdDiscountId IS NOT NULL;
END
GO

IF COL_LENGTH(N'dbo.Products', N'IsSeniorPwdEligible') IS NULL
BEGIN
    ALTER TABLE dbo.Products ADD IsSeniorPwdEligible BIT NOT NULL CONSTRAINT DF_Products_IsSeniorPwdEligible DEFAULT (1);
END
GO

IF COL_LENGTH(N'dbo.TenantSettings', N'SeniorPwdEnabled') IS NULL
BEGIN
    ALTER TABLE dbo.TenantSettings ADD SeniorPwdEnabled BIT NOT NULL CONSTRAINT DF_TenantSettings_SeniorPwdEnabled DEFAULT (0);
END
GO

IF COL_LENGTH(N'dbo.TenantSettings', N'VatRegistered') IS NULL
BEGIN
    ALTER TABLE dbo.TenantSettings ADD VatRegistered BIT NOT NULL CONSTRAINT DF_TenantSettings_VatRegistered DEFAULT (0);
END
GO

INSERT INTO dbo.RolePermissions (RoleId, PermissionKey)
SELECT rp.RoleId, N'orders.seniorpwd.apply'
FROM dbo.RolePermissions rp
INNER JOIN dbo.UserRoles r ON r.Id = rp.RoleId
WHERE rp.PermissionKey = N'orders.write'
  AND r.TenantId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions x WHERE x.RoleId = rp.RoleId AND x.PermissionKey = N'orders.seniorpwd.apply');
GO
