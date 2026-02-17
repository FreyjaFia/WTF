using MediatR;

namespace WTF.Contracts.Users.Commands;

public record UploadUserImageCommand(Guid UserId, byte[] ImageData, string FileName) : IRequest<UserDto?>;