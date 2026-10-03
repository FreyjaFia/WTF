SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.ProductAddOnPriceOverrides', N'U') IS NOT NULL
   AND EXISTS
   (
       SELECT 1
       FROM sys.check_constraints
       WHERE name = N'CK_ProductAddOnPriceOverrides_Price'
         AND parent_object_id = OBJECT_ID(N'dbo.ProductAddOnPriceOverrides')
   )
BEGIN
    ALTER TABLE dbo.ProductAddOnPriceOverrides
        DROP CONSTRAINT CK_ProductAddOnPriceOverrides_Price;
END;
GO