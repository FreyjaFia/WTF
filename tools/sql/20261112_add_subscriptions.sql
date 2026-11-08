SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Multi-tenant Phase 4: plans, subscriptions with manual invoices, and per-shop branding settings.
-- Plans, TenantSubscriptions and TenantInvoices are global tables (no query filter; read only through the platform area and the
-- shop's own subscription endpoint). TenantSettings is tenant-owned (one row per shop, key TenantId).
-- Seeds two plans and, for every shop that has none, a Pro subscription with 60 free days (the pilot) and a settings row built
-- from the shop's name with today's defaults (Asia/Manila, PHP). Safe to run twice; existing rows are never changed.

IF OBJECT_ID(N'dbo.Plans', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Plans
    (
        Id INT IDENTITY(1, 1) NOT NULL,
        Code VARCHAR(30) NOT NULL,
        Name NVARCHAR(60) NOT NULL,
        MonthlyPrice DECIMAL(10, 2) NOT NULL,
        Features VARCHAR(500) NOT NULL CONSTRAINT DF_Plans_Features DEFAULT '',
        MaxUsers INT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_Plans_IsActive DEFAULT 1,
        SortOrder INT NOT NULL CONSTRAINT DF_Plans_SortOrder DEFAULT 0,
        CONSTRAINT PK_Plans PRIMARY KEY CLUSTERED (Id)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Plans_Code' AND object_id = OBJECT_ID(N'dbo.Plans'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_Plans_Code ON dbo.Plans (Code);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Plans WHERE Code = 'starter')
BEGIN
    INSERT INTO dbo.Plans (Code, Name, MonthlyPrice, Features, MaxUsers, SortOrder)
    VALUES ('starter', N'Starter', 1500, 'pos,orders,reports,offline', NULL, 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Plans WHERE Code = 'pro')
BEGIN
    INSERT INTO dbo.Plans (Code, Name, MonthlyPrice, Features, MaxUsers, SortOrder)
    VALUES ('pro', N'Pro', 2500, 'pos,orders,reports,offline,inventory,promotions,orderlinks,chat,workbook', NULL, 2);
END
GO

IF OBJECT_ID(N'dbo.TenantSubscriptions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenantSubscriptions
    (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        PlanId INT NOT NULL,
        CurrentPeriodStart DATETIME2(7) NOT NULL,
        CurrentPeriodEnd DATETIME2(7) NOT NULL,
        GraceDays INT NOT NULL CONSTRAINT DF_TenantSubscriptions_GraceDays DEFAULT 7,
        DiscountPercent DECIMAL(5, 2) NOT NULL CONSTRAINT DF_TenantSubscriptions_Discount DEFAULT 0,
        Notes NVARCHAR(500) NULL,
        ReminderSentOn DATE NULL,
        UpdatedAt DATETIME2(7) NULL,
        CONSTRAINT PK_TenantSubscriptions PRIMARY KEY CLUSTERED (TenantId),
        CONSTRAINT FK_TenantSubscriptions_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT FK_TenantSubscriptions_Plans FOREIGN KEY (PlanId) REFERENCES dbo.Plans (Id),
        CONSTRAINT CK_TenantSubscriptions_Period CHECK (CurrentPeriodEnd > CurrentPeriodStart),
        CONSTRAINT CK_TenantSubscriptions_Grace CHECK (GraceDays BETWEEN 0 AND 90),
        CONSTRAINT CK_TenantSubscriptions_Discount CHECK (DiscountPercent BETWEEN 0 AND 100)
    );
END
GO

IF OBJECT_ID(N'dbo.TenantInvoices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenantInvoices
    (
        Id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_TenantInvoices_Id DEFAULT (NEWID()),
        TenantId UNIQUEIDENTIFIER NOT NULL,
        PlanId INT NOT NULL,
        PeriodStart DATETIME2(7) NOT NULL,
        PeriodEnd DATETIME2(7) NOT NULL,
        Months INT NOT NULL,
        Amount DECIMAL(12, 2) NOT NULL,
        Status TINYINT NOT NULL CONSTRAINT DF_TenantInvoices_Status DEFAULT 1,
        Reference NVARCHAR(100) NULL,
        DueDate DATETIME2(7) NULL,
        PaidAt DATETIME2(7) NULL,
        Notes NVARCHAR(500) NULL,
        CreatedAt DATETIME2(7) NOT NULL CONSTRAINT DF_TenantInvoices_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TenantInvoices PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_TenantInvoices_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT FK_TenantInvoices_Plans FOREIGN KEY (PlanId) REFERENCES dbo.Plans (Id),
        CONSTRAINT CK_TenantInvoices_Status CHECK (Status IN (1, 2, 3)),
        CONSTRAINT CK_TenantInvoices_Months CHECK (Months BETWEEN 1 AND 60)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TenantInvoices_TenantId_CreatedAt' AND object_id = OBJECT_ID(N'dbo.TenantInvoices'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_TenantInvoices_TenantId_CreatedAt ON dbo.TenantInvoices (TenantId, CreatedAt);
END
GO

IF OBJECT_ID(N'dbo.TenantSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TenantSettings
    (
        TenantId UNIQUEIDENTIFIER NOT NULL,
        ShopName NVARCHAR(100) NOT NULL,
        ShortName NVARCHAR(30) NULL,
        Tagline NVARCHAR(150) NULL,
        LogoUrl VARCHAR(500) NULL,
        Address NVARCHAR(300) NULL,
        Phone NVARCHAR(40) NULL,
        Email NVARCHAR(150) NULL,
        ReceiptHeader NVARCHAR(300) NULL,
        ReceiptFooter NVARCHAR(300) NULL,
        RegistrationText NVARCHAR(150) NULL,
        PrimaryColor VARCHAR(9) NOT NULL CONSTRAINT DF_TenantSettings_PrimaryColor DEFAULT '#6f4e37',
        TimeZone VARCHAR(64) NOT NULL CONSTRAINT DF_TenantSettings_TimeZone DEFAULT 'Asia/Manila',
        CurrencySymbol NVARCHAR(8) NOT NULL CONSTRAINT DF_TenantSettings_CurrencySymbol DEFAULT NCHAR(8369),
        CurrencyCode VARCHAR(3) NOT NULL CONSTRAINT DF_TenantSettings_CurrencyCode DEFAULT 'PHP',
        CurrencyDecimals INT NOT NULL CONSTRAINT DF_TenantSettings_CurrencyDecimals DEFAULT 2,
        UpdatedAt DATETIME2(7) NULL,
        CONSTRAINT PK_TenantSettings PRIMARY KEY CLUSTERED (TenantId),
        CONSTRAINT FK_TenantSettings_Tenants FOREIGN KEY (TenantId) REFERENCES dbo.Tenants (Id),
        CONSTRAINT CK_TenantSettings_Decimals CHECK (CurrencyDecimals BETWEEN 0 AND 3)
    );
END
GO

INSERT INTO dbo.TenantSubscriptions (TenantId, PlanId, CurrentPeriodStart, CurrentPeriodEnd, GraceDays, Notes)
SELECT t.Id,
       (SELECT TOP (1) Id FROM dbo.Plans WHERE Code = 'pro'),
       SYSUTCDATETIME(),
       DATEADD(DAY, 60, SYSUTCDATETIME()),
       7,
       N'Pilot: 60 days free.'
FROM dbo.Tenants t
WHERE t.Status IN (1, 2)
  AND NOT EXISTS (SELECT 1 FROM dbo.TenantSubscriptions s WHERE s.TenantId = t.Id);
GO

INSERT INTO dbo.TenantSettings (TenantId, ShopName)
SELECT t.Id, t.Name
FROM dbo.Tenants t
WHERE NOT EXISTS (SELECT 1 FROM dbo.TenantSettings s WHERE s.TenantId = t.Id);
GO
