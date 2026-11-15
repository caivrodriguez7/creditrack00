using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Overdue Accounts (Part 5A backend; Part 5B: the Overdue Accounts page now reads this endpoint for real accounts, see queryOverdueAccounts in js/api/owner-api.js).
//
// GET /api/owner/overdue-accounts?search=ana&overdueRange=8-30&sortBy=amount-desc&page=1&pageSize=20
//   search         customer name contains the text (not case sensitive)
//   overdueRange   all (default) | 1-7 | 8-30 | 30+   days overdue of the customer's oldest overdue credit
//   sortBy         due-asc (default, oldest due date first) | due-desc | amount-desc | amount-asc | days-desc | days-asc | name-asc | name-desc
//   page, pageSize 1-based page and 1..100 rows (default 1 and 20)
// Response { isSample, items, totalCount, page, pageSize, totalPages, hasMore,
//           summary { count, total }, chipCounts { all, 1-7, 8-30, 30+ }, totalAll }
//   items[]  { customerId, code, name, phone, archived, balance (outstanding), overdueAmount, dueDate, daysOverdue, overdueCredits }
// Who is overdue comes only from OverdueRule (Part 4A); everything is limited to the signed-in owner's own store.
[ApiController]
[Route("api/owner/overdue-accounts")]
[Authorize(Roles = "owner")]
public class OwnerOverdueAccountsController : ControllerBase
{
    private readonly AppDb _db;
    public OwnerOverdueAccountsController(AppDb db) { _db = db; }

    private async Task<int?> MyStoreId()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Stores.Where(s => s.OwnerId == userId)
            .Select(s => (int?)s.Id).FirstOrDefaultAsync();
    }

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] OverdueAccountQuery q)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        // The store id comes from the signed-in user, never from the request, and every query below filters on it
        var accounts = OverdueRule.Accounts((await OverdueRule.ForStore(_db, storeId.Value)).Values);
        var ids = accounts.Select(a => a.CustomerId).ToList();
        var customers = await _db.Customers.AsNoTracking()
            .Where(c => c.StoreId == storeId && ids.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id);
        var balances = await Ledger.Balances(_db, storeId.Value);

        var result = OverdueAccounts.Build(accounts, customers, balances, q);
        result["isSample"] = false;
        return Ok(result);
    }
}
