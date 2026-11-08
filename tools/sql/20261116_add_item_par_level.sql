SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Par levels (Inventory Phase 8, slice 3). Items.ParLevel is the quantity the shop wants to hold of an item, in the item's
-- unit. It sits beside the warning and critical levels: those say when to worry, par says how much to buy back up to. An
-- item with no par level never appears on the reorder list. NULL means not set. Existing rows stay NULL. Safe to run twice.

IF COL_LENGTH(N'dbo.Items', N'ParLevel') IS NULL
BEGIN
    ALTER TABLE dbo.Items ADD ParLevel DECIMAL(18, 3) NULL;
END;
GO

IF COL_LENGTH(N'dbo.Items', N'ParLevel') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_Items_ParLevel')
BEGIN
    ALTER TABLE dbo.Items ADD CONSTRAINT CK_Items_ParLevel CHECK (ParLevel IS NULL OR ParLevel >= 0);
END;
GO
