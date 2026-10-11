using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class ConversationMessage
{
    public Guid Id { get; set; }

    public Guid ConversationId { get; set; }

    public byte SenderType { get; set; }

    public Guid? SenderUserId { get; set; }

    public string Body { get; set; } = null!;

    public DateTime CreatedAt { get; set; }

    public DateTime? ReadByStaffAt { get; set; }

    public DateTime? ReadByCustomerAt { get; set; }

    public virtual Conversation Conversation { get; set; } = null!;

    public virtual User? SenderUser { get; set; }
}
