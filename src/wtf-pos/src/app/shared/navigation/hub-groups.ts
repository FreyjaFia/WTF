import { AuthService, StockAttentionService, StockWasteService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

export interface HubCard {
  id: string;
  label: string;
  icon: string;
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
          icon: 'icon-inventory-items',
          description: 'Every item you stock, with its level and unit.',
          route: AppRoutes.InventoryItems,
          canShow: () => auth.canReadItems(),
        },
        {
          id: 'ingredients',
          label: 'Ingredients & Cost',
          icon: 'icon-fact-check',
          description: 'What goes into each product, and what it costs.',
          route: AppRoutes.InventoryIngredients,
          canShow: () => auth.canReadItems(),
        },
        {
          id: 'attention',
          label: 'Needs Attention',
          icon: 'icon-stock-alert',
          description: 'Items that are low, critical or out of stock.',
          route: AppRoutes.InventoryAttention,
          canShow: () => auth.canReadStockMovements(),
          badge: () => attention.count(),
          urgent: () => attention.urgentCount() > 0,
        },
        {
          id: 'stock-in',
          label: 'Stock In',
          icon: 'icon-inventory',
          description: 'Record stock that came in.',
          route: AppRoutes.InventoryStockIn,
          canShow: () => auth.canReadStockMovements(),
        },
        {
          id: 'counts',
          label: 'Counts',
          icon: 'icon-assignment-turned-in',
          description: 'Count the shelf and fix the differences.',
          route: AppRoutes.InventoryCounts,
          canShow: () => auth.canReadStockMovements(),
        },
        {
          id: 'waste',
          label: 'Waste',
          icon: 'icon-delete',
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
          icon: 'icon-send',
          description: 'Suggested orders and purchase orders.',
          route: AppRoutes.InventoryPurchaseOrders,
          canShow: () => auth.canReadStockMovements(),
        },
        {
          id: 'receiving',
          label: 'Receiving',
          icon: 'icon-package',
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
          icon: 'icon-cart',
          description: 'Menu items, prices, add-ons and categories.',
          route: AppRoutes.ManagementProducts,
          canShow: () => auth.canReadProducts(),
        },
        {
          id: 'promotions',
          label: 'Promotions',
          icon: 'icon-promotion',
          description: 'Bundles, mix and match and discounted products.',
          route: AppRoutes.ManagementPromotions,
          canShow: () => auth.canReadPromotions(),
        },
        {
          id: 'customers',
          label: 'Customers',
          icon: 'icon-people',
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
          icon: 'icon-trending-up',
          description: 'Sales, payments, profit and the monthly workbook.',
          route: AppRoutes.ManagementReports,
          canShow: () => auth.canAccessReports(),
        },
        {
          id: 'expenses',
          label: 'Expenses',
          icon: 'icon-coins',
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
          icon: 'icon-user',
          description: 'Staff accounts, their role and their status.',
          route: AppRoutes.ManagementUsers,
          canShow: () => auth.canReadUsers(),
        },
        {
          id: 'roles',
          label: 'Roles',
          icon: 'icon-lock',
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
          icon: 'icon-setup',
          description: 'The lists the rest of the app is built from.',
          route: AppRoutes.ManagementSetup,
          canShow: () => auth.canOpenSetup(),
        },
        {
          id: 'shop',
          label: 'Shop',
          icon: 'icon-storefront',
          description: "Your shop's look, its plan and its invoices.",
          route: AppRoutes.ManagementShop,
          canShow: () => auth.canManageBrand() || auth.canManageSubscription(),
        },
        {
          id: 'sync-policy',
          label: 'Offline sync policy',
          icon: 'icon-refresh',
          description: 'What happens to a sale made offline when the menu changed.',
          route: AppRoutes.ManagementSyncPolicy,
          canShow: () => auth.canManageSyncPolicy(),
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
          icon: 'icon-audit-logs',
          description: 'Who changed what, and when.',
          route: AppRoutes.ManagementAuditLogs,
          canShow: () => auth.canAccessAuditLogs(),
        },
        {
          id: 'schema-scripts',
          label: 'Schema Scripts',
          icon: 'icon-schema-scripts',
          description: 'Which database scripts have run.',
          route: AppRoutes.ManagementSchemaScripts,
          canShow: () => auth.canAccessSchemaScriptHistory(),
        },
      ],
    },
  ];
}
