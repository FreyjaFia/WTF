SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Customers.ContactNumber: an optional phone number saved on the customer, used to prefill the
-- contact field when the customer orders through their personal link. Safe to run more than once.
-- NVARCHAR(30) matches Orders.ContactNumber, so a saved number always fits on an order.
IF OBJECT_ID(N'dbo.Customers', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Customers', N'ContactNumber') IS NULL
BEGIN
    ALTER TABLE dbo.Customers ADD ContactNumber NVARCHAR(30) NULL;
END;
GO
