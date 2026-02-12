using MediatR;

namespace WTF.Contracts.Auth.Commands;

public record RefreshTokenCommand(string RefreshToken) : IRequest<LoginDto?>;
