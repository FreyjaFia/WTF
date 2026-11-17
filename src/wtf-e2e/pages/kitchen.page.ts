import { Locator, Page } from '@playwright/test';
import { ROUTES } from '@data/routes';
import { go } from '@utils/navigation';

export class KitchenPage {
  public readonly board: Locator;
  public readonly servedTab: Locator;
  public readonly boardTab: Locator;

  public constructor(private readonly page: Page) {
    this.board = page.getByTestId('kitchen-board');
    this.servedTab = page.getByTestId('kitchen-view-served');
    this.boardTab = page.getByTestId('kitchen-view-board');
  }

  public async open(): Promise<void> {
    await go(this.page, ROUTES.kitchen);
    await this.board.waitFor();
  }

  public card(orderNumber: number): Locator {
    return this.page.getByTestId(`kitchen-card-${orderNumber}`);
  }

  public column(name: 'new' | 'preparing' | 'ready'): Locator {
    return this.page.getByTestId(`kitchen-column-${name}`);
  }

  public tab(name: 'new' | 'preparing' | 'ready'): Locator {
    return this.page.getByTestId(`kitchen-tab-${name}`);
  }

  public async advance(orderNumber: number): Promise<void> {
    await this.card(orderNumber).getByTestId('kitchen-advance').click();
  }

  public async undo(orderNumber: number): Promise<void> {
    await this.card(orderNumber).getByTestId('kitchen-undo').click();
  }

  public stopCard(orderNumber: number): Locator {
    return this.page.getByTestId(`kitchen-stop-${orderNumber}`);
  }
}
