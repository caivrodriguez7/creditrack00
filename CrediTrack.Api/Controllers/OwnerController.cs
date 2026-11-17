using CrediTrack.Api.Services;
using CrediTrack.Api.ViewModels;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CrediTrack.Api.Controllers;

// ASP.NET Core MVC part of CrediTrack (Controller -> View -> Model/ViewModel).
// All Store Owner screens are MVC views (Views/Owner/*.cshtml). The public pages (login, register, email links) are Razor Pages (Pages/*.cshtml)
// and the JSON API is in the other controllers (api/...). They share one project, one layout and one login.
// The addresses are the same as before: /owner/dashboard, /owner/customers, /owner/transactions ...
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

    // ---- Screens moved from Razor Pages to MVC (same addresses as before) ----

    // GET /owner/customer-details
    [HttpGet("customer-details")]
    public IActionResult CustomerDetails() => View();

    // GET /owner/customer-form
    [HttpGet("customer-form")]
    public IActionResult CustomerForm() => View();

    // GET /owner/dashboard
    [HttpGet("dashboard")]
    public IActionResult Dashboard() => View();

    // GET /owner/help-support
    [HttpGet("help-support")]
    public IActionResult HelpSupport() => View();

    // GET /owner/notifications
    [HttpGet("notifications")]
    public IActionResult Notifications() => View();

    // GET /owner/overdue
    [HttpGet("overdue")]
    public IActionResult Overdue() => View();

    // GET /owner/payment-request-details
    [HttpGet("payment-request-details")]
    public IActionResult PaymentRequestDetails() => View();

    // GET /owner/payment-requests
    [HttpGet("payment-requests")]
    public IActionResult PaymentRequests() => View();

    // GET /owner/profile-edit
    [HttpGet("profile-edit")]
    public IActionResult ProfileEdit() => View();

    // GET /owner/reports
    [HttpGet("reports")]
    public IActionResult Reports() => View();

    // GET /owner/security
    [HttpGet("security")]
    public IActionResult Security() => View();

    // GET /owner/settings
    [HttpGet("settings")]
    public IActionResult Settings() => View();

    // GET /owner/settings-notifications
    [HttpGet("settings-notifications")]
    public IActionResult SettingsNotifications() => View();

    // GET /owner/store-qr
    [HttpGet("store-qr")]
    public IActionResult StoreQr() => View();

    // GET /owner/transaction-details
    [HttpGet("transaction-details")]
    public IActionResult TransactionDetails() => View();

    // GET /owner/transaction-edit
    [HttpGet("transaction-edit")]
    public IActionResult TransactionEdit() => View();

    // GET /owner/transactions
    [HttpGet("transactions")]
    public IActionResult Transactions() => View();
}
