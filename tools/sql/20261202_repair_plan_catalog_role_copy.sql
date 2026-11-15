SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Repair for 20261130_plan_feature_catalog.sql. Its role copy (purchasing.* and chat.* for custom roles) and its
-- PlatformAuditLog marker 'PlanFeatureCatalogRoleCopy' were not in one transaction, so a failure between them could leave
-- the copy done without the marker (a re-run would then add back grants a shop had removed) or neither done.
--
-- Whichever half ran, this makes the state consistent. It never removes a grant and never edits the old script:
--  - marker present                         : nothing to do.
--  - marker missing, some custom role already holds purchasing.* or chat.* : the copy ran (or the roles were set up by
--    hand); only the marker is written, no grant is added.
--  - marker missing and no custom role holds any of them : neither half ran; the copy and the marker are done together
--    in one transaction.
-- Safe to run twice.

IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.PlatformAuditLog WHERE Action = 'PlanFeatureCatalogRoleCopy')
BEGIN
    BEGIN TRAN;

    IF NOT EXISTS
    (
        SELECT 1
        FROM dbo.RolePermissions rp
        INNER JOIN dbo.UserRoles r ON r.Id = rp.RoleId
        WHERE r.TenantId IS NOT NULL
          AND r.IsSystem = 0
          AND rp.PermissionKey IN (N'purchasing.read', N'purchasing.write', N'chat.read', N'chat.write')
    )
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
    END

    INSERT INTO dbo.PlatformAuditLog (Username, Action, Details)
    VALUES ('script', 'PlanFeatureCatalogRoleCopy',
            N'20261202_repair_plan_catalog_role_copy.sql: marker written so the 20261130 role copy is not repeated');

    COMMIT;
END
GO
