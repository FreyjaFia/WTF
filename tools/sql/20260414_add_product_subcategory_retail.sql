SET NOCOUNT ON;

IF EXISTS (
  SELECT 1
  FROM dbo.ProductSubCategories
  WHERE Id = 4 AND Name <> 'Retail'
)
BEGIN
  UPDATE dbo.ProductSubCategories
  SET Name = 'Retail'
  WHERE Id = 4;
END;

IF NOT EXISTS (
  SELECT 1
  FROM dbo.ProductSubCategories
  WHERE Id = 4
)
BEGIN
  INSERT INTO dbo.ProductSubCategories (Id, Name)
  VALUES (4, 'Retail');
END;
