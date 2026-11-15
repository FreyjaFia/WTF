SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Senior/PWD role grants, follow-up to 20261121_add_senior_pwd_discount.sql.
-- That script gave orders.seniorpwd.apply to every custom role that held orders.write, not only to roles that hold
-- orders.override. The permission also lets a user see the full Senior/PWD ID number.
--
-- This script changes NO permission. A grant cannot be told apart from one a shop owner kept or added on purpose, and
-- removing it could stop a cashier from giving a legal discount mid-shift. It only records, once, which custom roles
-- hold orders.seniorpwd.apply without orders.override, so the owner or platform admin can review them (Roles page).
-- Safe to run twice: a PlatformAuditLog row 'SeniorPwdRoleGrantReview' marks the run.

IF OBJECT_ID(N'dbo.RolePermissions', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.PlatformAuditLog WHERE Action = 'SeniorPwdRoleGrantReview')
BEGIN
    BEGIN TRAN;

    INSERT INTO dbo.PlatformAuditLog (Username, Action, TenantId, Details)
    SELECT 'script', 'SeniorPwdRoleGrantReview', r.TenantId,
           LEFT(N'Review: custom role "' + r.Name + N'" (id ' + CAST(r.Id AS NVARCHAR(20))
                + N') has orders.seniorpwd.apply but not orders.override. Not changed by the script.', 2000)
    FROM dbo.UserRoles r
    WHERE r.TenantId IS NOT NULL
      AND r.IsSystem = 0
      AND EXISTS (SELECT 1 FROM dbo.RolePermissions p WHERE p.RoleId = r.Id AND p.PermissionKey = N'orders.seniorpwd.apply')
      AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions p WHERE p.RoleId = r.Id AND p.PermissionKey = N'orders.override');

    INSERT INTO dbo.PlatformAuditLog (Username, Action, Details)
    VALUES ('script', 'SeniorPwdRoleGrantReview',
            N'20261201_audit_senior_pwd_role_grants.sql: listed custom roles with orders.seniorpwd.apply and without orders.override; no permission was changed');

    COMMIT;
END
GO
