using MediatR;
using System.ComponentModel.DataAnnotations;

namespace WTF.Contracts.Auth.Commands;

public record ChangePasswordCommand : IRequest<bool>
{
    [Required]
    public string CurrentPassword { get; init; } = string.Empty;

    [Required]
    [MinLength(8)]
    public string NewPassword { get; init; } = string.Empty;
}
