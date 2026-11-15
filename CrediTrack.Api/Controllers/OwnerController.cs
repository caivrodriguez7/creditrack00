using CrediTrack.Api.Services;
using CrediTrack.Api.ViewModels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CrediTrack.Api.Controllers;

// ASP.NET Core MVC part of CrediTrack (Controller -> View -> Model/ViewModel).
// These Store Owner screens are MVC views (Views/Owner/*.cshtml). The other screens are Razor Pages (Pages/*.cshtml)
// and the JSON API is in the other controllers (api/...). The three styles share one project, one layout and one login.
// Same address as before: /owner/store-information, /owner/about, /owner/customers.
[Authorize(Policy = "OwnerOnly")]
[Route("owner")]
public class OwnerController : Controller
{
    private readonly SiteInfo _site;
    public OwnerController(IOptions<SiteInfo> site) { _site = site.Value; }

    // GET /owner/store-information
    [HttpGet("store-information")]
    public IActionResult StoreInformation() => View();

    // GET /owner/about
    [HttpGet("about")]
    public IActionResult About()
    {
        var v = typeof(Program).Assembly.GetName().Version;
        var model = new AboutViewModel
        {
            Name = string.IsNullOrWhiteSpace(_site.SystemName) ? "CrediTrack" : _site.SystemName,
            Tagline = _site.Tagline ?? "",
            Version = v == null ? "1.0.0" : $"{v.Major}.{v.Minor}.{Math.Max(v.Build, 0)}"
        };
        return View(model);
    }

    // GET /owner/customers
    [HttpGet("customers")]
    public IActionResult Customers() => View();
}
