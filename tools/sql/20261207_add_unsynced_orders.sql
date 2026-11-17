SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Offline Phase 7e (see docs/roadmap/offline.md): orders a register sold offline that the server could not save (an unknown
-- or deleted product, bad data). Until now only the cashier's device knew about them.
--   UnsyncedOrders - one row per queue number (OfflineLocalId, unique per tenant): the order as the device sent it
--                    (QuotedOrderJson, the create-order body), the error and a short ErrorCode, the cashier, when the device
--                    made the order (DeviceCreatedAt) and when the server got it (ReceivedAt), and the total the register quoted.
--                    StatusId 1 Open, 2 Resolved. Resolution (set when resolved): 1 Retried (the order was saved after a fix),
--                    2 NoteOnly (saved as a cancelled record for the cash drawer), 3 Discarded (DiscardReason says why).
--                    ResultingOrderId points at the saved order. A row is never deleted.
-- Safe to run twice; it never changes an existing row.

IF OBJECT_ID(N'dbo.UnsyncedOrders', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UnsyncedOrders
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_UnsyncedOrders_Id DEFAULT (NEWID()),
        OfflineLocalId NVARCHAR(40) NOT NULL,
        QuotedOrderJson NVARCHAR(MAX) NOT NULL,
        ErrorText NVARCHAR(500) NOT NULL,
        ErrorCode NVARCHAR(40) NOT NULL,
        CashierUserId UNIQUEIDENTIFIER NOT NULL,
        DeviceCreatedAt DATETIME2(7) NULL,
        ReceivedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_UnsyncedOrders_ReceivedAt DEFAULT GETUTCDATE(),
        QuotedTotal DECIMAL(18, 2) NULL,
        StatusId TINYINT NOT NULL
            CONSTRAINT DF_UnsyncedOrders_StatusId DEFAULT (1),
        Resolution TINYINT NULL,
        ResolvedBy UNIQUEIDENTIFIER NULL,
        ResolvedAt DATETIME2(7) NULL,
        DiscardReason NVARCHAR(500) NULL,
        ResultingOrderId UNIQUEIDENTIFIER NULL,
        TenantId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_UnsyncedOrders_TenantId DEFAULT ('00000000-0000-0000-0000-000000000001'),
        CONSTRAINT PK_UnsyncedOrders PRIMARY KEY (Id),
        CONSTRAINT FK_UnsyncedOrders_Cashier FOREIGN KEY (CashierUserId) REFERENCES dbo.Users (Id),
        CONSTRAINT FK_UnsyncedOrders_ResolvedBy FOREIGN KEY (ResolvedBy) REFERENCES dbo.Users (Id),
        CONSTRAINT FK_UnsyncedOrders_ResultingOrder FOREIGN KEY (ResultingOrderId) REFERENCES dbo.Orders (Id),
        CONSTRAINT FK_UnsyncedOrders_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_UnsyncedOrders_TenantId_OfflineLocalId' AND object_id = OBJECT_ID(N'dbo.UnsyncedOrders'))
BEGIN
    CREATE UNIQUE INDEX UX_UnsyncedOrders_TenantId_OfflineLocalId ON dbo.UnsyncedOrders (TenantId, OfflineLocalId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UnsyncedOrders_TenantId_StatusId_ReceivedAt' AND object_id = OBJECT_ID(N'dbo.UnsyncedOrders'))
BEGIN
    CREATE INDEX IX_UnsyncedOrders_TenantId_StatusId_ReceivedAt ON dbo.UnsyncedOrders (TenantId, StatusId, ReceivedAt);
END
GO
