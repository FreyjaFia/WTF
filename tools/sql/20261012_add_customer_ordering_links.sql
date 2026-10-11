SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Customer ordering links (Phase 1): selected customers can place orders themselves through a
-- personal link. This script only adds the schema; it is safe to run more than once.
--   Customers.AllowOrderingLink - opt-in per customer (default off)
--   ShortLinks                  - token widened to 64 chars; created/revoked/last-used tracking
--   Orders                      - where an order came from, how it is fulfilled, and why it was rejected
--   Statuses                    - PendingApproval (id 5): a link order waiting for staff approval
--   Users                       - inactive "Customer Link" system user that owns link orders
-- Check the live Statuses data before running: this script assumes id 5 is free.

-- Customers.AllowOrderingLink
IF OBJECT_ID(N'dbo.Customers', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Customers', N'AllowOrderingLink') IS NULL
BEGIN
    ALTER TABLE dbo.Customers
        ADD AllowOrderingLink BIT NOT NULL
        CONSTRAINT DF_Customers_AllowOrderingLink DEFAULT (0);
END;
GO

-- ShortLinks.Token: 32 random bytes in base64url are 43 characters, so widen from varchar(20).
-- The unique index IX_ShortLinks depends on the column, so drop and recreate it around the change.
IF OBJECT_ID(N'dbo.ShortLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ShortLinks', N'Token') < 64
BEGIN
    -- Depending on how it was created, IX_ShortLinks is either a UNIQUE constraint (cannot be dropped
    -- with DROP INDEX) or a plain unique index. Drop and recreate whichever kind it is.
    DECLARE @IsConstraint BIT = 0;

    IF EXISTS (SELECT 1 FROM sys.key_constraints
               WHERE name = N'IX_ShortLinks' AND parent_object_id = OBJECT_ID(N'dbo.ShortLinks'))
    BEGIN
        SET @IsConstraint = 1;
        ALTER TABLE dbo.ShortLinks DROP CONSTRAINT IX_ShortLinks;
    END
    ELSE IF EXISTS (SELECT 1 FROM sys.indexes
                    WHERE name = N'IX_ShortLinks' AND object_id = OBJECT_ID(N'dbo.ShortLinks'))
    BEGIN
        DROP INDEX IX_ShortLinks ON dbo.ShortLinks;
    END

    ALTER TABLE dbo.ShortLinks ALTER COLUMN Token VARCHAR(64) NOT NULL;

    IF @IsConstraint = 1
        ALTER TABLE dbo.ShortLinks ADD CONSTRAINT IX_ShortLinks UNIQUE (Token);
    ELSE
        CREATE UNIQUE INDEX IX_ShortLinks ON dbo.ShortLinks (Token);
END;
GO

IF OBJECT_ID(N'dbo.ShortLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ShortLinks', N'CreatedAt') IS NULL
BEGIN
    ALTER TABLE dbo.ShortLinks
        ADD CreatedAt DATETIME2 NOT NULL
        CONSTRAINT DF_ShortLinks_CreatedAt DEFAULT (SYSUTCDATETIME());
END;
GO

IF OBJECT_ID(N'dbo.ShortLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ShortLinks', N'CreatedBy') IS NULL
BEGIN
    ALTER TABLE dbo.ShortLinks ADD CreatedBy UNIQUEIDENTIFIER NULL;
    -- EXEC: the new column does not exist yet when this batch is compiled.
    EXEC (N'ALTER TABLE dbo.ShortLinks ADD CONSTRAINT FK_ShortLinks_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users (Id)');
    EXEC (N'CREATE INDEX IX_ShortLinks_CreatedBy ON dbo.ShortLinks (CreatedBy)');
END;
GO

IF OBJECT_ID(N'dbo.ShortLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ShortLinks', N'RevokedAt') IS NULL
BEGIN
    ALTER TABLE dbo.ShortLinks ADD RevokedAt DATETIME2 NULL;
END;
GO

IF OBJECT_ID(N'dbo.ShortLinks', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.ShortLinks', N'LastUsedAt') IS NULL
BEGIN
    ALTER TABLE dbo.ShortLinks ADD LastUsedAt DATETIME2 NULL;
END;
GO

-- Orders: Source 0 = POS, 1 = CustomerLink. FulfillmentType 0 = Pickup, 1 = Delivery (NULL for POS orders).
IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'Source') IS NULL
BEGIN
    ALTER TABLE dbo.Orders
        ADD Source TINYINT NOT NULL
        CONSTRAINT DF_Orders_Source DEFAULT (0);
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'OrderLinkId') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD OrderLinkId UNIQUEIDENTIFIER NULL;
    EXEC (N'ALTER TABLE dbo.Orders ADD CONSTRAINT FK_Orders_OrderLink FOREIGN KEY (OrderLinkId) REFERENCES dbo.ShortLinks (Id)');
    EXEC (N'CREATE INDEX IX_Orders_OrderLinkId ON dbo.Orders (OrderLinkId)');
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'FulfillmentType') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD FulfillmentType TINYINT NULL;
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'DeliveryAddress') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD DeliveryAddress NVARCHAR(300) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'ContactNumber') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD ContactNumber NVARCHAR(30) NULL;
END;
GO

IF OBJECT_ID(N'dbo.Orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.Orders', N'RejectionReason') IS NULL
BEGIN
    ALTER TABLE dbo.Orders ADD RejectionReason NVARCHAR(500) NULL;
END;
GO

-- Statuses: PendingApproval (id 5). Statuses.Id may be an identity column, so insert the id explicitly.
IF OBJECT_ID(N'dbo.Statuses', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.Statuses WHERE Id = 5)
BEGIN
    IF COLUMNPROPERTY(OBJECT_ID(N'dbo.Statuses'), N'Id', 'IsIdentity') = 1
    BEGIN
        SET IDENTITY_INSERT dbo.Statuses ON;
        INSERT INTO dbo.Statuses (Id, Name) VALUES (5, 'PendingApproval');
        SET IDENTITY_INSERT dbo.Statuses OFF;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.Statuses (Id, Name) VALUES (5, 'PendingApproval');
    END
END;
GO

-- System user that owns orders placed through a link (Orders.CreatedBy is a required foreign key).
-- It is inactive and its password hash is not a valid hash, so nobody can sign in as it.
-- The API finds it by the fixed username 'customer-link'. RoleId 2 = Cashier.
IF OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Username = 'customer-link')
BEGIN
    DECLARE @SystemUserId UNIQUEIDENTIFIER = NEWID();

    INSERT INTO dbo.Users (Id, Username, PasswordHash, FirstName, LastName, IsActive, RoleId, CreatedAt, CreatedBy)
    VALUES (@SystemUserId, 'customer-link', '!', 'Customer', 'Link', 0, 2, GETUTCDATE(), @SystemUserId);
END;
GO
