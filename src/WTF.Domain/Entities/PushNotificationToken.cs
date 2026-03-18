using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class PushNotificationToken
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string Platform { get; set; } = null!;

    public string Token { get; set; } = null!;

    public string? DeviceId { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime LastSeenAt { get; set; }

    public virtual User User { get; set; } = null!;
}
