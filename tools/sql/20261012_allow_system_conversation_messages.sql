SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- A chat message can now also come from the system: a line such as "Order accepted" written when the order moves on.
-- It has SenderType 2. It may name the staff member who made the change (SenderUserId), or none. It is never unread,
-- because only customer (0) and staff (1) messages are counted as unread.
-- Safe to run more than once: it only changes the two checks while they still reject SenderType 2.

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_ConversationMessages_SenderType'
      AND parent_object_id = OBJECT_ID(N'dbo.ConversationMessages')
      AND definition NOT LIKE N'%2%')
BEGIN
    ALTER TABLE dbo.ConversationMessages DROP CONSTRAINT CK_ConversationMessages_SenderType;
    ALTER TABLE dbo.ConversationMessages WITH CHECK ADD CONSTRAINT CK_ConversationMessages_SenderType
        CHECK (SenderType IN (0, 1, 2));
END;
GO

IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_ConversationMessages_Sender'
      AND parent_object_id = OBJECT_ID(N'dbo.ConversationMessages')
      AND definition NOT LIKE N'%2%')
BEGIN
    ALTER TABLE dbo.ConversationMessages DROP CONSTRAINT CK_ConversationMessages_Sender;
    -- A staff message names its sender; a customer message never does; a system line may or may not.
    ALTER TABLE dbo.ConversationMessages WITH CHECK ADD CONSTRAINT CK_ConversationMessages_Sender
        CHECK (
            (SenderType = 1 AND SenderUserId IS NOT NULL)
            OR (SenderType = 0 AND SenderUserId IS NULL)
            OR SenderType = 2);
END;
GO
