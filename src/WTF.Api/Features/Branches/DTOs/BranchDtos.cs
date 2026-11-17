namespace WTF.Api.Features.Branches.DTOs;

public record BranchDto(
    Guid Id,
    string Name,
    string Code,
    string? Address,
    string? Phone,
    bool IsActive,
    bool IsMain,
    int StaffCount,
    int OpenOrderCount,
    DateTime CreatedAt);

public record MyBranchDto(Guid Id, string Name, string Code, bool IsMain, bool IsActive);

public record MyBranchesDto(List<MyBranchDto> Branches, Guid? DefaultBranchId, bool IsMultiBranch, bool CanSeeAll, int ActiveBranchCount, int? MaxBranches);

public record BranchCloseCheckDto(
    Guid Id,
    bool IsMain,
    bool IsLastActive,
    int OpenOrders,
    int HeldOrders,
    int OpenPurchaseOrders,
    int StaffAssigned,
    List<BranchStaffDto> StaffWithNoOtherBranch,
    bool CanClose,
    List<string> Blockers);

public record BranchStaffDto(Guid UserId, string Name, string Username);

public record UserBranchAccessDto(Guid UserId, bool IsAllBranches, List<Guid> BranchIds, Guid? DefaultBranchId);
