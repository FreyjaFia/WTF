SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Completed orders can be corrected by Admins and above (order override). Keep why and when
-- on the order itself so order details can show it without the SuperAdmin-only audit log:
--   OverrideReason - the reason given for the latest override (NULL = never overridden)
--   OverriddenAt   - when the latest override happened (UTC)
-- Each override still writes the full before/after to the audit log; these columns only hold
-- the latest one.
IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'OverrideReason') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD OverrideReason NVARCHAR(500) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'OverriddenAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD OverriddenAt DATETIME2 NULL;
END;
GO
