SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Chat images. A message can carry one picture. The picture is not in the public Images table or container: it lives in
-- a private chat container and is only served through the chat endpoints, which check the same access as the messages.
--   ImageKey          the file's name inside the private chat container (random, made by the server). Null = no picture.
--   ImageContentType  always the type the server re-encoded it to (image/jpeg), never what the sender claimed
--   ImageWidth/Height the stored size in pixels, so the screen can reserve the space before the picture loads
--   ImageSizeBytes    the stored size
--   ImageRemovedAt    when staff removed the picture; the message stays and shows "photo removed"
-- A message needs text, a picture, or a removed picture. Safe to run more than once.

IF COL_LENGTH(N'dbo.ConversationMessages', N'ImageKey') IS NULL
BEGIN
    ALTER TABLE dbo.ConversationMessages ADD
        ImageKey NVARCHAR(200) NULL,
        ImageContentType VARCHAR(50) NULL,
        ImageWidth INT NULL,
        ImageHeight INT NULL,
        ImageSizeBytes INT NULL,
        ImageRemovedAt DATETIME2 NULL;
END;
GO

-- The old rule said the text must never be empty. A picture message may have no text.
IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_ConversationMessages_Body'
      AND parent_object_id = OBJECT_ID(N'dbo.ConversationMessages')
      AND definition NOT LIKE N'%ImageKey%')
BEGIN
    ALTER TABLE dbo.ConversationMessages DROP CONSTRAINT CK_ConversationMessages_Body;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_ConversationMessages_Body'
      AND parent_object_id = OBJECT_ID(N'dbo.ConversationMessages'))
BEGIN
    ALTER TABLE dbo.ConversationMessages WITH CHECK ADD CONSTRAINT CK_ConversationMessages_Body
        CHECK (LEN(LTRIM(RTRIM(Body))) > 0 OR ImageKey IS NOT NULL OR ImageRemovedAt IS NOT NULL);
END;
GO

-- A picture needs its details, and only a picture has them.
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_ConversationMessages_Image'
      AND parent_object_id = OBJECT_ID(N'dbo.ConversationMessages'))
BEGIN
    ALTER TABLE dbo.ConversationMessages WITH CHECK ADD CONSTRAINT CK_ConversationMessages_Image
        CHECK (
            (ImageKey IS NULL AND ImageContentType IS NULL AND ImageWidth IS NULL AND ImageHeight IS NULL AND ImageSizeBytes IS NULL)
            OR (ImageKey IS NOT NULL AND ImageContentType IS NOT NULL AND ImageWidth > 0 AND ImageHeight > 0 AND ImageSizeBytes > 0
                AND ImageRemovedAt IS NULL));
END;
GO

-- The per-customer daily limit counts a customer's pictures; this keeps that count cheap.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConversationMessages_Images' AND object_id = OBJECT_ID(N'dbo.ConversationMessages'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ConversationMessages_Images
        ON dbo.ConversationMessages(ConversationId, CreatedAt)
        WHERE ImageKey IS NOT NULL;
END;
GO
