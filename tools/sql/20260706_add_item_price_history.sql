SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.ItemPriceHistory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ItemPriceHistory
    (
        Id UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ItemPriceHistory_Id DEFAULT NEWID(),
        ItemId UNIQUEIDENTIFIER NOT NULL,
        OldPrice DECIMAL(10, 2) NULL,
        NewPrice DECIMAL(10, 2) NOT NULL,
        UpdatedAt DATETIME NOT NULL
            CONSTRAINT DF_ItemPriceHistory_UpdatedAt DEFAULT GETUTCDATE(),
        UpdatedBy UNIQUEIDENTIFIER NOT NULL,
        CONSTRAINT PK_ItemPriceHistory PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_ItemPriceHistory_Item FOREIGN KEY (ItemId)
            REFERENCES dbo.Items(Id),
        CONSTRAINT FK_ItemPriceHistory_UpdatedBy FOREIGN KEY (UpdatedBy)
            REFERENCES dbo.Users(Id)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ItemPriceHistory_ItemId' AND object_id = OBJECT_ID(N'dbo.ItemPriceHistory'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ItemPriceHistory_ItemId
        ON dbo.ItemPriceHistory(ItemId);
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ItemPriceHistory_UpdatedAt' AND object_id = OBJECT_ID(N'dbo.ItemPriceHistory'))
BEGIN
    CREATE NONCLUSTERED INDEX IX_ItemPriceHistory_UpdatedAt
        ON dbo.ItemPriceHistory(UpdatedAt DESC);
END;
GO
