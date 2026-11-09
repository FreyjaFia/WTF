import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

export interface HubCard {
  id: string;
  label: string;
  description: string;
  route: string;
  canShow: () => boolean;
  badge?: () => number;
  urgent?: () => boolean;
}

export interface HubGroup {
  name: string;
  description: string;
  cards: HubCard[];
}

export function visibleGroups(groups: HubGroup[]): HubGroup[] {
  return groups
    .map((group) => ({ ...group, cards: group.cards.filter((card) => card.canShow()) }))
    .filter((group) => group.cards.length > 0);
}

export function inventoryGroups(
  auth: AuthService,
  attention: StockAttentionService,
  stockWaste: StockWasteService,
): HubGroup[] {
  return [
    {
      name: 'Stock',
      description: 'What you have on the shelf and what happens to it.',
      cards: [
        {
          id: 'items',
          label: 'Items',
          description: 'Every item you stock, with its level and unit.',
          route: AppRoutes.InventoryItems,
          canShow: () => auth.canReadItems(),
        },
        {
          id: 'ingredients',
          label: 'Ingredients & Cost',
          description: 'What goes into each product, and what it costs.',
          route: AppRoutes.InventoryIngredients,
          canShow: () => auth.canReadItems(),
        },
        {
          id: 'attention',
          label: 'Needs Attention',
          description: 'Items that are low, critical or out of stock.',
          route: AppRoutes.InventoryAttention,
          canShow: () => auth.canReadStockMovements(),
          badge: () => attention.count(),
          urgent: () => attention.urgentCount() > 0,
        },
        {
          id: 'stock-in',
          label: 'Stock In',
          description: 'Record stock that came in.',
          route: AppRoutes.InventoryStockIn,
          canShow: () => auth.canReadStockMovements(),
        },
        {
          id: 'counts',
          label: 'Counts',
          description: 'Count the shelf and fix the differences.',
          route: AppRoutes.InventoryCounts,
          canShow: () => auth.canReadStockMovements(),
        },
        {
          id: 'waste',
          label: 'Waste',
          description: 'Wasted stock, and what is waiting for review.',
          route: AppRoutes.InventoryWaste,
          canShow: () => auth.canReadStockMovements(),
          badge: () => (auth.canReviewStockWaste() ? stockWaste.pendingCount() : 0),
          urgent: () => false,
        },
      ],
    },
    {
      name: 'Buying',
      description: 'Ordering from suppliers and receiving what arrives.',
      cards: [
        {
          id: 'purchase-orders',
          label: 'Purchasing',
          description: 'Suggested orders and purchase orders.',
          route: AppRoutes.InventoryPurchaseOrders,
          canShow: () => auth.canReadStockMovements(),
        },
        {
          id: 'receiving',
          label: 'Receiving',
          description: 'Deliveries received against purchase orders.',
          route: AppRoutes.InventoryReceiving,
          canShow: () => auth.canReadStockMovements(),
        },
      ],
    },
  ];
}

export function managementGroups(auth: AuthService): HubGroup[] {
  return [
    {
      name: 'Sell',
      description: 'What you sell and who you sell it to.',
      cards: [
        {
          id: 'products',
          label: 'Products',
          description: 'Menu items, prices, add-ons and categories.',
          route: AppRoutes.ManagementProducts,
          canShow: () => auth.canReadProducts(),
        },
        {
          id: 'promotions',
          label: 'Promotions',
          description: 'Bundles, mix and match and discounted products.',
          route: AppRoutes.ManagementPromotions,
          canShow: () => auth.canReadPromotions(),
        },
        {
          id: 'customers',
          label: 'Customers',
          description: 'Customer details, addresses and ordering links.',
          route: AppRoutes.ManagementCustomers,
          canShow: () => auth.canReadCustomers(),
        },
      ],
    },
    {
      name: 'Money',
      description: 'How the shop is doing.',
      cards: [
        {
          id: 'reports',
          label: 'Reports',
          description: 'Sales, payments, profit and the monthly workbook.',
          route: AppRoutes.ManagementReports,
          canShow: () => auth.canAccessReports(),
        },
        {
          id: 'expenses',
          label: 'Expenses',
          description: 'What the shop spends, by category.',
          route: AppRoutes.ManagementExpenses,
          canShow: () => auth.canReadExpenses(),
        },
      ],
    },
    {
      name: 'People',
      description: 'Who works here and what they can do.',
      cards: [
        {
          id: 'users',
          label: 'Users',
          description: 'Staff accounts, their role and their status.',
          route: AppRoutes.ManagementUsers,
          canShow: () => auth.canReadUsers(),
        },
        {
          id: 'roles',
          label: 'Roles',
          description: 'Built-in and custom roles, and what each can do.',
          route: AppRoutes.ManagementRoles,
          canShow: () => auth.canManageRoles(),
        },
      ],
    },
    {
      name: 'Settings',
      description: 'How the shop and the app are set up.',
      cards: [
        {
          id: 'setup',
          label: 'Setup',
          description: 'The lists the rest of the app is built from.',
          route: AppRoutes.ManagementSetup,
          canShow: () => auth.canOpenSetup(),
        },
        {
          id: 'shop',
          label: 'Shop',
          description: "Your shop's look, its plan and its invoices.",
          route: AppRoutes.ManagementShop,
          canShow: () => auth.canManageBrand() || auth.canManageSubscription(),
        },
      ],
    },
    {
      name: 'System',
      description: 'Records for the owner.',
      cards: [
        {
          id: 'audit-logs',
          label: 'Audit Logs',
          description: 'Who changed what, and when.',
          route: AppRoutes.ManagementAuditLogs,
          canShow: () => auth.canAccessAuditLogs(),
        },
        {
          id: 'schema-scripts',
          label: 'Schema Scripts',
          description: 'Which database scripts have run.',
          route: AppRoutes.ManagementSchemaScripts,
          canShow: () => auth.canAccessSchemaScriptHistory(),
        },
      ],
    },
  ];
}
