namespace WTF.Api.Hubs;

public static class HubNames
{
    public static class Groups
    {
        public const string DashboardViewers = "DashboardViewers";

        /// <summary>Staff who can read orders: where chat messages are announced.</summary>
        public const string StaffOrders = "StaffOrders";

        /// <summary>People who look after stock: told when an item's stock changes.</summary>
        public const string StockViewers = "StockViewers";

        /// <summary>Every open screen of one person (any device).</summary>
        public static string User(Guid userId) => $"user-{userId}";

        /// <summary>Every open page of one customer, whichever of their links it came through.</summary>
        public static string Customer(Guid customerId) => $"customer-{customerId}";

        /// <summary>Every open page opened through one link, so revoking it can close exactly those.</summary>
        public static string Link(Guid linkId) => $"link-{linkId}";
    }

    public static class Events
    {
        public const string DashboardUpdated = "DashboardUpdated";
        public const string OrderUpdated = "OrderUpdated";

        /// <summary>The person's notifications changed (new, lifted or read). The page asks for the counts again.</summary>
        public const string NotificationsChanged = "NotificationsChanged";

        /// <summary>An item's stock changed: (itemId). Sent to people who look after stock.</summary>
        public const string StockChanged = "StockChanged";

        /// <summary>A chat message arrived: (conversationId, orderId). Sent to staff and to the customer.</summary>
        public const string OrderMessageReceived = "OrderMessageReceived";

        /// <summary>Someone opened a chat, so its unread count changed: (conversationId, orderId).</summary>
        public const string ConversationRead = "ConversationRead";

        /// <summary>To a customer: one of their orders changed (accepted, rejected, ready...): (orderId).</summary>
        public const string OrderStatusChanged = "OrderStatusChanged";

        /// <summary>To a customer: the link they have open was revoked or switched off.</summary>
        public const string LinkRevoked = "LinkRevoked";
    }
}
