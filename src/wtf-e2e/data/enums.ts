export const PaymentMethod = { Cash: 1, GCash: 2 } as const;
export const Category = { Drink: 1, Food: 2, Dessert: 3, Other: 4 } as const;
export const SubCategory = { Coffee: 1, NonCoffee: 2, Snacks: 3, Retail: 4 } as const;
export const OrderStatus = { Pending: 1, Completed: 2, Cancelled: 3, Refunded: 4, PendingApproval: 5, PendingReview: 6 } as const;
export const WasteStatus = { Recorded: 1, PendingReview: 2, Confirmed: 3, Disputed: 4, Reversed: 5 } as const;
export const WasteSource = { Inventory: 1, Pos: 2 } as const;

export const WasteReason = {
  ExpiredOrSpoiled: 1,
  SpilledOrDropped: 2,
  WrongOrderOrRemade: 3,
  QualityFailed: 4,
  StaffMeal: 5,
  SampleOrTasting: 6,
  Breakage: 7,
  Other: 8,
} as const;

export const WASTE_REASON_NAMES: Record<number, string> = {
  1: 'Expired or spoiled',
  2: 'Spilled or dropped',
  3: 'Wrong order or remade',
  4: 'Quality failed',
  5: 'Staff meal',
  6: 'Sample or tasting',
  7: 'Breakage',
  8: 'Other',
};

export const REFUND_NOT_RESALEABLE_NOTE: string = 'Refunded, not resaleable';
export const MAX_REPORT_RANGE_DAYS: number = 366;
export const WASTE_REASON_NAME_MAX: number = 60;
export const MIN_DOWNLOAD_BYTES: number = 100;

export const AddOnType = { Size: 1, Flavor: 2, Topping: 3, Extra: 4, Sauce: 5 } as const;
export const FulfillmentType = { Pickup: 0, Delivery: 1 } as const;
export const OrderSource = { Pos: 0, CustomerLink: 1 } as const;