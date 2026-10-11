SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Chat between a customer and the shop staff. A conversation has a kind, so more than order chat can live here later
-- (support, for example) without a change to the tables. Messages are append-only: never edited or deleted.
-- Safe to run more than once.
--
-- Conversations
--   Kind           0 = Order (about one order, titled "Order #1042"), 1 = Support (about nothing in particular)
--   OrderId        the order of an Order conversation; null for Support. An order has at most one conversation.
--   Title          what both sides see at the top of the chat
--   ClosedAt       set when the conversation is closed by hand (Support). An Order conversation closes with its order.
--   LastMessageAt  when the newest message arrived, to list conversations newest first
-- ConversationMessages
--   SenderType        0 = customer, 1 = staff
--   SenderUserId      the staff member; null for the customer
--   ReadByStaffAt     when any staff member first opened the message (the staff share one inbox)
--   ReadByCustomerAt  when the customer first saw it

-- An earlier draft of this feature created OrderMessages. Remove it only if it holds nothing.
-- Dynamic SQL, because a plain reference to a table that does not exist fails when the batch is compiled.
IF OBJECT_ID(N'dbo.OrderMessages', N'U') IS NOT NULL
BEGIN
    DECLARE @HasMessages BIT = 0;
    EXEC sp_executesql
        N'IF EXISTS (SELECT 1 FROM dbo.OrderMessages) SET @Found = 1;',
        N'@Found BIT OUTPUT',
        @Found = @HasMessages OUTPUT;

    IF @HasMessages = 0
    BEGIN
        DROP TABLE dbo.OrderMessages;
    END;
END;
GO

IF OBJECT_ID(N'dbo.Conversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Conversations
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Conversations_Id DEFAULT NEWID(),
        CustomerId UNIQUEIDENTIFIER NOT NULL,
        Kind TINYINT NOT NULL,
        OrderId UNIQUEIDENTIFIER NULL,
        Title NVARCHAR(100) NOT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_Conversations_CreatedAt DEFAULT SYSUTCDATETIME(),
        LastMessageAt DATETIME2 NOT NULL
            CONSTRAINT DF_Conversations_LastMessageAt DEFAULT SYSUTCDATETIME(),
        ClosedAt DATETIME2 NULL,
        CONSTRAINT PK_Conversations PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_Conversations_Customer FOREIGN KEY (CustomerId)
            REFERENCES dbo.Customers(Id),
        CONSTRAINT FK_Conversations_Order FOREIGN KEY (OrderId)
            REFERENCES dbo.Orders(Id),
        CONSTRAINT CK_Conversations_Kind CHECK (Kind IN (0, 1)),
        -- An Order conversation names its order; a Support conversation never does.
        CONSTRAINT CK_Conversations_Order CHECK (
            (Kind = 0 AND OrderId IS NOT NULL)
            OR (Kind = 1 AND OrderId IS NULL)),
        CONSTRAINT CK_Conversations_Title CHECK (LEN(LTRIM(RTRIM(Title))) > 0)
    );
END;
GO

-- One conversation per order.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Conversations_OrderId' AND object_id = OBJECT_ID(N'dbo.Conversations'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_Conversations_OrderId
        ON dbo.Conversations(OrderId)
        WHERE OrderId IS NOT NULL;
END;
GO

-- A customer's conversations, newest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Conversations_CustomerId_LastMessageAt' AND object_id = OBJECT_ID(N'dbo.Conversations'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Conversations_CustomerId_LastMessageAt
        ON dbo.Conversations(CustomerId, LastMessageAt DESC);
END;
GO

-- The staff inbox, newest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Conversations_LastMessageAt' AND object_id = OBJECT_ID(N'dbo.Conversations'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_Conversations_LastMessageAt
        ON dbo.Conversations(LastMessageAt DESC);
END;
GO

IF OBJECT_ID(N'dbo.ConversationMessages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConversationMessages
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ConversationMessages_Id DEFAULT NEWID(),
        ConversationId UNIQUEIDENTIFIER NOT NULL,
        SenderType TINYINT NOT NULL,
        SenderUserId UNIQUEIDENTIFIER NULL,
        Body NVARCHAR(1000) NOT NULL,
        CreatedAt DATETIME2 NOT NULL
            CONSTRAINT DF_ConversationMessages_CreatedAt DEFAULT SYSUTCDATETIME(),
        ReadByStaffAt DATETIME2 NULL,
        ReadByCustomerAt DATETIME2 NULL,
        CONSTRAINT PK_ConversationMessages PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_ConversationMessages_Conversation FOREIGN KEY (ConversationId)
            REFERENCES dbo.Conversations(Id),
        CONSTRAINT FK_ConversationMessages_SenderUser FOREIGN KEY (SenderUserId)
            REFERENCES dbo.Users(Id),
        CONSTRAINT CK_ConversationMessages_SenderType CHECK (SenderType IN (0, 1)),
        -- A staff message names its sender; a customer message never does.
        CONSTRAINT CK_ConversationMessages_Sender CHECK (
            (SenderType = 1 AND SenderUserId IS NOT NULL)
            OR (SenderType = 0 AND SenderUserId IS NULL)),
        CONSTRAINT CK_ConversationMessages_Body CHECK (LEN(LTRIM(RTRIM(Body))) > 0)
    );
END;
GO

-- A conversation, oldest first.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConversationMessages_ConversationId_CreatedAt' AND object_id = OBJECT_ID(N'dbo.ConversationMessages'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ConversationMessages_ConversationId_CreatedAt
        ON dbo.ConversationMessages(ConversationId, CreatedAt);
END;
GO

-- Unread counts for staff: customer messages nobody on the staff has opened yet.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConversationMessages_UnreadForStaff' AND object_id = OBJECT_ID(N'dbo.ConversationMessages'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ConversationMessages_UnreadForStaff
        ON dbo.ConversationMessages(ConversationId)
        WHERE SenderType = 0 AND ReadByStaffAt IS NULL;
END;
GO

-- Unread counts for the customer: staff messages the customer has not seen yet.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ConversationMessages_UnreadForCustomer' AND object_id = OBJECT_ID(N'dbo.ConversationMessages'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ConversationMessages_UnreadForCustomer
        ON dbo.ConversationMessages(ConversationId)
        WHERE SenderType = 1 AND ReadByCustomerAt IS NULL;
END;
GO
