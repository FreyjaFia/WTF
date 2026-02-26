SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.AuditLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLog
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_AuditLog_Id DEFAULT NEWID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        Action NVARCHAR(50) NOT NULL,
        EntityType NVARCHAR(50) NOT NULL,
        EntityId NVARCHAR(50) NOT NULL,
        OldValues NVARCHAR(MAX) NULL,
        NewValues NVARCHAR(MAX) NULL,
        IpAddress NVARCHAR(50) NULL,
        [Timestamp] DATETIME2(7) NOT NULL
            CONSTRAINT DF_AuditLog_Timestamp DEFAULT GETUTCDATE(),
        CONSTRAINT PK_AuditLog PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_AuditLog_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLog_UserId' AND object_id = OBJECT_ID(N'dbo.AuditLog'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_AuditLog_UserId ON dbo.AuditLog(UserId);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLog_Action' AND object_id = OBJECT_ID(N'dbo.AuditLog'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_AuditLog_Action ON dbo.AuditLog([Action]);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLog_EntityType' AND object_id = OBJECT_ID(N'dbo.AuditLog'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_AuditLog_EntityType ON dbo.AuditLog(EntityType);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AuditLog_Timestamp' AND object_id = OBJECT_ID(N'dbo.AuditLog'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_AuditLog_Timestamp ON dbo.AuditLog([Timestamp] DESC);
END
GO
