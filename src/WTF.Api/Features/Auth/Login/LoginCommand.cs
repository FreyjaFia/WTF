using MediatR;

namespace WTF.Api.Features.Auth.Login;

public record LoginCommand(string Username, string Password) : IRequest<LoginResponse>;