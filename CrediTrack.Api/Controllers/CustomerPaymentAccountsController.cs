using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Make a Payment (customer): the GCash / Maya / Bank details a store shows, so the customer can copy the number or save the QR.
// The customer can only read the accounts of a store they have joined and not left.
[ApiController]
[Route("api/customer/stores/{customerId:int}/payment-accounts")]
[Authorize(Roles = "customer")]
public class CustomerPaymentAccountsController : ControllerBase
{
    private readonly AppDb _db;
    public CustomerPaymentAccountsController(AppDb db) { _db = db; }

    // GET /api/customer/stores/{customerId}/payment-accounts   (customerId = my record in that store, the same id Make a Payment uses)
    [HttpGet]
    public async Task<IActionResult> Get(int customerId)
    {
        var me = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var record = await _db.Customers.AsNoTracking()
            .Where(c => c.Id == customerId && c.LinkedUserId == me && !c.IsDisconnected)
            .Select(c => new { c.StoreId, StoreName = c.Store.Name })
            .FirstOrDefaultAsync();
        if (record == null) return NotFound(new { message = "Store not found." });

        var rows = await _db.StorePaymentAccounts.AsNoTracking().Where(a => a.StoreId == record.StoreId).ToListAsync();
        var accounts = StorePaymentAccount.Methods
            .Select(m => rows.FirstOrDefault(a => a.Method == m))
            .OfType<StorePaymentAccount>()                       // only the methods the owner has set up
            .Select(a => new
            {
                method = a.Method,
                accountName = a.AccountName,
                accountNumber = a.AccountNumber,
                bankName = a.BankName ?? "",
                qrUrl = FileStorage.Url(a.QrPath)
            }).ToList();

        Response.Headers.CacheControl = "no-store";              // a change by the owner shows at once
        return Ok(new { storeName = record.StoreName, accounts });
    }
}
