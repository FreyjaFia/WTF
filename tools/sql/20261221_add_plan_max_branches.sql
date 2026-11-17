SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- Multiple branches, plan gating (docs/roadmap/multiple-branches.md, "Plan gating"). Run after 20261220_add_branches.sql.
--  1. Plans.MaxBranches: how many active branches a shop on the plan may have. Empty means no limit; 1 means branches are off.
--  2. Only plans that have no value yet are filled in: Starter 1, Pro 1, Business 3. A plan edited on the platform Plans page
--     is never overwritten.
--  3. The `branches` feature is added to the Business plan when it is missing, so a shop on Business can use the screens.
--     Starter and Pro do not get it (decision 5 of the plan: Business only).
-- Safe to run twice.

IF COL_LENGTH(N'dbo.Plans', N'MaxBranches') IS NULL
BEGIN
    ALTER TABLE dbo.Plans ADD MaxBranches INT NULL;
END
GO

UPDATE dbo.Plans SET MaxBranches = 1 WHERE Code IN ('starter', 'pro') AND MaxBranches IS NULL;
UPDATE dbo.Plans SET MaxBranches = 3 WHERE Code = 'business' AND MaxBranches IS NULL;
GO

UPDATE dbo.Plans
SET Features = CASE WHEN Features IS NULL OR LTRIM(RTRIM(Features)) = '' THEN 'branches' ELSE Features + ',branches' END
WHERE Code = 'business'
  AND CHARINDEX('branches', ISNULL(Features, '')) = 0;
GO
