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
    CustomerRestored,
    ProductCreated,
    ProductUpdated,
    ProductDeleted,
    ProductRestored,
    ItemCreated,
    ItemUpdated,
    ItemDeleted,
    ItemRestored,
    ItemStockAdded,
    ProductItemLinked,
    OrderCreated,
    OrderUpdated,
    OrderVoided
}
