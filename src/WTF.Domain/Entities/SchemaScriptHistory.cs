using System;
using System.Collections.Generic;

namespace WTF.Domain.Entities;

public partial class SchemaScriptHistory
{
    public int Id { get; set; }

    public string ScriptName { get; set; } = null!;

    public DateTime AppliedAt { get; set; }
}
