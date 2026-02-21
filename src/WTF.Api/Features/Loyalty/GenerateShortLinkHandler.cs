using MediatR;
using WTF.Api.Features.Loyalty.DTOs;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Loyalty;

public record GenerateShortLinkCommand(Guid CustomerId) : IRequest<GenerateShortLinkDto>;

public class GenerateShortLinkHandler(WTFDbContext db)
    : IRequestHandler<GenerateShortLinkCommand, GenerateShortLinkDto>
{
    public async Task<GenerateShortLinkDto> Handle(GenerateShortLinkCommand request,
        CancellationToken cancellationToken)
    {
        var token = GenerateToken(8);

        var link = new ShortLink
        {
            Token = token,
            TargetType = "Loyalty",
            TargetId = request.CustomerId
        };

        db.ShortLinks.Add(link);
        await db.SaveChangesAsync(cancellationToken);

        return new GenerateShortLinkDto(token);
    }

    private static string GenerateToken(int length)
    {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        var rng = new Random();

        return new string([.. Enumerable.Repeat(chars, length).Select(s => s[rng.Next(s.Length)])]);
    }
}