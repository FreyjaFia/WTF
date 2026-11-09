import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/services';
import { AppRoutes } from '@shared/constants/app-routes';

interface HubCard {
  id: string;
  label: string;
  description: string;
  route: string;
  canShow: () => boolean;
}

interface HubGroup {
  name: string;
  description: string;
  cards: HubCard[];
}

@Component({
  selector: 'app-management-hub',
  imports: [RouterLink],
  templateUrl: './management-hub.html',
  host: { class: 'flex-1 min-h-0' },
})
export class ManagementHubComponent {
  private readonly authService = inject(AuthService);

  protected readonly groups = computed<HubGroup[]>(() => {
    const all: HubGroup[] = [
      {
        name: 'Sell',
        description: 'What you sell and who you sell it to.',
        cards: [
          {
            id: 'products',
            label: 'Products',
            description: 'Menu items, prices, add-ons and categories.',
            route: AppRoutes.ManagementProducts,
            canShow: () => this.authService.canReadProducts(),
          },
          {
            id: 'promotions',
            label: 'Promotions',
            description: 'Bundles, mix and match and discounted products.',
            route: AppRoutes.ManagementPromotions,
            canShow: () => this.authService.canReadPromotions(),
          },
          {
            id: 'customers',
            label: 'Customers',
            description: 'Customer details, addresses and ordering links.',
            route: AppRoutes.ManagementCustomers,
            canShow: () => this.authService.canReadCustomers(),
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
            canShow: () => this.authService.canAccessReports(),
          },
          {
            id: 'expenses',
            label: 'Expenses',
            description: 'What the shop spends, by category.',
            route: AppRoutes.ManagementExpenses,
            canShow: () => this.authService.canReadExpenses(),
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
            canShow: () => this.authService.canReadUsers(),
          },
          {
            id: 'roles',
            label: 'Roles',
            description: 'Built-in and custom roles, and what each can do.',
            route: AppRoutes.ManagementRoles,
            canShow: () => this.authService.canManageRoles(),
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
            canShow: () => this.authService.canOpenSetup(),
          },
          {
            id: 'shop',
            label: 'Shop',
            description: "Your shop's look, its plan and its invoices.",
            route: AppRoutes.ManagementShop,
            canShow: () =>
              this.authService.canManageBrand() || this.authService.canManageSubscription(),
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
            canShow: () => this.authService.canAccessAuditLogs(),
          },
          {
            id: 'schema-scripts',
            label: 'Schema Scripts',
            description: 'Which database scripts have run.',
            route: AppRoutes.ManagementSchemaScripts,
            canShow: () => this.authService.canAccessSchemaScriptHistory(),
          },
        ],
      },
    ];

    return all
      .map((group) => ({ ...group, cards: group.cards.filter((card) => card.canShow()) }))
      .filter((group) => group.cards.length > 0);
  });
}
