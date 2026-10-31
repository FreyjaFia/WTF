import { expect, test } from '@fixtures/index';
import { GROUPS, STAFF_ROLES, guardFallback, isIn } from '@data/role-groups';
import { Role } from '@data/users';
import { SidebarPage } from '@pages/management.page';
import { today } from '@utils/dates';
import { go } from '@utils/navigation';

type Group = ReadonlyArray<Role>;

const RANGE: string = `fromDate=${today()}&toDate=${today()}`;
const RANDOM_ID: string = '3f2b8c1e-5a6d-4e7f-9b0a-1c2d3e4f5a6b';

interface PageCase {
  readonly name: string;
  readonly path: string;
  readonly allowed: Group;
}

const PAGES: ReadonlyArray<PageCase> = [
  { name: 'dashboard', path: '/dashboard', allowed: GROUPS.dashboardRead },
  { name: 'orders list', path: '/orders/list', allowed: GROUPS.ordersRead },
  { name: 'order editor', path: '/orders/editor', allowed: GROUPS.ordersWrite },
  { name: 'items', path: '/inventory/items', allowed: GROUPS.itemsRead },
  { name: 'new item', path: '/inventory/items/new', allowed: GROUPS.itemsWrite },
  { name: 'stock in', path: '/inventory/stock-in', allowed: GROUPS.stockMovementsRead },
  { name: 'needs attention', path: '/inventory/attention', allowed: GROUPS.stockMovementsRead },
  { name: 'waste', path: '/inventory/waste', allowed: GROUPS.stockMovementsRead },
  { name: 'coverage', path: '/inventory/ingredients', allowed: GROUPS.itemsRead },
  { name: 'products', path: '/management/products', allowed: GROUPS.productsRead },
  { name: 'new product', path: '/management/products/new', allowed: GROUPS.productsWrite },
  { name: 'customers', path: '/management/customers', allowed: GROUPS.customersReadUi },
  { name: 'users', path: '/management/users', allowed: GROUPS.usersRead },
  { name: 'promotions', path: '/management/promotions', allowed: GROUPS.promotionsRead },
  { name: 'reports', path: '/management/reports', allowed: GROUPS.reportsRead },
  { name: 'audit logs', path: '/management/audit-logs', allowed: GROUPS.auditRead },
  { name: 'schema scripts', path: '/management/schema-scripts', allowed: GROUPS.schemaScriptHistoryRead },
  { name: 'waste reasons', path: '/management/waste-reasons', allowed: GROUPS.wasteReasonsManage },
];

test.describe('UI: pages are open or redirected exactly per role group @security', () => {
  // One small test per role and page, so they run side by side instead of one long walk per role.
  for (const role of STAFF_ROLES) {
    for (const target of PAGES) {
      const allowed = isIn(target.allowed, role);
      test(`${role} ${allowed ? 'can open' : 'is redirected away from'} ${target.name}`, async ({ signIn }) => {
        const page = await signIn(role);

        await go(page, target.path);
        await expect(new SidebarPage(page).root, `${role} opening ${target.name}`).toBeVisible();

        const expected = allowed ? target.path : guardFallback(role);
        await expect.poll(() => new URL(page.url()).pathname, { message: `${role} opening ${target.name} (${target.path})` }).toBe(expected);
      });
    }
  }
});

interface MenuCase {
  readonly name: string;
  readonly path: string;
  readonly allowed: Group;
}

const MENU: ReadonlyArray<MenuCase> = [
  { name: 'New Order', path: '/orders/editor', allowed: GROUPS.ordersWrite },
  { name: 'Orders', path: '/orders/list', allowed: GROUPS.ordersRead },
  { name: 'Items', path: '/inventory/items', allowed: GROUPS.itemsRead },
  { name: 'Stock In', path: '/inventory/stock-in', allowed: GROUPS.stockMovementsRead },
  { name: 'Needs Attention', path: '/inventory/attention', allowed: GROUPS.stockMovementsRead },
  { name: 'Waste', path: '/inventory/waste', allowed: GROUPS.stockMovementsRead },
  { name: 'Coverage', path: '/inventory/ingredients', allowed: GROUPS.itemsRead },
  { name: 'Products', path: '/management/products', allowed: GROUPS.productsRead },
  { name: 'Customers', path: '/management/customers', allowed: GROUPS.customersReadUi },
  { name: 'Users', path: '/management/users', allowed: GROUPS.usersRead },
  { name: 'Promotions', path: '/management/promotions', allowed: GROUPS.promotionsRead },
  { name: 'Reports', path: '/management/reports', allowed: GROUPS.reportsRead },
  { name: 'Waste Reasons', path: '/management/waste-reasons', allowed: GROUPS.wasteReasonsManage },
  { name: 'Audit Logs', path: '/management/audit-logs', allowed: GROUPS.auditRead },
  { name: 'Schema Scripts', path: '/management/schema-scripts', allowed: GROUPS.schemaScriptHistoryRead },
];

test.describe('UI: the sidebar lists only the entries a role may use @security', () => {
  for (const role of STAFF_ROLES) {
    test(`${role} sees exactly its menu entries`, async ({ signIn }) => {
      const page = await signIn(role, { landing: true });
      const sidebar = new SidebarPage(page);
      await expect(sidebar.root).toBeVisible();

      for (const entry of MENU) {
        const expected = isIn(entry.allowed, role) ? 1 : 0;
        await expect.soft(sidebar.link(entry.path), `${role}: sidebar entry ${entry.name}`).toHaveCount(expected);
      }
    });
  }

  for (const role of STAFF_ROLES.filter((r) => !isIn(GROUPS.dashboardRead, r))) {
    test(`${role} is not offered a Dashboard entry it cannot open`, async ({ signIn }) => {
      const page = await signIn(role, { landing: true });
      await expect(new SidebarPage(page).root).toBeVisible();
      await expect(new SidebarPage(page).link('/dashboard')).toHaveCount(0);
    });
  }

  for (const role of STAFF_ROLES.filter((r) => isIn(GROUPS.dashboardRead, r))) {
    test(`${role} is offered the Dashboard entry`, async ({ signIn }) => {
      const page = await signIn(role, { landing: true });
      await expect(new SidebarPage(page).link('/dashboard')).toHaveCount(1);
    });
  }
});
