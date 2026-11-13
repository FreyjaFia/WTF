SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
GO

-- Plan-based feature gating, phase 1: the feature catalog. Plans.Features stays a comma list; the valid words now live in
-- code (WTF.Calculations PlanFeatures): expenses, inventory, purchasing, promotions, orderlinks, chat, workbook, audit,
-- customroles. Safe to run twice; no plan Pogi edited is changed.
--
--  1. Adds the Business plan (inactive until it is priced for real; 3500 is a placeholder).
--  2. Pro: only when its Features still equal the seeded text, adds `expenses` and `customroles`. Nothing is taken away,
--     so the pilot shop (on Pro) keeps everything. To move `purchasing`, `workbook` or `audit` between Pro and Business,
--     edit the plans on the platform Plans page (it is data, not a script).
--  3. Starter is left alone (core only), so it no longer has expenses, the audit log or custom roles.
--  4. Once only: custom roles that hold stock.read / stock.write get purchasing.read / purchasing.write, and custom roles
--     that hold orders.read / orders.write get chat.read / chat.write, because those screens moved to the new keys. The
--     run is recorded in PlatformAuditLog so a later run does not add them back after a shop removed them.

IF NOT EXISTS (SELECT 1 FROM dbo.Plans WHERE Code = 'business')
BEGIN
    INSERT INTO dbo.Plans (Code, Name, MonthlyPrice, Features, MaxUsers, IsActive, SortOrder)
    VALUES ('business', N'Business', 3500, 'inventory,purchasing,promotions,orderlinks,chat,expenses,workbook,audit,customroles', NULL, 0, 3);
END
GO

UPDATE dbo.Plans
SET Features = 'pos,orders,reports,offline,inventory,promotions,orderlinks,chat,workbook,expenses,customroles'
WHERE Code = 'pro'
  AND Features = 'pos,orders,reports,offline,inventory,promotions,orderlinks,chat,workbook';
GO

IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.PlatformAuditLog WHERE Action = 'PlanFeatureCatalogRoleCopy')
BEGIN
    INSERT INTO dbo.RolePermissions (RoleId, PermissionKey)
    SELECT DISTINCT rp.RoleId,
           CASE rp.PermissionKey
               WHEN 'stock.read' THEN 'purchasing.read'
               WHEN 'stock.write' THEN 'purchasing.write'
               WHEN 'orders.read' THEN 'chat.read'
               WHEN 'orders.write' THEN 'chat.write'
           END
    FROM dbo.RolePermissions rp
    INNER JOIN dbo.UserRoles r ON r.Id = rp.RoleId
    WHERE r.TenantId IS NOT NULL
      AND r.IsSystem = 0
      AND rp.PermissionKey IN ('stock.read', 'stock.write', 'orders.read', 'orders.write')
      AND NOT EXISTS
      (
          SELECT 1
          FROM dbo.RolePermissions x
          WHERE x.RoleId = rp.RoleId
            AND x.PermissionKey = CASE rp.PermissionKey
                WHEN 'stock.read' THEN 'purchasing.read'
                WHEN 'stock.write' THEN 'purchasing.write'
                WHEN 'orders.read' THEN 'chat.read'
                WHEN 'orders.write' THEN 'chat.write'
            END
      );

    INSERT INTO dbo.PlatformAuditLog (Username, Action, Details)
    VALUES ('script', 'PlanFeatureCatalogRoleCopy',
            N'20261130_plan_feature_catalog.sql: custom roles with stock.* or orders.* also got purchasing.* and chat.*');
END
GO
