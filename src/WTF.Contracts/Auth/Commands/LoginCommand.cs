using MediatR;

namespace WTF.Contracts.Auth.Login;

public record LoginCommand(string Username, string Password) : IRequest<LoginDto>;
