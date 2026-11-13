SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Customer address on orders.
--   Customers.LastName     - may now be empty (NULL). A quick customer made from the order screen has a first name only.
--                            Existing rows are not changed.
--   Orders.CustomerAddress - the address kept on the order itself (nvarchar(150), NULL when there is none). It is filled when
--                            the order is created and never follows later edits of the customer. Orders made before this
--                            script keep NULL; nothing is back-filled.
--   Customers.Address      - new or changed addresses may be at most 150 characters (CHECK constraint added WITH NOCHECK, so
--                            longer addresses already saved stay as they are; they must be shortened before they are edited).
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
    ALTER TABLE dbo.Orders ADD CustomerAddress NVARCHAR(150) NULL;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.Orders') AND name = N'CustomerAddress' AND max_length > 300)
   AND NOT EXISTS (SELECT 1 FROM dbo.Orders WHERE LEN(CustomerAddress) > 150)
BEGIN
    ALTER TABLE dbo.Orders ALTER COLUMN CustomerAddress NVARCHAR(150) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Customers_Address_Length')
BEGIN
    ALTER TABLE dbo.Customers WITH NOCHECK
        ADD CONSTRAINT CK_Customers_Address_Length CHECK (Address IS NULL OR LEN(Address) <= 150);
END
GO
