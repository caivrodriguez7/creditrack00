using System.Globalization;
using System.Security.Claims;
using System.Text.RegularExpressions;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Payment requests sent by customers. Approving one records a real payment; nothing changes a balance before that.
[ApiController]
[Route("api/owner/payment-requests")]
[Authorize(Roles = "owner")]
public class OwnerPaymentRequestsController : ControllerBase
{
    private readonly AppDb _db;
    public OwnerPaymentRequestsController(AppDb db) { _db = db; }

    public record RejectRequest(string? Reason);

    private int UserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private async Task<int?> MyStoreId()
    {
        var userId = UserId();
        return await _db.Stores.Where(s => s.OwnerId == userId).Select(s => (int?)s.Id).FirstOrDefaultAsync();
    }

    private async Task<Dictionary<int, TxInfo>> TxInfos(IEnumerable<int?> ids)
    {
        var list = ids.Where(i => i != null).Select(i => i!.Value).Distinct().ToList();
        if (list.Count == 0) return new();
        return await _db.Transactions.Where(t => list.Contains(t.Id))
            .Select(t => new { t.Id, t.IsVoided, t.Number })
            .ToDictionaryAsync(t => t.Id, t => new TxInfo(t.IsVoided, t.Number));
    }

    public class RequestQuery
    {
        public string? Search { get; set; }
        public string? Status { get; set; }
        public string? Method { get; set; }
        public int? CustomerId { get; set; }
        public string? Sort { get; set; }
        public string? Dir { get; set; }
        public int? Page { get; set; }
        public int? PageSize { get; set; }
    }

    // GET /api/owner/payment-requests?status=all|pending|confirmed|rejected|voided|archived&search=&method=&customerId=
    //     &sort=default|submitted|amount|customer|status&dir=asc|desc&page=1&pageSize=20
    // "default" lists pending requests first, then the newest. "all" leaves archived requests out.
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] RequestQuery q)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        var status = Paging.Pick(q.Status, new[] { "all", "pending", "confirmed", "rejected", "voided", "archived" }, "all");
        var sort = Paging.Pick(q.Sort, new[] { "default", "submitted", "amount", "customer", "status" }, "default");
        var desc = Paging.Pick(q.Dir, new[] { "asc", "desc" }, "desc") == "desc";
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);
        var search = Paging.Search(q.Search);

        // Archived requests are hidden by the global filter in AppDb; this list shows (and counts) them, so it opts out.
        var all = _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.StoreId == storeId);
        // A confirmed request whose payment was later voided is "voided", not "confirmed" (its effect on the balance is reversed)
        var voidedIds = _db.Transactions.Where(t => t.StoreId == storeId && t.IsVoided).Select(t => t.Id);
        var counts = new
        {
            pending = await all.CountAsync(r => !r.IsArchived && r.Status == "pending"),
            confirmed = await all.CountAsync(r => !r.IsArchived && r.Status == "approved"
                && !(r.TransactionId != null && voidedIds.Contains(r.TransactionId.Value))),
            voided = await all.CountAsync(r => !r.IsArchived && r.Status == "approved"
                && r.TransactionId != null && voidedIds.Contains(r.TransactionId.Value)),
            rejected = await all.CountAsync(r => !r.IsArchived && r.Status == "rejected"),
            all = await all.CountAsync(r => !r.IsArchived),
            archived = await all.CountAsync(r => r.IsArchived)
        };

        var matches = all;
        if (status == "archived") matches = matches.Where(r => r.IsArchived);
        else
        {
            matches = matches.Where(r => !r.IsArchived);
            if (status == "pending") matches = matches.Where(r => r.Status == "pending");
            else if (status == "confirmed") matches = matches.Where(r => r.Status == "approved"
                && !(r.TransactionId != null && voidedIds.Contains(r.TransactionId.Value)));
            else if (status == "voided") matches = matches.Where(r => r.Status == "approved"
                && r.TransactionId != null && voidedIds.Contains(r.TransactionId.Value));
            else if (status == "rejected") matches = matches.Where(r => r.Status == "rejected");
        }
        if (!string.IsNullOrWhiteSpace(q.Method)) matches = matches.Where(r => r.Method == q.Method);
        if (q.CustomerId != null) matches = matches.Where(r => r.CustomerId == q.CustomerId);
        if (search.Length > 0)
        {
            var like = Paging.Like(search);
            var code = Regex.Match(search, @"^pr-?(\d+)$", RegexOptions.IgnoreCase);
            if (code.Success && int.TryParse(code.Groups[1].Value, out var number))
                matches = matches.Where(r => r.Id == number);
            else
                matches = matches.Where(r => EF.Functions.ILike(r.Customer.Name, like, "\\")
                    || (r.Reference != null && EF.Functions.ILike(r.Reference, like, "\\")));
        }

        var totalCount = await matches.CountAsync();
        var ordered = (sort, desc) switch
        {
            ("submitted", true) => matches.OrderByDescending(r => r.SubmittedAt),
            ("submitted", false) => matches.OrderBy(r => r.SubmittedAt),
            ("amount", true) => matches.OrderByDescending(r => r.Amount),
            ("amount", false) => matches.OrderBy(r => r.Amount),
            ("customer", true) => matches.OrderByDescending(r => r.Customer.Name),
            ("customer", false) => matches.OrderBy(r => r.Customer.Name),
            ("status", true) => matches.OrderByDescending(r => r.Status),
            ("status", false) => matches.OrderBy(r => r.Status),
            _ => matches.OrderBy(r => r.Status == "pending" ? 0 : 1).ThenByDescending(r => r.SubmittedAt)
        };
        var rows = await PaymentRequests.Project(ordered.ThenByDescending(r => r.Id)
            .Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync();
        var infos = await TxInfos(rows.Select(r => r.TransactionId));

        var result = Paging.Result(rows.Select(r => PaymentRequests.Dto(r, r.TransactionId == null ? null : infos.GetValueOrDefault(r.TransactionId.Value))),
            totalCount, page, pageSize);
        result["counts"] = counts;
        return Ok(result);
    }

    // GET /api/owner/payment-requests/{id} : with the proof picture (its /api/files URL) and the customer's balance right now
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        var row = await PaymentRequests.Project(_db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id && r.StoreId == storeId)).FirstOrDefaultAsync();
        if (row == null) return NotFound(new { message = "Payment request not found." });

        var proof = await _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id).Select(r => r.ProofPath).FirstOrDefaultAsync();
        var infos = await TxInfos(new int?[] { row.TransactionId });
        var balance = await Ledger.BalanceOf(_db, row.CustomerId);
        // When the payment this request created was voided later, say when and why
        var voided = await _db.Transactions.Where(t => t.Id == row.TransactionId && t.IsVoided)
            .Select(t => new { t.VoidedAt, t.VoidReason, t.VoidRemarks }).FirstOrDefaultAsync();
        return Ok(new
        {
            request = PaymentRequests.Dto(row, row.TransactionId == null ? null : infos.GetValueOrDefault(row.TransactionId.Value), FileStorage.Url(proof)),
            customerBalance = balance,
            voidInfo = voided == null ? null : new { at = voided.VoidedAt, reasonLabel = voided.VoidReason, remarks = voided.VoidRemarks }
        });
    }

    // POST /api/owner/payment-requests/{id}/approve : records the payment (Transaction) and confirms the request, together or not at all
    [HttpPost("{id:int}/approve")]
    public async Task<IActionResult> Approve(int id)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        // One writer at a time for this store (see StoreLock): the status check, the balance check, the next number and
        // the insert below all run alone, up to the commit. Every early "return" rolls the transaction back.
        await using var dbTx = await StoreLock.BeginAsync(_db, storeId.Value);
        var request = await _db.PaymentRequests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id && r.StoreId == storeId);
        if (request == null) return NotFound(new { message = "Payment request not found." });
        if (request.Status != "pending")
            return Conflict(new { message = "This request was already " + (request.Status == "approved" ? "confirmed" : "rejected") + "." });

        var balance = await Ledger.BalanceOf(_db, request.CustomerId);
        if (request.Amount > balance)
            return Conflict(new { message = "The customer's balance is now ₱" + balance.ToString("N2", CultureInfo.InvariantCulture)
                + ", which is less than this request. Reject it and ask for a new one." });

        // The same reference number (same customer and method) must not be recorded twice
        if (!string.IsNullOrEmpty(request.Reference))
        {
            var reference = request.Reference.ToLower();
            var duplicate = await _db.Transactions.AnyAsync(t => t.StoreId == storeId && t.CustomerId == request.CustomerId
                && t.Type == "payment" && !t.IsVoided && t.Method == request.Method
                && t.Reference != null && t.Reference.ToLower() == reference);
            if (duplicate)
                return Conflict(new { message = "A payment with this reference number is already recorded for this customer." });
        }

        var now = DateTime.UtcNow;
        var userId = UserId();
        // Claiming the request first means two owners (or a double click) can never approve it twice
        var claimed = await _db.PaymentRequests.Where(r => r.Id == id && r.Status == "pending")
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Status, "approved")
                .SetProperty(r => r.ReviewedAt, (DateTime?)now)
                .SetProperty(r => r.ReviewedByUserId, (int?)userId));
        if (claimed == 0)
            return Conflict(new { message = "This request was just reviewed by someone else." });

        var payment = new Transaction
        {
            StoreId = storeId!.Value,
            Number = await Ledger.NextNumber(_db, storeId.Value),
            CustomerId = request.CustomerId,
            Type = "payment",
            Amount = request.Amount,
            Date = now,
            Method = request.Method,
            Reference = request.Reference,
            Note = request.Message,
            BalanceBefore = balance,
            RequestId = "payreq-" + id
        };
        _db.Transactions.Add(payment);
        try
        {
            await _db.SaveChangesAsync();
            await _db.PaymentRequests.Where(r => r.Id == id)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.TransactionId, (int?)payment.Id));
            await dbTx.CommitAsync();
        }
        catch (DbUpdateException ex) when (StoreLock.IsUniqueViolation(ex))
        {
            // This request already produced a payment (RequestId "payreq-<id>" is unique): nothing new is saved
            // and the FIRST payment is returned.
            await dbTx.RollbackAsync();
            _db.ChangeTracker.Clear();
            var first = await _db.Transactions.AsNoTracking()
                .FirstOrDefaultAsync(t => t.StoreId == storeId && t.RequestId == "payreq-" + id);
            if (first == null) throw;
            var existing = await PaymentRequests.Project(_db.PaymentRequests.Where(r => r.Id == id)).FirstAsync();
            return Ok(new
            {
                request = PaymentRequests.Dto(existing, new TxInfo(false, first.Number)),
                transactionId = first.Id,
                balanceBefore = first.BalanceBefore,
                balanceAfter = first.BalanceBefore - first.Amount,
                duplicate = true
            });
        }

        await SettleOwnerNotifications(id);
        var storeName = await _db.Stores.Where(s => s.Id == storeId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, request.UserId, "payment_approved", "Payment Request Approved",
            storeName + " approved your " + request.Method + " payment of " + Notifier.Peso(request.Amount) + ". It was deducted from your balance.",
            "request", id);

        var row = await PaymentRequests.Project(_db.PaymentRequests.Where(r => r.Id == id)).FirstAsync();
        return Ok(new
        {
            request = PaymentRequests.Dto(row, new TxInfo(false, payment.Number)),
            transactionId = payment.Id,
            balanceBefore = balance,
            balanceAfter = balance - request.Amount
        });
    }

    // Once a request has been reviewed, its "New Payment Request" notification no longer needs attention
    private async Task SettleOwnerNotifications(int requestId)
    {
        try
        {
            await _db.Notifications
                .Where(n => n.Type == "payment_request" && n.TargetKind == "request" && n.TargetId == requestId && n.ReadAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, (DateTime?)DateTime.UtcNow));
        }
        catch { /* never block the review */ }
    }

    // POST /api/owner/payment-requests/{id}/reject { reason }  (3 to 200 characters, the customer sees it)
    [HttpPost("{id:int}/reject")]
    public async Task<IActionResult> Reject(int id, RejectRequest req)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        if (!await _db.PaymentRequests.AnyAsync(r => r.Id == id && r.StoreId == storeId))
            return NotFound(new { message = "Payment request not found." });

        var reason = (req.Reason ?? "").Trim();
        if (reason.Length < 3 || reason.Length > 200)
            return BadRequest(new { field = "reason", message = "Give a reason of 3 to 200 characters." });

        var now = DateTime.UtcNow;
        var userId = UserId();
        var changed = await _db.PaymentRequests.Where(r => r.Id == id && r.StoreId == storeId && r.Status == "pending")
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Status, "rejected")
                .SetProperty(r => r.RejectReason, reason)
                .SetProperty(r => r.ReviewedAt, (DateTime?)now)
                .SetProperty(r => r.ReviewedByUserId, (int?)userId));
        if (changed == 0) return Conflict(new { message = "This request has already been reviewed." });

        await SettleOwnerNotifications(id);
        var info = await _db.PaymentRequests.AsNoTracking().Where(r => r.Id == id)
            .Select(r => new { r.UserId, r.Amount, r.Method }).FirstAsync();
        var storeName = await _db.Stores.Where(s => s.Id == storeId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, info.UserId, "payment_rejected", "Payment Request Rejected",
            storeName + " did not accept your " + info.Method + " payment request of " + Notifier.Peso(info.Amount) + ". Reason: " + reason,
            "request", id);

        var row = await PaymentRequests.Project(_db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id)).FirstAsync();
        return Ok(PaymentRequests.Dto(row, null));
    }

    // POST /api/owner/payment-requests/{id}/archive | /restore : tidies reviewed requests away (nothing is deleted)
    [HttpPost("{id:int}/archive")]
    public Task<IActionResult> Archive(int id) => SetArchived(id, true);

    [HttpPost("{id:int}/restore")]
    public Task<IActionResult> Restore(int id) => SetArchived(id, false);

    private async Task<IActionResult> SetArchived(int id, bool archived)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        var status = await _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id && r.StoreId == storeId)
            .Select(r => r.Status).FirstOrDefaultAsync();
        if (status == null) return NotFound(new { message = "Payment request not found." });
        if (archived && status == "pending")
            return Conflict(new { message = "Review a pending request before archiving it." });

        DateTime? archivedAt = archived ? DateTime.UtcNow : null;
        int? archivedBy = archived ? int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!) : null;
        await _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.IsArchived, archived)
            .SetProperty(r => r.ArchivedAt, archivedAt)
            .SetProperty(r => r.ArchivedByUserId, archivedBy));
        var row = await PaymentRequests.Project(_db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id)).FirstAsync();
        return Ok(PaymentRequests.Dto(row, null));
    }
}
