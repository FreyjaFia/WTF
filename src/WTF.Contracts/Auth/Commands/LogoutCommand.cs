using MediatR;

namespace WTF.Contracts.Auth.Commands;

public record LogoutCommand(string RefreshToken) : IRequest<bool>;