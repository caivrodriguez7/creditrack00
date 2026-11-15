using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Store Information (Settings > Store Information) and the owner Dashboard numbers
[ApiController]
[Route("api/owner")]
[Authorize(Roles = "owner")]
public class OwnerStoreController : ControllerBase
{
    private readonly AppDb _db;
    public OwnerStoreController(AppDb db) { _db = db; }

    public record StoreRequest(string? Name, string? Phone, string? Address, string? BusinessType, string? StoreHours);

    private async Task<Store?> MyStore()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Stores.FirstOrDefaultAsync(s => s.OwnerId == userId);
    }

    private static object Dto(Store s) => new
    {
        id = s.Id,
        name = s.Name,
        phone = s.Phone ?? "",
        address = s.Address ?? "",
        businessType = s.BusinessType ?? "",
        storeHours = s.StoreHours ?? "",
        storeCode = s.StoreCode,          // read-only
        autoApproveJoins = s.AutoApproveJoins,
        createdAt = s.CreatedAt
    };

    // GET /api/owner/store
    [HttpGet("store")]
    public async Task<IActionResult> GetStore()
    {
        var store = await MyStore();
        return store == null ? NotFound(new { message = "No store found for this account." }) : Ok(Dto(store));
    }

    // PUT /api/owner/store : the store code can never be changed here
    [HttpPut("store")]
    public async Task<IActionResult> UpdateStore(StoreRequest req)
    {
        var store = await MyStore();
        if (store == null) return NotFound(new { message = "No store found for this account." });

        var name = string.Join(" ", (req.Name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (name.Length < 2 || name.Length > 80 || !Validation.PlainText(name))
            return BadRequest(new { field = "name", message = "Enter your store name (2 to 80 characters, no < or > symbols)." });

        var phone = (req.Phone ?? "").Trim();
        if (phone.Length > 0)
        {
            var digits = phone.Count(char.IsDigit);
            if (digits < 7 || digits > 13 || phone.Any(c => !(char.IsDigit(c) || " +-()".Contains(c))))
                return BadRequest(new { field = "phone", message = "Enter a valid contact number." });
        }
        var address = (req.Address ?? "").Trim();
        if (address.Length > 200 || !Validation.PlainText(address))
            return BadRequest(new { field = "address", message = "Use an address of 200 characters or fewer, without < or > symbols." });
        var type = (req.BusinessType ?? "").Trim();
        if (type.Length > 50 || !Validation.PlainText(type))
            return BadRequest(new { field = "businessType", message = "Use a business type of 50 characters or fewer, without < or > symbols." });
        var hours = (req.StoreHours ?? "").Trim();
        if (hours.Length > 100 || !Validation.PlainText(hours))
            return BadRequest(new { field = "storeHours", message = "Use store hours of 100 characters or fewer, without < or > symbols." });

        store.Name = name;
        store.Phone = phone.Length > 0 ? phone : null;
        store.Address = address.Length > 0 ? address : null;
        store.BusinessType = type.Length > 0 ? type : null;
        store.StoreHours = hours.Length > 0 ? hours : null;
        await _db.SaveChangesAsync();
        return Ok(Dto(store));
    }

    public record AutoApproveRequest(bool Enabled);

    // PUT /api/owner/store/auto-approve { enabled }
    // On: a customer who enters the store code is added to the customer list at once. Off (the default): every new join
    // waits for the owner's Approve. It only changes how FUTURE joins are handled, requests already waiting stay waiting.
    [HttpPut("store/auto-approve")]
    public async Task<IActionResult> SetAutoApprove(AutoApproveRequest req)
    {
        var store = await MyStore();
        if (store == null) return NotFound(new { message = "No store found for this account." });
        store.AutoApproveJoins = req.Enabled;
        await _db.SaveChangesAsync();
        return Ok(new { autoApproveJoins = store.AutoApproveJoins });
    }

    // GET /api/owner/dashboard : everything the dashboard shows, in one request
    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard()
    {
        var store = await MyStore();
        if (store == null) return BadRequest(new { message = "No store found for this account." });
        var storeId = store.Id;

        var balances = await Ledger.Balances(_db, storeId);
        var customers = await _db.Customers.Where(c => c.StoreId == storeId)
            .Select(c => new { c.Id, c.IsArchived }).ToListAsync();

        var pendingQuery = _db.PaymentRequests.Where(r => r.StoreId == storeId && r.Status == "pending" && !r.IsArchived);
        var pendingCount = await pendingQuery.CountAsync();
        var pendingAmount = await pendingQuery.SumAsync(r => (decimal?)r.Amount) ?? 0m;
        var pendingRows = await PaymentRequests.Project(pendingQuery.OrderByDescending(r => r.SubmittedAt).Take(5)).ToListAsync();

        // Reviewed requests (confirmed or rejected, archived ones too) so nothing a customer sent ever disappears from view
        var reviewedQuery = _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.StoreId == storeId && r.Status != "pending");
        var reviewedRows = await PaymentRequests.Project(reviewedQuery
            .OrderByDescending(r => r.ReviewedAt ?? r.SubmittedAt).ThenByDescending(r => r.Id).Take(5)).ToListAsync();
        var archivedRequestCount = await _db.PaymentRequests.IgnoreQueryFilters().CountAsync(r => r.StoreId == storeId && r.IsArchived);

        var overdueAccounts = (await OverdueRule.OverdueCustomerDays(_db, storeId)).Count;   // the Part 4A rule: customers with an overdue credit
        var states = await Ledger.CreditStates(_db, storeId);
        var recent = await _db.Transactions.Include(t => t.Items).Include(t => t.Customer).Include(t => t.VoidedBy)
            .Where(t => t.StoreId == storeId)
            .OrderByDescending(t => t.Date).ThenByDescending(t => t.Id).Take(5).ToListAsync();

        return Ok(new
        {
            isSample = false,
            storeName = store.Name,
            outstandingBalance = Math.Round(balances.Values.Sum(), 2),
            totalCustomers = customers.Count,
            activeCustomers = customers.Count(c => !c.IsArchived),
            customersWithDebt = customers.Count(c => balances.GetValueOrDefault(c.Id) > 0),
            overdueCount = overdueAccounts,
            pendingPaymentCount = pendingCount,
            pendingPaymentAmount = pendingAmount,
            pendingPayments = pendingRows.Select(r => PaymentRequests.Dto(r, null)).ToList(),
            recentReviewed = reviewedRows.Select(r => PaymentRequests.Dto(r, null)).ToList(),
            archivedRequestCount,
            recentTransactions = recent.Select(t => Ledger.BuildRow(t, t.Customer, states.GetValueOrDefault(t.Id))).ToList()
        });
    }
}
