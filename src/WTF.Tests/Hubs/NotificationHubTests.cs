using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using NSubstitute;
using System.Security.Claims;
using WTF.Api.Common.Auth;
using WTF.Api.Hubs;

namespace WTF.Tests.Hubs;

public class NotificationHubTests
{
    private readonly IAuthorizationService _authorization = Substitute.For<IAuthorizationService>();
    private readonly IGroupManager _groups = Substitute.For<IGroupManager>();
    private readonly HubCallerContext _context = Substitute.For<HubCallerContext>();
    private readonly Guid _userId = Guid.NewGuid();

    private NotificationHub Hub(bool canSeeStock)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, _userId.ToString())], "test");
        _context.User.Returns(new ClaimsPrincipal(identity));
        _context.ConnectionId.Returns("conn-1");
        _authorization.AuthorizeAsync(Arg.Any<ClaimsPrincipal>(), Arg.Any<object?>(), AppPolicies.StockMovementsRead)
            .Returns(canSeeStock ? AuthorizationResult.Success() : AuthorizationResult.Failed());

        return new NotificationHub(_authorization) { Context = _context, Groups = _groups };
    }

    [Fact]
    public async Task OnConnected_JoinsThePersonsOwnGroup()
    {
        await Hub(canSeeStock: false).OnConnectedAsync();

        await _groups.Received(1).AddToGroupAsync("conn-1", HubNames.Groups.User(_userId), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task OnConnected_StockPeopleAlsoJoinTheStockGroup()
    {
        await Hub(canSeeStock: true).OnConnectedAsync();

        await _groups.Received(1).AddToGroupAsync("conn-1", HubNames.Groups.StockViewers, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task OnConnected_OthersDoNotJoinTheStockGroup()
    {
        await Hub(canSeeStock: false).OnConnectedAsync();

        await _groups.DidNotReceive().AddToGroupAsync(Arg.Any<string>(), HubNames.Groups.StockViewers, Arg.Any<CancellationToken>());
    }

    [Fact]
    public void TheHub_HasNoMethodsAClientCanCall()
    {
        typeof(NotificationHub).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly)
            .Select(m => m.Name)
            .ShouldBe(["OnConnectedAsync"]);
    }
}
