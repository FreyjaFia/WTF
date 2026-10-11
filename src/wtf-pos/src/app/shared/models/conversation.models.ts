/** Who wrote a chat message. */
/** `system` is a line the app writes when the order moves on ("Order accepted"), never a person. */
export type ConversationSender = 'customer' | 'staff' | 'system';

export interface ConversationMessageDto {
  id: string;
  sender: ConversationSender;
  /** The staff member who wrote it or made the change: full name for staff, first name for a customer. Null for the customer's own. */
  senderName?: string | null;
  body: string;
  createdAt: string;
}

/** The chat of one order. It has no id until the first message starts it. */
export interface OrderConversationDto {
  conversationId?: string | null;
  orderId: string;
  orderNumber: number;
  title: string;
  /** False once the order is over: the chat stays as read-only history. */
  canSend: boolean;
  closedReason?: string | null;
  unreadCount: number;
  messages: ConversationMessageDto[];
}

/** One row of the envelope list. */
export interface ConversationSummaryDto {
  id: string;
  orderId?: string | null;
  orderNumber?: number | null;
  title: string;
  /** Who it is with, for staff. Not sent to a customer. */
  customerName?: string | null;
  lastMessage: string;
  lastSender: ConversationSender | '';
  lastMessageAt: string;
  unreadCount: number;
}

/** `unreadConversations` is what the envelope badge shows: conversations, not messages. */
export interface ConversationListDto {
  unreadConversations: number;
  items: ConversationSummaryDto[];
}

export const MAX_CHAT_MESSAGE_LENGTH = 1000;
