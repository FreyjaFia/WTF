using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ShortLink
{
    public Guid Id { get; set; }

    public string Token { get; set; } = null!;

    public string TargetType { get; set; } = null!;

    public Guid? TargetId { get; set; }

    public string? TargetUrl { get; set; }

    public DateTime? ExpiresAt { get; set; }
}
