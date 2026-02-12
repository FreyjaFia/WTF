using MediatR;

namespace WTF.Contracts.Auth.Commands;

public record LoginCommand(string Username, string Password) : IRequest<LoginDto>;
