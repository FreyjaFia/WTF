SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Order progress for customer link orders. The customer sees a timeline: placed, accepted, ready, completed.
-- Placed is Orders.CreatedAt, and the end of an order (completed, rejected, cancelled) is its last update, so only
-- the two steps in between need their own time. Safe to run more than once (UTC, like the other order times).
--   Orders.AcceptedAt - when staff accepted the order (waiting -> pending)
--   Orders.ReadyAt    - when staff marked it ready for pickup or delivery
-- Orders accepted before this script ran have no AcceptedAt; their timeline simply leaves that time out.

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'AcceptedAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD AcceptedAt DATETIME2 NULL;
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'ReadyAt') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD ReadyAt DATETIME2 NULL;
END;
GO
