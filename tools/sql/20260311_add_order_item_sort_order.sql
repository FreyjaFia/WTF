IF COL_LENGTH('dbo.OrderItems', 'SortOrder') IS NULL
BEGIN
    ALTER TABLE dbo.OrderItems
        ADD SortOrder INT NOT NULL
        CONSTRAINT DF_OrderItems_SortOrder DEFAULT (0);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = 'IX_OrderItems_OrderId_SortOrder'
      AND object_id = OBJECT_ID('dbo.OrderItems')
)
BEGIN
    CREATE INDEX IX_OrderItems_OrderId_SortOrder
        ON dbo.OrderItems (OrderId, SortOrder);
END;

;WITH OrderedItems AS
(
    SELECT
        Id,
        ROW_NUMBER() OVER (
            PARTITION BY OrderId, ParentOrderItemId
            ORDER BY Id
        ) - 1 AS NewSortOrder
    FROM dbo.OrderItems
)
UPDATE oi
SET SortOrder = oi2.NewSortOrder
FROM dbo.OrderItems oi
JOIN OrderedItems oi2
  ON oi.Id = oi2.Id;
