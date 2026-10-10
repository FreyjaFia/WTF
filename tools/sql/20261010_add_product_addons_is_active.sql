SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Product add-on links are soft deleted: unlinking sets IsActive = 0 and keeps
-- the row (and its price override) so history is preserved and re-linking
-- reuses the same row.
IF OBJECT_ID(N'dbo.ProductAddOns', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ProductAddOns', N'IsActive') IS NULL
BEGIN
    ALTER TABLE dbo.ProductAddOns
        ADD IsActive BIT NOT NULL
            CONSTRAINT DF_ProductAddOns_IsActive DEFAULT (1);
END;
GO

-- The add-on validation now lives in the application (assign handlers and
-- UpdateProductHandler), and unlinking is an UPDATE (IsActive = 0), which the
-- old trigger would have blocked for stale links. Drop the trigger.
IF OBJECT_ID(N'dbo.TR_ProductAddOns_ValidateAddOn', N'TR') IS NOT NULL
BEGIN
    DROP TRIGGER dbo.TR_ProductAddOns_ValidateAddOn;
END;
GO
