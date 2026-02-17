using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class UserImage
{
    public Guid UserId { get; set; }

    public Guid ImageId { get; set; }

    public virtual Image Image { get; set; } = null!;

    public virtual User User { get; set; } = null!;
}
