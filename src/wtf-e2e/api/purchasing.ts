import { APIResponse } from '@playwright/test';
import { ApiClient } from '@api/client';
import { Role } from '@data/users';
import { unique } from '@utils/unique';

export interface Caller {
  json<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T>;
  call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<APIResponse>;
}

// Lets the same helpers run as one of the seeded roles (ApiClient) or as the owner of a new shop (ShopSession).
export function asRole(client: ApiClient, role: Role = 'superadmin'): Caller {
  return {
    json: <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => client.json<T>(role, method, path, body),
    call: (method, path, body) => client.call(role, method, path, { body }),
  };
}

export interface SupplierSummary {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly itemCount: number;
}

export interface SupplierItem {
  readonly itemId: string;
  readonly packName: string | null;
  readonly unitsPerPack: number;
  readonly packPrice: number | null;
  readonly unitCost: number | null;
  readonly isPreferred: boolean;
}

export interface Supplier {
  readonly summary: SupplierSummary;
  readonly items: readonly SupplierItem[];
}

export interface LinkInput {
  readonly packName?: string | null;
  readonly unitsPerPack?: number;
  readonly packPrice?: number | null;
  readonly isPreferred?: boolean;
}

export interface ReorderLine {
  readonly itemId: string;
  readonly onHand: number;
  readonly parLevel: number;
  readonly onOrder: number;
  readonly suggestedUnits: number;
  readonly suggestedPacks: number | null;
}

export interface ReorderGroup {
  readonly supplierId: string | null;
  readonly supplierName: string;
  readonly lines: readonly ReorderLine[];
}

export interface ReorderList {
  readonly groups: readonly ReorderGroup[];
}

export interface OrderLineInput {
  readonly itemId: string;
  readonly packs: number;
  readonly unitsPerPack?: number;
  readonly packPrice?: number | null;
  readonly packName?: string | null;
}

export interface OrderLine {
  readonly itemId: string;
  readonly packsOrdered: number;
  readonly packsReceived: number;
  readonly unitsPerPack: number;
  readonly packPrice: number | null;
}

export interface PurchaseOrder {
  readonly summary: {
    readonly id: string;
    readonly poNumber: number;
    readonly supplierId: string;
    readonly status: number;
    readonly total: number | null;
  };
  readonly lines: readonly OrderLine[];
}

export interface Receipt {
  readonly summary: {
    readonly id: string;
    readonly purchaseOrderNumber: number | null;
    readonly linesTotal: number | null;
    readonly difference: number | null;
  };
  readonly lines: readonly { readonly itemId: string; readonly quantity: number; readonly unitCost: number | null }[];
}

export interface ReceiptLineInput {
  readonly itemId: string;
  readonly packs: number;
  readonly unitsPerPack?: number;
  readonly packPrice?: number | null;
  readonly packName?: string | null;
}

export const PO_STATUS = { draft: 1, sent: 2, partlyReceived: 3, received: 4, cancelled: 5 } as const;

function today(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export class PurchasingApi {
  public constructor(private readonly caller: Caller) {}

  public async createItem(input: { name?: string; unitName?: string; startingQuantity?: number; costPrice?: number | null } = {}): Promise<{ id: string; name: string; currentQuantity: number; costPrice: number | null }> {
    return this.caller.json('POST', 'items', {
      name: input.name ?? unique('E2E Stock'),
      unitName: input.unitName ?? 'bottle',
      sku: null,
      startingQuantity: input.startingQuantity ?? 0,
      costPrice: input.costPrice === undefined ? 5 : input.costPrice,
      allowNegativeStock: true,
    });
  }

  public async item(id: string): Promise<{ id: string; currentQuantity: number; costPrice: number | null; averageCost: number | null; parLevel?: number | null }> {
    return this.caller.json('GET', `items/${id}`);
  }

  public async createSupplier(name: string = unique('E2E Supplier'), extra: Record<string, unknown> = {}): Promise<Supplier> {
    return this.caller.json('POST', 'suppliers', { name, ...extra });
  }

  public async supplier(id: string): Promise<Supplier> {
    return this.caller.json('GET', `suppliers/${id}`);
  }

  public async suppliers(includeInactive: boolean = false): Promise<SupplierSummary[]> {
    return this.caller.json('GET', `suppliers${includeInactive ? '?includeInactive=true' : ''}`);
  }

  public async link(itemId: string, supplierId: string, input: LinkInput = {}): Promise<unknown> {
    return this.caller.json('PUT', `items/${itemId}/suppliers/${supplierId}`, {
      packName: input.packName ?? 'carton',
      unitsPerPack: input.unitsPerPack ?? 12,
      packPrice: input.packPrice === undefined ? 840 : input.packPrice,
      isPreferred: input.isPreferred ?? true,
    });
  }

  public async setPar(itemId: string, parLevel: number | null): Promise<APIResponse> {
    return this.caller.call('PUT', `reorder/par-levels/${itemId}`, { parLevel });
  }

  public async parLevel(itemId: string): Promise<number | null | undefined> {
    const rows = await this.caller.json<{ itemId: string; parLevel: number | null }[]>('GET', 'reorder/par-levels');
    return rows.find((row) => row.itemId === itemId)?.parLevel;
  }

  public async reorder(): Promise<ReorderList> {
    return this.caller.json('GET', 'reorder');
  }

  public async reorderLine(itemId: string): Promise<{ group: ReorderGroup; line: ReorderLine } | null> {
    for (const group of (await this.reorder()).groups) {
      const line = group.lines.find((l) => l.itemId === itemId);
      if (line) {
        return { group, line };
      }
    }

    return null;
  }

  public orderFields(supplierId: string, lines: readonly OrderLineInput[], extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      supplierId,
      expectedOn: null,
      note: null,
      lines: lines.map((l) => ({ unitsPerPack: 12, packPrice: 840, packName: 'carton', ...l })),
      ...extra,
    };
  }

  public async createOrder(supplierId: string, lines: readonly OrderLineInput[], extra: Record<string, unknown> = {}): Promise<PurchaseOrder> {
    return this.caller.json('POST', 'purchase-orders', this.orderFields(supplierId, lines, extra));
  }

  public async order(id: string): Promise<PurchaseOrder> {
    return this.caller.json('GET', `purchase-orders/${id}`);
  }

  public async sendOrder(id: string): Promise<PurchaseOrder> {
    return this.caller.json('POST', `purchase-orders/${id}/send`);
  }

  public async orderAction(id: string, action: 'send' | 'cancel' | 'close'): Promise<APIResponse> {
    return this.caller.call('POST', `purchase-orders/${id}/${action}`);
  }

  public async receive(
    supplierId: string,
    lines: readonly ReceiptLineInput[],
    extra: { purchaseOrderId?: string; invoiceNumber?: string; invoiceTotal?: number; clientRequestId?: string } = {},
  ): Promise<APIResponse> {
    return this.caller.call('POST', 'stock-receipts', this.receiptBody(supplierId, lines, extra));
  }

  public async receiveOk(supplierId: string, lines: readonly ReceiptLineInput[], extra: { purchaseOrderId?: string; invoiceNumber?: string; invoiceTotal?: number; clientRequestId?: string } = {}): Promise<Receipt> {
    return this.caller.json('POST', 'stock-receipts', this.receiptBody(supplierId, lines, extra));
  }

  private receiptBody(supplierId: string, lines: readonly ReceiptLineInput[], extra: Record<string, unknown>): Record<string, unknown> {
    return {
      supplierId,
      receivedOn: today(),
      note: null,
      lines: lines.map((l) => ({ unitsPerPack: 12, packPrice: 840, packName: 'carton', ...l })),
      ...extra,
    };
  }
}
