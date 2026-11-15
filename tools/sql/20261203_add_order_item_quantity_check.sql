SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Order item quantities must be 1 to 9999 (add-ons are order items with a parent, so one constraint covers both).
--  1. Rows outside that range are clamped to the nearest limit (0 or less becomes 1, more than 9999 becomes 9999).
--     No order or item is deleted. Each clamped row is listed in PlatformAuditLog (action 'OrderItemQuantityClamped')
--     with its old value, so the shop can correct the price by hand if needed. Nothing is touched when none exist.
--  2. CK_OrderItems_Quantity_Range is added WITH CHECK, so it is trusted. Skipped if it already exists.
-- Safe to run twice.

IF EXISTS (SELECT 1 FROM dbo.OrderItems WHERE Quantity < 1 OR Quantity > 9999)
BEGIN
    BEGIN TRAN;

    INSERT INTO dbo.PlatformAuditLog (Username, Action, TenantId, Details)
    SELECT 'script', 'OrderItemQuantityClamped', i.TenantId,
           LEFT(N'OrderItem ' + CAST(i.Id AS NVARCHAR(40)) + N' of order ' + CAST(i.OrderId AS NVARCHAR(40))
                + N': quantity ' + CAST(i.Quantity AS NVARCHAR(20)) + N' changed to '
                + CASE WHEN i.Quantity < 1 THEN N'1' ELSE N'9999' END, 2000)
    FROM dbo.OrderItems i
    WHERE i.Quantity < 1 OR i.Quantity > 9999;

    UPDATE dbo.OrderItems
    SET Quantity = CASE WHEN Quantity < 1 THEN 1 ELSE 9999 END
    WHERE Quantity < 1 OR Quantity > 9999;

    COMMIT;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_OrderItems_Quantity_Range')
BEGIN
    ALTER TABLE dbo.OrderItems WITH CHECK
        ADD CONSTRAINT CK_OrderItems_Quantity_Range CHECK (Quantity >= 1 AND Quantity <= 9999);
END
GO
