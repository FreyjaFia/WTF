using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Forms;
using WTF.Contracts.Auth.Login;
using WTF.MAUI.Services;

namespace WTF.MAUI.Components.Pages
{
    public partial class Login : ComponentBase
    {
        [Inject] private IAuthService AuthService { get; set; } = default!;
        [Inject] private ITokenService TokenService { get; set; } = default!;
        [Inject] private NavigationManager NavManager { get; set; } = default!;

        protected LoginRequestDto LoginRequestDto = new();
        protected bool IsLoading { get; set; }
        protected string ErrorMessage { get; set; } = string.Empty;


        protected override async Task OnInitializedAsync()
        {
            var token = await TokenService.GetAccessTokenAsync();

            if (!string.IsNullOrWhiteSpace(token))
            {
                var isValid = await AuthService.ValidateTokenAsync();

                if (isValid)
                {
                    NavManager.NavigateTo("/counter");
                    return;
                }
            }

            await base.OnInitializedAsync();
        }

        private async Task HandleLogin(EditContext context)
        {
            if (!context.Validate())
            {
                return;
            }

            IsLoading = true;
            ErrorMessage = string.Empty;
            StateHasChanged();

            try
            {
                var success = await AuthService.LoginAsync(LoginRequestDto!.Username, LoginRequestDto.Password);
                if (success)
                {
                    NavManager.NavigateTo("/counter");
                }
                else
                {
                    ErrorMessage = "Invalid username or password.";
                }
            }
            catch (Exception ex)
            {
                ErrorMessage = "An error occurred. Please try again.";
            }
            finally
            {
                IsLoading = false;
                StateHasChanged();
            }
        }
    }
}
