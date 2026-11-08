SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Multi-tenant Phase 3: the platform admin (outside every tenant), its audit trail, a record of deleted tenants and the
-- "must change password" flag on users (set when a platform admin resets a password). Safe to run twice.

IF OBJECT_ID(N'dbo.PlatformAdmins', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PlatformAdmins
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_PlatformAdmins_Id DEFAULT (NEWID()),
        Username VARCHAR(50) NOT NULL,
        PasswordHash NVARCHAR(200) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_PlatformAdmins_IsActive DEFAULT 1,
        FailedAttempts INT NOT NULL CONSTRAINT DF_PlatformAdmins_FailedAttempts DEFAULT 0,
        LockedUntil DATETIME2(7) NULL,
        LastLoginAt DATETIME2(7) NULL,
        CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_PlatformAdmins_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PlatformAdmins PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT UQ_PlatformAdmins_Username UNIQUE (Username)
    );
END
GO

IF OBJECT_ID(N'dbo.PlatformAuditLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PlatformAuditLog
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_PlatformAuditLog_Id DEFAULT (NEWID()),
        PlatformAdminId UNIQUEIDENTIFIER NULL,
        Username VARCHAR(50) NULL,
        Action VARCHAR(50) NOT NULL,
        TenantId UNIQUEIDENTIFIER NULL,
        Details NVARCHAR(2000) NULL,
        IpAddress VARCHAR(64) NULL,
        Timestamp DATETIME2(7) NOT NULL CONSTRAINT DF_PlatformAuditLog_Timestamp DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PlatformAuditLog PRIMARY KEY CLUSTERED (Id)
    );

    CREATE INDEX IX_PlatformAuditLog_Timestamp ON dbo.PlatformAuditLog (Timestamp DESC);
    CREATE INDEX IX_PlatformAuditLog_TenantId ON dbo.PlatformAuditLog (TenantId);
END
GO

IF OBJECT_ID(N'dbo.TenantTombstones', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenantTombstones
    (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        Slug VARCHAR(50) NOT NULL,
        Name NVARCHAR(100) NOT NULL,
        DeletedAt DATETIME2(7) NOT NULL CONSTRAINT DF_TenantTombstones_DeletedAt DEFAULT SYSUTCDATETIME(),
        DeletedBy VARCHAR(50) NOT NULL,
        RowCounts NVARCHAR(MAX) NULL,
        CONSTRAINT PK_TenantTombstones PRIMARY KEY CLUSTERED (TenantId)
    );
END
GO

IF COL_LENGTH(N'dbo.Users', N'MustChangePassword') IS NULL
BEGIN
    ALTER TABLE dbo.Users ADD MustChangePassword BIT NOT NULL CONSTRAINT DF_Users_MustChangePassword DEFAULT 0;
END
GO
