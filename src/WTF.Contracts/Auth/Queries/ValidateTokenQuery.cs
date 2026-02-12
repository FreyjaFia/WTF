using MediatR;

namespace WTF.Contracts.Auth.Queries;

public record ValidateTokenQuery(string Token) : IRequest<ValidateTokenDto>;