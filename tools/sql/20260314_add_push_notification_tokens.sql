SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.PushNotificationTokens', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PushNotificationTokens
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PushNotificationTokens_Id DEFAULT NEWID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        Platform NVARCHAR(20) NOT NULL,
        Token NVARCHAR(512) NOT NULL,
        DeviceId NVARCHAR(100) NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_PushNotificationTokens_IsActive DEFAULT (1),
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_PushNotificationTokens_CreatedAt DEFAULT (GETUTCDATE()),
        LastSeenAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_PushNotificationTokens_LastSeenAt DEFAULT (GETUTCDATE()),
        CONSTRAINT PK_PushNotificationTokens PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_PushNotificationTokens_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_PushNotificationTokens_Token'
      AND object_id = OBJECT_ID(N'dbo.PushNotificationTokens'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_PushNotificationTokens_Token
        ON dbo.PushNotificationTokens(Token);
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_PushNotificationTokens_UserId'
      AND object_id = OBJECT_ID(N'dbo.PushNotificationTokens'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_PushNotificationTokens_UserId
        ON dbo.PushNotificationTokens(UserId);
END
GO
