SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Customer address on orders.
--   Customers.LastName     - may now be empty (NULL). A quick customer made from the order screen has a first name only.
--                            Existing rows are not changed.
--   Orders.CustomerAddress - the address kept on the order itself (nvarchar(300), NULL when there is none). It is filled when
--                            the order is created and never follows later edits of the customer. Orders made before this
--                            script keep NULL; nothing is back-filled.
-- Safe to run twice; it never changes existing data.

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Customers') AND name = N'LastName' AND is_nullable = 0)
BEGIN
    ALTER TABLE dbo.Customers ALTER COLUMN LastName VARCHAR(50) NULL;
END
GO

IF COL_LENGTH(N'dbo.Orders', N'CustomerAddress') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD CustomerAddress NVARCHAR(300) NULL;
END
GO
