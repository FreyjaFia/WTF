using MediatR;

namespace WTF.Contracts.Auth.Queries;

public record GetMeQuery() : IRequest<MeDto?>;
