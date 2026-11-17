SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Offline Phase 7e (see docs/roadmap/offline.md): the shop's offline sync policy, one row per shop. A shop without a row
-- uses the defaults below, which behave exactly as before this table existed, so this script adds no row.
--   <Code>Mode        What the review does with a finding of that kind when an offline sale meets a changed catalog:
--                     1 Hold (an Admin must decide, the default) or 2 Note (the sale is saved as sold and the finding is
--                     only recorded). Codes: PriceChanged, AddOnPriceChanged, ProductInactive, BundleChanged,
--                     CustomerInactive, PromotionEnded, UnknownProduct. The Senior/PWD codes are not here on purpose: they
--                     are tax records and always stay Hold. PromotionOverLimit and StockShortfall are always Notes.
--   PriceTolerance    Pesos per line (0 to 1000, default 0). A PriceChanged or AddOnPriceChanged difference at or below it
--                     is a Note instead of a Hold. Never applies to the Senior/PWD codes.
--   AutoApproveNotes  1: every sale saved with notes is also written to the audit log as OfflineOrderAutoApproved.
--                     Notes never block a sale either way. Default 0.
--   AgedAfterDays     A held order older than this many days is flagged (1 to 30, default 2).
--   UpdatedAt/By      Who last changed the policy; every change is also in the audit log (OfflineSyncPolicyChanged).
-- Permission orders.sync.policy is Owner only, from code; no custom role gets it from this script.
-- Safe to run twice.

IF OBJECT_ID(N'dbo.OfflineSyncPolicy', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OfflineSyncPolicy
    (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        PriceChangedMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_PriceChangedMode DEFAULT 1,
        AddOnPriceChangedMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_AddOnPriceChangedMode DEFAULT 1,
        ProductInactiveMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_ProductInactiveMode DEFAULT 1,
        BundleChangedMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_BundleChangedMode DEFAULT 1,
        CustomerInactiveMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_CustomerInactiveMode DEFAULT 1,
        PromotionEndedMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_PromotionEndedMode DEFAULT 1,
        UnknownProductMode TINYINT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_UnknownProductMode DEFAULT 1,
        PriceTolerance DECIMAL(10, 2) NOT NULL CONSTRAINT DF_OfflineSyncPolicy_PriceTolerance DEFAULT 0,
        AutoApproveNotes BIT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_AutoApproveNotes DEFAULT 0,
        AgedAfterDays INT NOT NULL CONSTRAINT DF_OfflineSyncPolicy_AgedAfterDays DEFAULT 2,
        UpdatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_OfflineSyncPolicy_UpdatedAt DEFAULT GETUTCDATE(),
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_OfflineSyncPolicy PRIMARY KEY CLUSTERED (TenantId),
        CONSTRAINT FK_OfflineSyncPolicy_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT FK_OfflineSyncPolicy_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users (Id),
        CONSTRAINT CK_OfflineSyncPolicy_Modes CHECK (
            PriceChangedMode IN (1, 2) AND AddOnPriceChangedMode IN (1, 2) AND ProductInactiveMode IN (1, 2)
            AND BundleChangedMode IN (1, 2) AND CustomerInactiveMode IN (1, 2) AND PromotionEndedMode IN (1, 2)
            AND UnknownProductMode IN (1, 2)),
        CONSTRAINT CK_OfflineSyncPolicy_PriceTolerance CHECK (PriceTolerance BETWEEN 0 AND 1000),
        CONSTRAINT CK_OfflineSyncPolicy_AgedAfterDays CHECK (AgedAfterDays BETWEEN 1 AND 30)
    );
END
GO
