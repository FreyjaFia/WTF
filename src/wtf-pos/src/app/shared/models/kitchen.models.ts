import { FulfillmentTypeEnum, OrderSourceEnum } from './order.models';

export enum KitchenStateEnum {
  New = 0,
  Preparing = 1,
  Ready = 2,
  Served = 3,
}

export enum KitchenChangeKindEnum {
  None = 0,
  Changed = 1,
  Added = 2,
}

export interface KitchenAddOnDto {
  name: string;
  quantity: number;
  note?: string | null;
  type?: string | null;
  isTemperature: boolean;
}

export interface KitchenLineDto {
  name: string;
  quantity: number;
  note?: string | null;
  addOns: KitchenAddOnDto[];
}

export interface KitchenOrderDto {
  id: string;
  orderNumber: number;
  createdAt: string;
  kitchenStatus: KitchenStateEnum;
  startedAt?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  source: OrderSourceEnum;
  fulfillmentType?: FulfillmentTypeEnum | null;
  customerName?: string | null;
  specialInstructions?: string | null;
  lines: KitchenLineDto[];
  changeNote?: string | null;
  changeKind?: KitchenChangeKindEnum | null;
  isStale: boolean;
  isStopMaking: boolean;
  branchCode?: string | null;
}

export interface KitchenBoardDto {
  orders: KitchenOrderDto[];
  serverTime: string;
}

export interface KitchenBoardQuery {
  states?: KitchenStateEnum[];
  source?: OrderSourceEnum | null;
  search?: string;
}

export interface MoveKitchenOrderRequest {
  to: KitchenStateEnum;
  from?: KitchenStateEnum | null;
  bringBack?: boolean;
}
