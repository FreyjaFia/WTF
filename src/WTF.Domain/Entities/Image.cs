using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class Image
{
    public string ImageUrl { get; set; } = null!;

    public DateTime UploadedAt { get; set; }

    public Guid ImageId { get; set; }

    public virtual ProductImage? ProductImage { get; set; }
}
