namespace WTF.Api.Features.Inventory.DTOs;

public record AlertRecipientDto(Guid UserId, string Name, string Role);

public record ItemAlertRecipientsDto(
    List<Guid> SelectedUserIds,
    List<AlertRecipientDto> Candidates,
    string DefaultDescription);
