# Product Images

This folder contains images for products served by the WTF API.

## ?? Important: One-to-One Relationship

**Each product can have only ONE image** (1:1 relationship via `ProductImages` table).

## Directory Structure
```
wwwroot/
??? images/
    ??? products/
        ??? brown_sugar_oatside_iced_shaken_espresso.png
        ??? caramel_macchiato.png
        ??? choco_berry.png
        ??? dirty_ube_latte.png
        ??? matcha_cloud.png
        ??? milky_strawberry.png
        ??? salted_caramel_latte.png
        ??? strawberry_matcha.png
        ??? ube_cloud.png
        ??? ube_latte.png
        ??? ube_matcha.png
        ??? ...
```

## Available Drink Images

The following drink images are already available:

1. **brown_sugar_oatside_iced_shaken_espresso.png** - Brown Sugar Oatside Iced Shaken Espresso
2. **caramel_macchiato.png** - Caramel Macchiato
3. **choco_berry.png** - Choco Berry
4. **dirty_ube_latte.png** - Dirty Ube Latte
5. **matcha_cloud.png** - Matcha Cloud
6. **milky_strawberry.png** - Milky Strawberry
7. **salted_caramel_latte.png** - Salted Caramel Latte
8. **strawberry_matcha.png** - Strawberry Matcha
9. **ube_cloud.png** - Ube Cloud
10. **ube_latte.png** - Ube Latte
11. **ube_matcha.png** - Ube Matcha

## Image Guidelines

- **Supported Formats**: JPG, PNG, WebP
- **Recommended Size**: 500x500px (1:1 aspect ratio)
- **Max File Size**: 2MB per image
- **Naming Convention**: Use lowercase, descriptive names with underscores (e.g., `latte_coffee.png`, `chocolate_cake.png`)

## Accessing Images

Images are served via the API at:
```
http://localhost:5000/images/products/[filename]
```

Example:
```
http://localhost:5000/images/products/caramel_macchiato.png
```

## Quick Setup

Run the provided SQL script to insert all images into the database:

```bash
# Execute the SQL script in SSMS or sqlcmd
sqlcmd -S localhost -d WTF -i setup-product-images.sql
```

Or manually run `setup-product-images.sql` in SQL Server Management Studio.

## Database Schema

### Tables Involved

```sql
-- Images table (stores image metadata)
CREATE TABLE Images (
    ImageId UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    ImageUrl NVARCHAR(512) NOT NULL,
    UploadedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);

-- ProductImages table (1:1 junction table)
CREATE TABLE ProductImages (
    ProductId UNIQUEIDENTIFIER PRIMARY KEY,  -- One product
    ImageId UNIQUEIDENTIFIER NOT NULL UNIQUE,  -- One image
    FOREIGN KEY (ProductId) REFERENCES Products(Id),
    FOREIGN KEY (ImageId) REFERENCES Images(ImageId)
);
```

**Key Constraints:**
- `ProductId` is PRIMARY KEY ? Each product can appear only once
- `ImageId` is UNIQUE ? Each image can be linked to only one product
- Both use UNIQUEIDENTIFIER (GUID) for better distribution and scalability

## Adding Images to Products

### Option 1: Use the Auto-Linking Script (Recommended)

The `setup-product-images.sql` script includes an auto-linking feature that:
1. Matches image filenames to product names
2. Creates missing products automatically
3. Links each product to its corresponding image

Uncomment the "Step 4" section in the SQL script and run it.

### Option 2: Manual insertion

```sql
-- 1. Insert the image
DECLARE @ImageId UNIQUEIDENTIFIER;
INSERT INTO Images (ImageId, ImageUrl, UploadedAt)
VALUES (NEWID(), '/images/products/ube_latte.png', SYSDATETIME());
SET @ImageId = SCOPE_IDENTITY();

-- 2. Find or create the product
DECLARE @ProductId UNIQUEIDENTIFIER;
SELECT @ProductId = Id FROM Products WHERE Name = 'Ube Latte';

IF @ProductId IS NULL
BEGIN
    SET @ProductId = NEWID();
    INSERT INTO Products (Id, Name, Price, TypeId, IsAddOn, IsActive, CreatedAt, CreatedBy)
    VALUES (
        @ProductId,
        'Ube Latte',
        150.00,
        0,  -- Drink
        0,  -- Not add-on
        1,  -- Active
        GETUTCDATE(),
        (SELECT TOP 1 Id FROM Users)
    );
END

-- 3. Link product to image (1:1)
IF NOT EXISTS (SELECT 1 FROM ProductImages WHERE ProductId = @ProductId)
BEGIN
    INSERT INTO ProductImages (ProductId, ImageId)
    VALUES (@ProductId, @ImageId);
END
ELSE
BEGIN
    -- Update if already exists
    UPDATE ProductImages 
    SET ImageId = @ImageId 
    WHERE ProductId = @ProductId;
END
```

### Option 3: Update Existing Product's Image

```sql
-- Change a product's image
DECLARE @ProductId UNIQUEIDENTIFIER = (SELECT Id FROM Products WHERE Name = 'Ube Latte');
DECLARE @NewImageId UNIQUEIDENTIFIER = (SELECT ImageId FROM Images WHERE ImageUrl = '/images/products/new_ube_latte.png');

UPDATE ProductImages
SET ImageId = @NewImageId
WHERE ProductId = @ProductId;
```

## Placeholder Images

If products don't have images, the MAUI app will display Material Design icons:
- ? Coffee icon (`&#xe541;`) for Drinks
- ?? Restaurant icon (`&#xea64;`) for Food
- ?? Cake icon (`&#xe7ef;`) for Desserts
- ?? Store icon (`&#xe8f4;`) for Other

## API Response Format

```json
{
  "products": [
    {
      "id": "guid-here",
      "name": "Ube Latte",
      "price": 150.00,
      "type": 0,
      "imageUrl": "/images/products/ube_latte.png"
    }
  ]
}
```

**Note:** `imageUrl` is a single nullable string (not an array):
- Has image: `"imageUrl": "/images/products/image.png"`
- No image: `"imageUrl": null`

## Testing Image Access

After running the API, test image access:

```bash
# In browser or curl
curl http://localhost:5000/images/products/caramel_macchiato.png

# Should return the image file
```

## Useful SQL Queries

### View all products with their images
```sql
SELECT 
    p.Name,
    p.Price,
    i.ImageUrl
FROM Products p
LEFT JOIN ProductImages pi ON p.Id = pi.ProductId
LEFT JOIN Images i ON pi.ImageId = i.ImageId
WHERE p.IsActive = 1
ORDER BY p.Name;
```

### Find products without images
```sql
SELECT p.Name, p.Price
FROM Products p
LEFT JOIN ProductImages pi ON p.Id = pi.ProductId
WHERE pi.ImageId IS NULL
AND p.IsActive = 1;
```

### Find unused images
```sql
SELECT i.ImageUrl
FROM Images i
LEFT JOIN ProductImages pi ON i.ImageId = pi.ImageId
WHERE pi.ProductId IS NULL;
```

### Count products by image status
```sql
SELECT 
    CASE 
        WHEN pi.ImageId IS NOT NULL THEN 'Has Image'
        ELSE 'No Image'
    END AS Status,
    COUNT(*) AS Count
FROM Products p
LEFT JOIN ProductImages pi ON p.Id = pi.ProductId
WHERE p.IsActive = 1
GROUP BY CASE WHEN pi.ImageId IS NOT NULL THEN 'Has Image' ELSE 'No Image' END;
```

## Troubleshooting

**Images not loading?**
1. ? Verify static files middleware is configured in `Program.cs`
2. ? Check file permissions on wwwroot folder
3. ? Ensure image file exists: `dir wwwroot\images\products`
4. ? Check API logs for 404 errors
5. ? Verify CORS is enabled for cross-origin requests

**Images in database but not showing in app?**
1. ? Check `ProductImages` table has correct ProductId and ImageId
2. ? Verify `ImageUrl` starts with `/images/products/`
3. ? Run query: 
   ```sql
   SELECT p.Name, i.ImageUrl 
   FROM Products p 
   JOIN ProductImages pi ON p.Id = pi.ProductId 
   JOIN Images i ON pi.ImageId = i.ImageId
   ```
4. ? Check API response includes `imageUrl` field in ProductDto
5. ? Test direct image URL: `http://localhost:5000/images/products/ube_latte.png`

**Constraint violation when linking images?**
- Each product can have only ONE image
- Each image can be linked to only ONE product
- Use UPDATE instead of INSERT if the product already has an image

## Migration Notes

If you're migrating from a many-to-many relationship:

```sql
-- Remove duplicate ProductImages entries (keep first)
WITH CTE AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY ProductId ORDER BY ImageId) AS rn
    FROM ProductImages
)
DELETE FROM CTE WHERE rn > 1;

-- Ensure unique constraints are in place
CREATE UNIQUE INDEX UQ_ProductImages_ProductId ON ProductImages(ProductId);
CREATE UNIQUE INDEX UQ_ProductImages_ImageId ON ProductImages(ImageId);
