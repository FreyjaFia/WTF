using WTF.Domain.Tenancy;

namespace WTF.Domain.Entities;

public partial class AuditLog : IBranchOwned
{
}

public partial class Expense : IBranchOwned
{
}

public partial class Order : IBranchOwned
{
}

public partial class OrderSeniorPwdDiscount : IBranchOwned
{
}

public partial class PurchaseOrder : IBranchOwned
{
}

public partial class ShortLink : IBranchOwned
{
}

public partial class StockCount : IBranchOwned
{
}

public partial class StockMovement : IBranchOwned
{
}

public partial class StockReceipt : IBranchOwned
{
}

public partial class StockWaste : IBranchOwned
{
}
