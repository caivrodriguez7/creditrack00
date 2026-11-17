using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CrediTrack.Api.Controllers;

// ASP.NET Core MVC part for the Customer screens (Controller -> View). The views are in Views/Customer/*.cshtml and use the
// shared layout. The addresses are the same as before: /customer/home, /customer/history ...
// The data of each screen is loaded by its JavaScript from the JSON API (api/customer/...).
[Authorize(Policy = "CustomerOnly")]
[Route("customer")]
public class CustomerController : Controller
{
    // GET /customer/about
    [HttpGet("about")]
    public IActionResult About() => View();

    // GET /customer/customer-code
    [HttpGet("customer-code")]
    public IActionResult CustomerCode() => View();

    // GET /customer/help-support
    [HttpGet("help-support")]
    public IActionResult HelpSupport() => View();

    // GET /customer/history
    [HttpGet("history")]
    public IActionResult History() => View();

    // GET /customer/home
    [HttpGet("home")]
    public IActionResult Home() => View();

    // GET /customer/join-store
    [HttpGet("join-store")]
    public IActionResult JoinStore() => View();

    // GET /customer/notifications
    [HttpGet("notifications")]
    public IActionResult Notifications() => View();

    // GET /customer/payment-request-details
    [HttpGet("payment-request-details")]
    public IActionResult PaymentRequestDetails() => View();

    // GET /customer/payments
    [HttpGet("payments")]
    public IActionResult Payments() => View();

    // GET /customer/personal-info
    [HttpGet("personal-info")]
    public IActionResult PersonalInfo() => View();

    // GET /customer/profile
    [HttpGet("profile")]
    public IActionResult Profile() => View();

    // GET /customer/profile-edit
    [HttpGet("profile-edit")]
    public IActionResult ProfileEdit() => View();

    // GET /customer/request-payment
    [HttpGet("request-payment")]
    public IActionResult RequestPayment() => View();

    // GET /customer/security
    [HttpGet("security")]
    public IActionResult Security() => View();

    // GET /customer/settings-notifications
    [HttpGet("settings-notifications")]
    public IActionResult SettingsNotifications() => View();

    // GET /customer/stores
    [HttpGet("stores")]
    public IActionResult Stores() => View();

    // GET /customer/transaction-details
    [HttpGet("transaction-details")]
    public IActionResult TransactionDetails() => View();
}
