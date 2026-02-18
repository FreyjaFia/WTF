using MediatR;

namespace WTF.Contracts.Auth.Commands;

public record UpdateMeCommand(
    string Password
) : IRequest<bool>;
