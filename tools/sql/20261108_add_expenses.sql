SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Expenses (Inventory Phase 9, running costs). The shop's own costs that are not stock: rent, salaries, utilities and so
-- on, entered by an Admin so the Profit and Loss report can take them off the actual gross profit. One row per expense:
--   ExpenseDate  - the local day the cost belongs to (a date, not a moment): rent for November is dated in November.
--   Category     - 1 Rent, 2 Salaries, 3 Utilities, 4 Supplies, 5 Marketing, 6 Delivery, 7 Payment fees, 8 Other.
--   Amount       - pesos, always above zero (a refund or credit is a note on a later entry, not a negative expense).
--   Note         - what it was for; required in the app for Other.
--   IsActive     - soft delete, like the other management records: a deleted expense stops counting and can be restored.
-- Safe to run twice.

IF OBJECT_ID(N'dbo.Expenses', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Expenses
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Expenses_Id DEFAULT (NEWID()),
        ExpenseDate DATE NOT NULL,
        Category TINYINT NOT NULL,
        Amount DECIMAL(18, 2) NOT NULL,
        Note NVARCHAR(200) NULL,
        IsActive BIT NOT NULL
            CONSTRAINT DF_Expenses_IsActive DEFAULT 1,
        CreatedAt DATETIME2(7) NOT NULL
            CONSTRAINT DF_Expenses_CreatedAt DEFAULT GETUTCDATE(),
        CreatedBy UNIQUEIDENTIFIER NOT NULL,
        UpdatedAt DATETIME2(7) NULL,
        UpdatedBy UNIQUEIDENTIFIER NULL,
        CONSTRAINT PK_Expenses PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT CK_Expenses_Category CHECK (Category BETWEEN 1 AND 8),
        CONSTRAINT CK_Expenses_Amount CHECK (Amount > 0),
        CONSTRAINT FK_Expenses_CreatedBy FOREIGN KEY (CreatedBy)
            REFERENCES dbo.Users(Id),
        CONSTRAINT FK_Expenses_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF OBJECT_ID(N'dbo.Expenses', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Expenses_ExpenseDate' AND object_id = OBJECT_ID(N'dbo.Expenses'))
BEGIN
    CREATE INDEX IX_Expenses_ExpenseDate ON dbo.Expenses (ExpenseDate DESC, Category);
END;
GO
