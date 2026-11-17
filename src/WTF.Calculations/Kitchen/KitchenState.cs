namespace WTF.Calculations.Kitchen;

public enum KitchenState : byte
{
    New = 0,
    Preparing = 1,
    Ready = 2,
    Served = 3
}

public enum KitchenChangeKind : byte
{
    None = 0,
    Changed = 1,
    Added = 2
}

public enum KitchenMove
{
    Refused,
    Moved,
    AlreadyThere
}
