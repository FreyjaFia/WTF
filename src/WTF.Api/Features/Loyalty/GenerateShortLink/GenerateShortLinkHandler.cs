using MediatR;
using WTF.Contracts;
using WTF.Domain.Data;
using WTF.Domain.Entities;

namespace WTF.Api.Features.Loyalty.GenerateShortLink
{
    public class GenerateShortLinkHandler(WTFDbContext db) : IRequestHandler<GenerateShortLinkCommand, ShortLinkDto>
    {
        private readonly WTFDbContext _db = db;

        public async Task<ShortLinkDto> Handle(GenerateShortLinkCommand request, CancellationToken cancellationToken)
        {
            var token = GenerateToken(8);

            var link = new ShortLink
            {
                Token = token,
                TargetType = "Loyalty",
                TargetId = request.CustomerId
            };

            _db.ShortLinks.Add(link);
            await _db.SaveChangesAsync(cancellationToken);

            return new ShortLinkDto(token);
        }

        private static string GenerateToken(int length)
        {
            var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            var rng = new Random();

            return new string([.. Enumerable.Repeat(chars, length).Select(s => s[rng.Next(s.Length)])]);
        }
    }
}
