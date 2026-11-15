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

// Everything a signed-in CUSTOMER can do. A customer only ever sees records linked to their own account.
[ApiController]
[Route("api/customer")]
[Authorize(Roles = "customer")]
public class CustomerPortalController : ControllerBase
{
    private readonly AppDb _db;
    private readonly FileStorage _files;
    private readonly AttemptLimiter _limiter;
    public CustomerPortalController(AppDb db, FileStorage files, AttemptLimiter limiter) { _db = db; _files = files; _limiter = limiter; }

    private int UserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // Per-account brake on store-code lookups (guessing codes) and on join requests (spamming owners)
    private IActionResult? Throttle(string what, int limit, TimeSpan window) =>
        _limiter.TryHit(what + ":" + UserId(), limit, window)
            ? null
            : StatusCode(429, new { message = "Too many attempts. Please wait a few minutes and try again." });

    // ---------- Connected stores ----------
    public record StoreCodeRequest(string? StoreCode);

    public class StoreDto
    {
        public int CustomerId { get; set; }
        public int StoreId { get; set; }
        public string StoreName { get; set; } = "";
        public string StoreCode { get; set; } = "";
        public string? BusinessType { get; set; }
        public string? Address { get; set; }
        public string OwnerName { get; set; } = "";
        public string OwnerPhoto { get; set; } = "";     // the store owner's picture (only while I am connected to the store)
        public string RecordCode { get; set; } = "";
        public bool Connected { get; set; }
        public DateTime JoinedAt { get; set; }
        public decimal TotalCredit { get; set; }
        public decimal TotalPaid { get; set; }
        public decimal Balance { get; set; }
        public string PaymentStatus { get; set; } = "";
        public int PendingCount { get; set; }
        public decimal PendingAmount { get; set; }
        public DateTime? LastActivity { get; set; }
        public int TransactionCount { get; set; }
        public DateTime? DisconnectedAt { get; set; }   // when I left (the time of the last change to a left record)
    }

    // One of my store records with its own balance (a store's balance is never mixed with another's)
    private async Task<List<StoreDto>> StoreDtos(List<Customer> records)
    {
        var ids = records.Select(r => r.Id).ToList();
        var sums = await _db.Transactions.Where(t => ids.Contains(t.CustomerId) && !t.IsVoided)
            .GroupBy(t => new { t.CustomerId, t.Type })
            .Select(g => new { g.Key.CustomerId, g.Key.Type, Total = g.Sum(t => t.Amount), Last = g.Max(t => t.Date), Count = g.Count() }).ToListAsync();
        var pending = await _db.PaymentRequests.Where(r => ids.Contains(r.CustomerId) && r.Status == "pending")
            .GroupBy(r => r.CustomerId)
            .Select(g => new { CustomerId = g.Key, Count = g.Count(), Total = g.Sum(r => r.Amount) }).ToListAsync();

        return records.Select(r =>
        {
            var credit = sums.Where(s => s.CustomerId == r.Id && s.Type == "credit").Sum(s => s.Total);
            var paid = sums.Where(s => s.CustomerId == r.Id && s.Type == "payment").Sum(s => s.Total);
            var last = sums.Where(s => s.CustomerId == r.Id).Select(s => (DateTime?)s.Last).Max();
            var p = pending.FirstOrDefault(x => x.CustomerId == r.Id);
            return new StoreDto
            {
                CustomerId = r.Id,                 // the id used for history filters and payment requests
                StoreId = r.StoreId,
                StoreName = r.Store.Name,
                StoreCode = r.Store.StoreCode,
                BusinessType = r.Store.BusinessType,
                Address = r.Store.Address,
                OwnerName = r.Store.Owner.FullName,
                OwnerPhoto = r.IsDisconnected ? "" : FileStorage.Url(r.Store.Owner.PhotoPath),
                RecordCode = r.Code,
                Connected = !r.IsDisconnected,
                JoinedAt = r.LinkedAt ?? r.CreatedAt,
                TotalCredit = credit,
                TotalPaid = paid,
                Balance = credit - paid,
                PaymentStatus = credit - paid > 0 ? "has_balance" : "paid",
                PendingCount = p?.Count ?? 0,
                PendingAmount = p?.Total ?? 0m,
                LastActivity = last,
                TransactionCount = sums.Where(s => s.CustomerId == r.Id).Sum(s => s.Count),
                DisconnectedAt = r.IsDisconnected ? r.UpdatedAt : null
            };
        }).ToList();
    }

    private Task<List<Customer>> MyRecords() =>
        _db.Customers.Include(c => c.Store).ThenInclude(s => s.Owner)
            .Where(c => c.LinkedUserId == UserId()).OrderBy(c => c.Store.Name).ToListAsync();

    // GET /api/customer/stores : joined stores (connected first) with their own balances
    [HttpGet("stores")]
    public async Task<IActionResult> Stores()
    {
        var records = await MyRecords();
        var dtos = await StoreDtos(records);
        return Ok(new { stores = dtos, connectedCount = records.Count(r => !r.IsDisconnected) });
    }

    // GET /api/customer/home : outstanding balance, my stores and the latest activity
    [HttpGet("home")]
    public async Task<IActionResult> Home()
    {
        var records = await MyRecords();
        var dtos = await StoreDtos(records);
        var connected = records.Where(r => !r.IsDisconnected).Select(r => r.Id).ToList();

        var recent = await _db.Transactions.Include(t => t.Items).Include(t => t.Customer).ThenInclude(c => c.Store)
            .Where(t => connected.Contains(t.CustomerId))
            .OrderByDescending(t => t.Date).ThenByDescending(t => t.Id).Take(5).ToListAsync();
        var uid = UserId();

        // Credits due soon or already overdue, from the same OverdueRule the store owner's pages use
        var mine = await _db.Transactions.AsNoTracking().Where(t => connected.Contains(t.CustomerId)).ToListAsync();
        var reminders = DueReminders.Build(mine, OverdueRule.Today());
        var storeNames = records.ToDictionary(r => r.Id, r => r.Store.Name);

        return Ok(new
        {
            hasStores = connected.Count > 0,
            dueReminderCount = reminders.Count,
            dueReminders = reminders.Take(5).Select(r => new
            {
                transactionId = r.TransactionId, code = Ledger.Code(r.Number), customerId = r.CustomerId,
                storeName = storeNames.GetValueOrDefault(r.CustomerId, ""),
                dueDate = r.DueDate.ToString("yyyy-MM-dd"), outstanding = r.Outstanding, status = r.Status, days = r.Days
            }).ToList(),
            outstandingBalance = dtos.Where(d => d.Connected).Sum(d => d.Balance),
            stores = dtos,
            recentActivity = await ActivityRows(recent),
            pendingRequests = await _db.PaymentRequests.CountAsync(r => r.UserId == uid && r.Status == "pending")
        });
    }

    // POST /api/customer/stores/lookup { storeCode } : "is this the right store?" before joining
    [HttpPost("stores/lookup")]
    public async Task<IActionResult> Lookup(StoreCodeRequest req)
    {
        if (Throttle("store-lookup", 30, TimeSpan.FromMinutes(10)) is { } slow) return slow;
        var store = await FindStore(req.StoreCode);
        if (store == null) return NotFound(new { field = "storeCode", message = "No store matches that code. Check it and try again." });
        var mine = await _db.Customers.FirstOrDefaultAsync(c => c.StoreId == store.Id && c.LinkedUserId == UserId());
        await Consent.ExpireStaleAsync(_db, store.Id, UserId());
        var uid = UserId();
        var waiting = await _db.ConsentRequests.AnyAsync(r => r.StoreId == store.Id && r.UserId == uid
            && r.Kind == "join" && r.Status == ConsentRequest.Pending);
        return Ok(new
        {
            storeName = store.Name, storeCode = store.StoreCode, businessType = store.BusinessType,
            address = store.Address, ownerName = store.Owner.FullName,
            alreadyJoined = mine != null && !mine.IsDisconnected,
            wasConnected = mine != null && mine.IsDisconnected,
            requestPending = waiting
        });
    }

    private Task<Store?> FindStore(string? input)
    {
        var code = Validation.StoreCode(input);
        return _db.Stores.Include(s => s.Owner).FirstOrDefaultAsync(s => s.StoreCode == code);
    }

    // POST /api/customer/stores/join { storeCode }
    // Reconnects a store I left, or creates a NEW customer record for me. Credits and payments are never changed by joining.
    // SECURITY: a mobile number is typed in by the customer and is NOT verified, so it is never used to attach me to an
    // existing store record (anyone could type someone else's number and read their credit history). The only way to link
    // an existing record is the store owner entering my CT-CUS code (POST /api/owner/customers/{id}/link).
    [HttpPost("stores/join")]
    public async Task<IActionResult> Join(StoreCodeRequest req)
    {
        var store = await FindStore(req.StoreCode);
        if (store == null) return NotFound(new { field = "storeCode", message = "No store matches that code. Check it and try again." });

        var uid = UserId();
        var user = await _db.Users.FindAsync(uid);
        if (user == null) return Unauthorized();

        var mine = await _db.Customers.FirstOrDefaultAsync(c => c.StoreId == store.Id && c.LinkedUserId == uid);
        if (mine != null)
        {
            if (!mine.IsDisconnected) return Conflict(new { field = "storeCode", message = "You have already joined this store." });
            mine.IsDisconnected = false;
            mine.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            await Notifier.Add(_db, store.OwnerId, "customer_joined", "Customer Reconnected",
                user.FullName + " reconnected to your store on CrediTrack.", "customer", mine.Id);
            return Ok(new { joined = "reconnected", store = (await StoreDtos(await MyRecords())).First(d => d.CustomerId == mine.Id) });
        }

        // A brand-new join is only a REQUEST: the store owner has to approve it before a record is made for me
        // (OwnerCustomersController.ApproveJoin). Otherwise anyone with a store code could put themselves in any store's
        // customer list and notification feed. Leaving and coming back to a record I already had stays instant (above).
        if (Throttle("store-join", 10, TimeSpan.FromHours(1)) is { } slow) return slow;
        await Consent.ExpireStaleAsync(_db, store.Id, uid);

        if (await _db.ConsentRequests.AnyAsync(r => r.StoreId == store.Id && r.UserId == uid && r.Kind == "link" && r.Status == ConsentRequest.Pending))
            return Conflict(new { field = "storeCode", message = "This store already asked to link your account. Open Stores > Requests and accept it." });
        if (await _db.ConsentRequests.AnyAsync(r => r.StoreId == store.Id && r.UserId == uid && r.Kind == "join" && r.Status == ConsentRequest.Pending))
            return Conflict(new { field = "storeCode", message = "You already asked to join this store. Wait for the owner to approve it." });
        // The owner turned Auto-approve on (Store QR Code & Store Code): the code alone lets me in, as a NEW record.
        // It leaves a join request marked "accepted" behind, so there is a trail and the daily limit below can be counted.
        // Past the daily limit the join waits for the owner's Approve like any other (so a leaked code cannot flood a store).
        if (store.AutoApproveJoins)
        {
            var dayAgo = DateTime.UtcNow.AddHours(-24);
            var autoToday = await _db.ConsentRequests.CountAsync(r => r.StoreId == store.Id && r.Kind == "join"
                && r.Status == ConsentRequest.Accepted && r.DecidedAt > dayAgo);
            if (autoToday < Consent.MaxAutoApprovedPerStorePerDay)
            {
                Customer record;
                await using (var tx = await StoreLock.BeginAsync(_db, store.Id))
                {
                    // The lock is held now: look again, a second tap may have just joined me
                    if (await _db.Customers.AnyAsync(c => c.StoreId == store.Id && c.LinkedUserId == uid))
                        return Conflict(new { field = "storeCode", message = "You have already joined this store." });
                    record = await Consent.AdmitAsync(_db, store.Id, user, null);
                    var now0 = DateTime.UtcNow;
                    _db.ConsentRequests.Add(new ConsentRequest
                    {
                        Kind = "join", StoreId = store.Id, UserId = uid, Status = ConsentRequest.Accepted,
                        CreatedAt = now0, ExpiresAt = now0.Add(ConsentRequest.Lifetime), DecidedAt = now0
                    });
                    await _db.SaveChangesAsync();
                    await tx.CommitAsync();
                }
                await Notifier.Add(_db, store.OwnerId, "customer_joined", "New Customer Joined",
                    user.FullName + " joined your store on CrediTrack.", "customer", record.Id);
                return Ok(new { joined = "joined", store = (await StoreDtos(await MyRecords())).First(d => d.CustomerId == record.Id) });
            }
        }

        if (await _db.ConsentRequests.CountAsync(r => r.UserId == uid && r.Kind == "join" && r.Status == ConsentRequest.Pending) >= 10)
            return Conflict(new { field = "storeCode", message = "You have many join requests waiting. Cancel one or wait for an answer first." });
        if (await _db.ConsentRequests.CountAsync(r => r.StoreId == store.Id && r.Kind == "join" && r.Status == ConsentRequest.Pending) >= Consent.MaxPendingJoinsPerStore)
            return Conflict(new { field = "storeCode", message = "This store has too many requests waiting right now. Try again later." });

        var now = DateTime.UtcNow;
        var request = new ConsentRequest
        {
            Kind = "join", StoreId = store.Id, UserId = uid, CreatedAt = now, ExpiresAt = now.Add(ConsentRequest.Lifetime)
        };
        _db.ConsentRequests.Add(request);
        try { await _db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (StoreLock.IsUniqueViolation(ex))
        {
            return Conflict(new { field = "storeCode", message = "You already asked to join this store. Wait for the owner to approve it." });
        }
        await Notifier.Add(_db, store.OwnerId, "join_request", "Join request",
            user.FullName + " asked to join your store. Approve or decline it in Customers.", "join_request", request.Id);

        return Ok(new { joined = "requested", request = RequestDto(request, store) });
    }

    // ---------- Requests (consent) ----------
    private static object RequestDto(ConsentRequest r, Store s) => new
    {
        id = r.Id, kind = r.Kind, createdAt = r.CreatedAt, expiresAt = r.ExpiresAt,
        storeId = s.Id, storeName = s.Name, storeCode = s.StoreCode, businessType = s.BusinessType, address = s.Address,
        ownerName = s.Owner?.FullName ?? ""
    };

    // GET /api/customer/requests : link requests waiting for MY answer, and the join requests I sent that are still waiting
    [HttpGet("requests")]
    public async Task<IActionResult> Requests()
    {
        var uid = UserId();
        await Consent.ExpireStaleAsync(_db, userId: uid);
        var rows = await _db.ConsentRequests.AsNoTracking().Include(r => r.Store).ThenInclude(s => s.Owner)
            .Where(r => r.UserId == uid && r.Status == ConsentRequest.Pending)
            .OrderByDescending(r => r.CreatedAt).ToListAsync();

        var recordIds = rows.Where(r => r.CustomerId != null).Select(r => r.CustomerId!.Value).ToList();
        var records = await _db.Customers.AsNoTracking().Where(c => recordIds.Contains(c.Id)).ToListAsync();
        var sums = await _db.Transactions.AsNoTracking().Where(t => recordIds.Contains(t.CustomerId) && !t.IsVoided)
            .GroupBy(t => new { t.CustomerId, t.Type })
            .Select(g => new { g.Key.CustomerId, g.Key.Type, Total = g.Sum(t => t.Amount), Count = g.Count() }).ToListAsync();

        var list = rows.Select(r =>
        {
            var rec = records.FirstOrDefault(c => c.Id == r.CustomerId);
            object? record = null;
            if (rec != null)
            {
                var credit = sums.Where(x => x.CustomerId == rec.Id && x.Type == "credit").Sum(x => x.Total);
                var paid = sums.Where(x => x.CustomerId == rec.Id && x.Type == "payment").Sum(x => x.Total);
                record = new
                {
                    name = rec.Name, code = rec.Code, balance = credit - paid,
                    creditCount = sums.Where(x => x.CustomerId == rec.Id && x.Type == "credit").Sum(x => x.Count)
                };
            }
            return new { request = RequestDto(r, r.Store), record };
        }).Select(x => new { x.request, x.record }).ToList();
        return Ok(new { requests = list });
    }

    // POST /api/customer/requests/{id}/accept : a store asked to link me to its record. Only now is it linked.
    [HttpPost("requests/{requestId:int}/accept")]
    public async Task<IActionResult> AcceptLink(int requestId)
    {
        var uid = UserId();
        var pre = await _db.ConsentRequests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == requestId && r.UserId == uid && r.Kind == "link");
        if (pre == null) return NotFound(new { message = "Request not found." });

        Customer? record;
        Store? store;
        await using (var tx = await StoreLock.BeginAsync(_db, pre.StoreId))
        {
            var request = await _db.ConsentRequests.FirstAsync(r => r.Id == requestId);
            if (request.Status != ConsentRequest.Pending || request.ExpiresAt <= DateTime.UtcNow)
                return Conflict(new { message = "This request is no longer waiting (it was cancelled or expired)." });

            record = request.CustomerId == null ? null : await _db.Customers.FirstOrDefaultAsync(c => c.Id == request.CustomerId && c.StoreId == request.StoreId);
            if (record == null || record.LinkedUserId != null)
            {
                Consent.Close(request, ConsentRequest.Cancelled);
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
                return Conflict(new { message = "That record is no longer available to link." });
            }

            // Joining used to make an empty record for me; if I still have one, it goes away (a record with history never does)
            var already = await _db.Customers.FirstOrDefaultAsync(c => c.StoreId == request.StoreId && c.LinkedUserId == uid);
            if (already != null)
            {
                if (await Consent.HasHistoryAsync(_db, already.Id))
                    return Conflict(new { message = "You are already linked to " + already.Name + " in this store, which has records, so this one cannot be linked." });
                _db.Customers.Remove(already);
            }

            record.LinkedUserId = uid;
            record.LinkedAt = DateTime.UtcNow;
            record.IsDisconnected = false;
            record.UpdatedAt = DateTime.UtcNow;
            Consent.Close(request, ConsentRequest.Accepted);

            // A join request I had pending for the same store is answered by this link
            var joins = await _db.ConsentRequests.Where(r => r.Kind == "join" && r.StoreId == request.StoreId && r.UserId == uid && r.Status == ConsentRequest.Pending).ToListAsync();
            foreach (var j in joins) Consent.Close(j, ConsentRequest.Cancelled);

            await _db.SaveChangesAsync();
            await tx.CommitAsync();
            store = await _db.Stores.Include(x => x.Owner).FirstAsync(x => x.Id == request.StoreId);
        }

        var me = await _db.Users.FindAsync(uid);
        await Notifier.Add(_db, store!.OwnerId, "link_accepted", "Link accepted",
            (me?.FullName ?? "The customer") + " accepted the link to " + record!.Name + ".", "customer", record.Id);
        var dto = (await StoreDtos(await MyRecords())).FirstOrDefault(d => d.CustomerId == record.Id);
        return Ok(new { accepted = true, store = dto });
    }

    // POST /api/customer/requests/{id}/decline : I do not want this link
    [HttpPost("requests/{requestId:int}/decline")]
    public async Task<IActionResult> DeclineLink(int requestId)
    {
        var uid = UserId();
        var request = await _db.ConsentRequests.Include(r => r.Store)
            .FirstOrDefaultAsync(r => r.Id == requestId && r.UserId == uid && r.Kind == "link");
        if (request == null) return NotFound(new { message = "Request not found." });
        if (request.Status != ConsentRequest.Pending) return Conflict(new { message = "This request is no longer waiting." });
        Consent.Close(request, ConsentRequest.Declined);
        await _db.SaveChangesAsync();
        var me = await _db.Users.FindAsync(uid);
        await Notifier.Add(_db, request.Store.OwnerId, "link_declined", "Link declined",
            (me?.FullName ?? "The customer") + " declined the link request.", "customer", request.CustomerId);
        return Ok(new { declined = true });
    }

    // POST /api/customer/requests/{id}/cancel : take back a join request I sent
    [HttpPost("requests/{requestId:int}/cancel")]
    public async Task<IActionResult> CancelJoin(int requestId)
    {
        var uid = UserId();
        var request = await _db.ConsentRequests.FirstOrDefaultAsync(r => r.Id == requestId && r.UserId == uid && r.Kind == "join");
        if (request == null) return NotFound(new { message = "Request not found." });
        if (request.Status != ConsentRequest.Pending) return Conflict(new { message = "This request is no longer waiting." });
        Consent.Close(request, ConsentRequest.Cancelled);
        await _db.SaveChangesAsync();
        return Ok(new { cancelled = true });
    }

    // POST /api/customer/stores/{customerId}/leave | /reconnect : only a flag changes, no record is deleted
    [HttpPost("stores/{customerId:int}/leave")]
    public Task<IActionResult> Leave(int customerId) => SetConnection(customerId, false);

    [HttpPost("stores/{customerId:int}/reconnect")]
    public Task<IActionResult> Reconnect(int customerId) => SetConnection(customerId, true);

    private async Task<IActionResult> SetConnection(int customerId, bool connect)
    {
        var uid = UserId();
        var record = await _db.Customers.FirstOrDefaultAsync(c => c.Id == customerId && c.LinkedUserId == uid);
        if (record == null) return NotFound(new { message = "Store not found." });
        record.IsDisconnected = !connect;
        record.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var stores = await StoreDtos(await MyRecords());
        return Ok(stores.First(d => d.CustomerId == customerId));
    }

    // ---------- History ----------
    private async Task<List<Dictionary<string, object?>>> ActivityRows(List<Transaction> txs)
    {
        var states = new Dictionary<int, CreditState>();
        foreach (var storeId in txs.Select(t => t.StoreId).Distinct())
            foreach (var kv in await Ledger.CreditStates(_db, storeId)) states[kv.Key] = kv.Value;

        return txs.Select(t =>
        {
            var row = Ledger.BuildRow(t, t.Customer, states.GetValueOrDefault(t.Id), forCustomer: true);
            row["storeId"] = t.StoreId;
            row["storeName"] = t.Customer.Store.Name;
            row["storeCode"] = t.Customer.Store.StoreCode;
            row["connected"] = !t.Customer.IsDisconnected;
            return row;
        }).ToList();
    }

    public class HistoryQuery
    {
        public string? Search { get; set; }
        public string? Type { get; set; }
        public int? CustomerId { get; set; }
        public string? DateRange { get; set; }
        public string? From { get; set; }
        public string? To { get; set; }
        public string? Sort { get; set; }
        public string? Dir { get; set; }
        public int? Page { get; set; }
        public int? PageSize { get; set; }
    }

    // GET /api/customer/history?type=all|credit|payment&customerId=&search=&dateRange=&from=&to=&sort=date|amount&dir=&page=&pageSize=
    // customerId = one of my stores (the id returned by /stores). counts cover every type; search matches the store name, items and TRX code.
    [HttpGet("history")]
    public async Task<IActionResult> History([FromQuery] HistoryQuery q)
    {
        var uid = UserId();
        var type = Paging.Pick(q.Type, new[] { "all", "credit", "payment" }, "all");
        var sort = Paging.Pick(q.Sort, new[] { "date", "amount" }, "date");
        var asc = Paging.Pick(q.Dir, new[] { "asc", "desc" }, "desc") == "asc";
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);
        var search = Paging.Search(q.Search);
        var window = Paging.Window(q.DateRange, q.From, q.To);

        if (window.Invalid)
        {
            var none = Paging.Result(new List<object>(), 0, page, pageSize);
            none["counts"] = new { all = 0, credit = 0, payment = 0 }; none["invalidRange"] = true;
            return Ok(none);
        }

        var tx = _db.Transactions.Where(t => t.Customer.LinkedUserId == uid);
        if (q.CustomerId != null) tx = tx.Where(t => t.CustomerId == q.CustomerId);
        if (window.FromUtc is DateTime from) tx = tx.Where(t => t.Date >= from);
        if (window.ToExclusiveUtc is DateTime to) tx = tx.Where(t => t.Date < to);
        if (search.Length > 0)
        {
            var like = Paging.Like(search);
            var code = Regex.Match(search, @"^trx-?(\d+)$", RegexOptions.IgnoreCase);
            if (code.Success && int.TryParse(code.Groups[1].Value, out var number))
                tx = tx.Where(t => t.Number == number);
            else
                tx = tx.Where(t => EF.Functions.ILike(t.Customer.Store.Name, like, "\\")
                    || (t.Note != null && EF.Functions.ILike(t.Note, like, "\\"))
                    || t.Items.Any(i => EF.Functions.ILike(i.Name, like, "\\")));
        }

        var byType = await tx.GroupBy(t => t.Type).Select(g => new { Type = g.Key, Count = g.Count() }).ToListAsync();
        var credits = byType.FirstOrDefault(x => x.Type == "credit")?.Count ?? 0;
        var payments = byType.FirstOrDefault(x => x.Type == "payment")?.Count ?? 0;

        if (type != "all") tx = tx.Where(t => t.Type == type);
        var totalCount = type == "credit" ? credits : type == "payment" ? payments : credits + payments;

        var withData = tx.Include(t => t.Items).Include(t => t.Customer).ThenInclude(c => c.Store);
        var ordered = (sort, asc) switch
        {
            ("amount", true) => withData.OrderBy(t => t.Amount),
            ("amount", false) => withData.OrderByDescending(t => t.Amount),
            (_, true) => withData.OrderBy(t => t.Date),
            _ => withData.OrderByDescending(t => t.Date)
        };
        var rows = await (asc ? ordered.ThenBy(t => t.Id) : ordered.ThenByDescending(t => t.Id))
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        var result = Paging.Result(await ActivityRows(rows), totalCount, page, pageSize);
        result["counts"] = new { all = credits + payments, credit = credits, payment = payments };
        result["invalidRange"] = false;
        return Ok(result);
    }

    // GET /api/customer/transactions/{id} : items (credit) or payment details, only for my own records
    [HttpGet("transactions/{id:int}")]
    public async Task<IActionResult> Transaction(int id)
    {
        var uid = UserId();
        var tx = await _db.Transactions.Include(t => t.Items).Include(t => t.Customer).ThenInclude(c => c.Store)
            .FirstOrDefaultAsync(t => t.Id == id && t.Customer.LinkedUserId == uid);
        if (tx == null) return NotFound(new { message = "Transaction not found." });
        return Ok((await ActivityRows(new List<Transaction> { tx }))[0]);
    }

    // ---------- Payment requests ----------
    public record PaymentRequestRequest(int CustomerId, decimal Amount, string? Method, string? Reference, string? Message, string? Proof, int? TransactionId = null);

    private static bool ProofOk(string proof)
    {
        const string jpeg = "data:image/jpeg;base64,", png = "data:image/png;base64,";
        var prefix = proof.StartsWith(jpeg) ? jpeg : proof.StartsWith(png) ? png : null;
        if (prefix == null || proof.Length > 7_000_000) return false;   // about 5 MB of picture
        var buffer = new byte[(proof.Length - prefix.Length) / 4 * 3 + 3];
        return Convert.TryFromBase64String(proof[prefix.Length..], buffer, out _);
    }

    private Task<string> SaveProof(string proof) => _files.SaveDataUrlAsync(FileStorage.ProofsFolder, proof);

    // POST /api/customer/payment-requests
    //   { customerId (from /stores), transactionId? (credit transaction), amount, method, reference, message, proof }
    // The request is saved as pending and the balance does NOT change until the store owner approves it.
    [HttpPost("payment-requests")]
    public async Task<IActionResult> Submit(PaymentRequestRequest req)
    {
        var uid = UserId();
        var record = await _db.Customers.FirstOrDefaultAsync(c => c.Id == req.CustomerId && c.LinkedUserId == uid);
        if (record == null) return NotFound(new { field = "store", message = "Choose one of your stores." });
        if (record.IsDisconnected)
            return BadRequest(new { field = "store", message = "You left this store. Reconnect it to send a payment." });

        // One writer at a time per store (the same lock the owner's Record Bayad / Approve use). Everything below reads the balance
        // and the requests still pending and then adds a new one, so without the lock two taps (a double click, two tabs) could both
        // pass "pending + this amount is within the balance" and leave two pending requests that together are more than is owed.
        // Every early return below rolls the transaction back (the lock is released); only the final commit keeps the new request.
        await using var tx = await StoreLock.BeginAsync(_db, record.StoreId);

        var balance = await Ledger.BalanceOf(_db, record.Id);
        if (balance <= 0)
            return BadRequest(new { field = "amount", message = "You have no outstanding balance in this store." });

        var amount = req.Amount;
        if (amount <= 0 || amount != decimal.Round(amount, 2))
            return BadRequest(new { field = "amount", message = "Enter an amount greater than ₱0.00 with no more than two decimal places." });

        var outstanding = balance;
        if (req.TransactionId is int transactionId)
        {
            var credit = await _db.Transactions.FirstOrDefaultAsync(t => t.Id == transactionId
                && t.CustomerId == record.Id && t.StoreId == record.StoreId && t.Type == "credit");
            if (credit == null || credit.IsVoided)
                return BadRequest(new { field = "amount", message = "This credit transaction is no longer available for payment." });

            var states = await Ledger.CreditStates(_db, record.StoreId);
            outstanding = states.GetValueOrDefault(credit.Id)?.Remaining ?? 0m;
            if (outstanding <= 0)
                return BadRequest(new { field = "amount", message = "This credit transaction has no outstanding balance." });
        }

        if (!PaymentRequests.IsValidAmount(amount, outstanding))
            return BadRequest(new { field = "amount", message = "The payment cannot be more than the outstanding balance of ₱"
                + outstanding.ToString("N2", CultureInfo.InvariantCulture) + "." });
        if (amount > balance)
            return BadRequest(new { field = "amount", message = "The payment cannot be more than your balance of ₱" + balance.ToString("N2", CultureInfo.InvariantCulture) + "." });

        var method = req.Method ?? "";
        if (!PaymentRequests.Methods.Contains(method))
            return BadRequest(new { field = "method", message = "Choose how you paid." });

        var reference = string.Join(" ", (req.Reference ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (reference.Length > 40)
            return BadRequest(new { field = "reference", message = "Use a reference number of 40 characters or fewer." });
        if (PaymentRequests.ReferenceRequired.Contains(method) && reference.Length < 3)
            return BadRequest(new { field = "reference", message = "Enter the reference number of your " + method + " payment." });
        if (method == "Cash") reference = "";   // cash has no reference number

        var message = (req.Message ?? "").Trim();
        if (message.Length > 200)
            return BadRequest(new { field = "message", message = "Use a message of 200 characters or fewer." });
        if (string.IsNullOrEmpty(req.Proof) && PaymentRequests.ProofRequired.Contains(method))
            return BadRequest(new { field = "proof", message = "Attach a picture of your " + method + " receipt." });
        if (!string.IsNullOrEmpty(req.Proof) && !ProofOk(req.Proof))
            return BadRequest(new { field = "proof", message = "Upload a JPG or PNG picture up to 5 MB." });

        var pendingTotal = await _db.PaymentRequests.Where(r => r.CustomerId == record.Id && r.Status == "pending")
            .SumAsync(r => (decimal?)r.Amount) ?? 0m;
        if (pendingTotal + amount > balance)
            return Conflict(new { field = "amount", message = "You already have pending requests covering ₱" + pendingTotal.ToString("N2", CultureInfo.InvariantCulture) + " of your balance. Wait for the store to review them." });
        if (reference.Length > 0)
        {
            var refLower = reference.ToLower();
            var duplicate = await _db.PaymentRequests.AnyAsync(r => r.CustomerId == record.Id && r.Method == method
                && r.Status != "rejected" && r.Reference != null && r.Reference.ToLower() == refLower);
            if (duplicate)
                return Conflict(new { field = "reference", message = "You already sent a payment request with this reference number." });
        }

        // The picture is saved as a file; only its path goes in the database
        string? proofPath = null;
        if (!string.IsNullOrEmpty(req.Proof))
        {
            try { proofPath = await SaveProof(req.Proof); }
            catch (ArgumentException) { return BadRequest(new { field = "proof", message = "Upload a JPG or PNG picture up to 5 MB." }); }
        }

        var request = new PaymentRequest
        {
            StoreId = record.StoreId,
            CustomerId = record.Id,
            UserId = uid,
            Amount = amount,
            Method = method,
            Reference = reference.Length > 0 ? reference : null,
            Message = message.Length > 0 ? message : null,
            ProofPath = proofPath
        };
        _db.PaymentRequests.Add(request);
        try { await _db.SaveChangesAsync(); await tx.CommitAsync(); }
        catch { _files.Delete(request.ProofPath); throw; }   // do not leave a picture behind for a request that was not saved

        // Tell the store owner there is a payment to review
        var ownerId = await _db.Stores.Where(s => s.Id == record.StoreId).Select(s => s.OwnerId).FirstAsync();
        await Notifier.Add(_db, ownerId, "payment_request", "New Payment Request",
            record.Name + " submitted a " + method + " payment request of " + Notifier.Peso(amount) + ".", "request", request.Id);

        var row = await PaymentRequests.Project(_db.PaymentRequests.Where(r => r.Id == request.Id)).FirstAsync();
        return Ok(PaymentRequests.Dto(row, null));
    }

    public class MyRequestQuery
    {
        public string? Status { get; set; }
        public int? CustomerId { get; set; }
        public string? Method { get; set; }
        public string? Sort { get; set; }
        public string? Dir { get; set; }
        public int? Page { get; set; }
        public int? PageSize { get; set; }
    }

    // GET /api/customer/payment-requests?status=all|pending|completed|rejected&customerId=&method=&sort=date|amount&dir=&page=&pageSize=
    // counts follow the store filter; summary = pending count and amount, and what was recorded in the last 30 days
    [HttpGet("payment-requests")]
    public async Task<IActionResult> MyRequests([FromQuery] MyRequestQuery q)
    {
        var uid = UserId();
        var status = Paging.Pick(q.Status, new[] { "all", "pending", "completed", "rejected" }, "all");
        var sort = Paging.Pick(q.Sort, new[] { "date", "amount" }, "date");
        var asc = Paging.Pick(q.Dir, new[] { "asc", "desc" }, "desc") == "asc";
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);

        var mine = _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.UserId == uid);   // the customer still sees requests the owner archived
        if (q.CustomerId != null) mine = mine.Where(r => r.CustomerId == q.CustomerId);
        if (!string.IsNullOrWhiteSpace(q.Method)) mine = mine.Where(r => r.Method == q.Method);

        var counts = new
        {
            all = await mine.CountAsync(),
            pending = await mine.CountAsync(r => r.Status == "pending"),
            completed = await mine.CountAsync(r => r.Status == "approved"),
            rejected = await mine.CountAsync(r => r.Status == "rejected")
        };
        var since = DateTime.UtcNow.AddDays(-30);
        var summary = new
        {
            pendingCount = counts.pending,
            pendingAmount = await mine.Where(r => r.Status == "pending").SumAsync(r => (decimal?)r.Amount) ?? 0m,
            recordedLast30Days = await mine.Where(r => r.Status == "approved" && r.ReviewedAt >= since).SumAsync(r => (decimal?)r.Amount) ?? 0m
        };

        var matches = status == "pending" ? mine.Where(r => r.Status == "pending")
            : status == "completed" ? mine.Where(r => r.Status == "approved")
            : status == "rejected" ? mine.Where(r => r.Status == "rejected") : mine;
        var totalCount = status == "pending" ? counts.pending : status == "completed" ? counts.completed
            : status == "rejected" ? counts.rejected : counts.all;

        var ordered = (sort, asc) switch
        {
            ("amount", true) => matches.OrderBy(r => r.Amount),
            ("amount", false) => matches.OrderByDescending(r => r.Amount),
            (_, true) => matches.OrderBy(r => r.SubmittedAt),
            _ => matches.OrderByDescending(r => r.SubmittedAt)
        };
        var rows = await PaymentRequests.Project((asc ? ordered.ThenBy(r => r.Id) : ordered.ThenByDescending(r => r.Id))
            .Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync();

        var result = Paging.Result(rows.Select(r => PaymentRequests.Dto(r, null)), totalCount, page, pageSize);
        result["counts"] = counts;
        result["summary"] = summary;
        return Ok(result);
    }

    // GET /api/customer/payment-requests/{id} : with the proof picture (its /api/files URL)
    [HttpGet("payment-requests/{id:int}")]
    public async Task<IActionResult> MyRequest(int id)
    {
        var uid = UserId();
        var row = await PaymentRequests.Project(_db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id && r.UserId == uid)).FirstOrDefaultAsync();
        if (row == null) return NotFound(new { message = "Payment request not found." });
        var proof = await _db.PaymentRequests.IgnoreQueryFilters().Where(r => r.Id == id).Select(r => r.ProofPath).FirstOrDefaultAsync();
        TxInfo? info = null;
        if (row.TransactionId != null)
        {
            var t = await _db.Transactions.Where(x => x.Id == row.TransactionId).Select(x => new { x.IsVoided, x.Number }).FirstOrDefaultAsync();
            if (t != null) info = new TxInfo(t.IsVoided, t.Number);
        }
        return Ok(PaymentRequests.Dto(row, info, FileStorage.Url(proof)));
    }
}
