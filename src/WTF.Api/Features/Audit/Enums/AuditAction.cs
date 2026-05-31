namespace WTF.Api.Features.Audit.Enums;

public enum AuditAction
{
    UserLogin,
    UserLogout,
    UserCreated,
    UserUpdated,
    UserDeleted,
    UserPasswordChanged,
    CustomerCreated,
    CustomerUpdated,
    CustomerDeleted,
    ProductCreated,
    ProductUpdated,
    ProductDeleted,
    ItemCreated,
    ItemUpdated,
    ItemDeleted,
    ItemStockAdded,
    ProductItemLinked,
    OrderCreated,
    OrderUpdated,
    OrderVoided
}
