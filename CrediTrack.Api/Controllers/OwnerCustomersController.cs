using System.Security.Claims;
using System.Text.RegularExpressions;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

[ApiController]
[Route("api/owner/customers")]
[Authorize(Roles = "owner")]
public class OwnerCustomersController : ControllerBase
{
    private readonly AppDb _db;
    private readonly AttemptLimiter _limiter;
    public OwnerCustomersController(AppDb db, AttemptLimiter limiter) { _db = db; _limiter = limiter; }

    private int OwnerId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // Per-owner brake on the lookups that confirm whether a customer code exists (enumeration) and on request sending.
    private IActionResult? Throttle(string what, int limit, TimeSpan window) =>
        _limiter.TryHit(what + ":" + OwnerId(), limit, window)
            ? null
            : StatusCode(429, new { message = "Too many attempts. Please wait a few minutes and try again." });

    // CustomerCode is optional and only read when ADDING: the customer's CT-CUS code (typed, or read from their QR) of an
    // existing CrediTrack account. The record is then added together with a link request the customer must accept.
    public record CustomerRequest(string? Name, string? Phone, string? CustomerCode = null);

    // The store of the signed-in owner. Always taken from the login, never from the request.
    private async Task<int?> MyStoreId()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Stores.Where(s => s.OwnerId == userId)
            .Select(s => (int?)s.Id).FirstOrDefaultAsync();
    }

    // One customer with their current balance
    private async Task<object> Dto(Customer c)
    {
        var balances = await Ledger.Balances(_db, c.StoreId);
        var photos = await Ledger.Photos(_db, new[] { c });
        var overdue = await OverdueRule.OverdueCustomerDays(_db, c.StoreId);
        return Ledger.CustomerDto(c, balances.GetValueOrDefault(c.Id), photos.GetValueOrDefault(c.Id), overdue.GetValueOrDefault(c.Id));
    }

    // Validates name and phone, and checks duplicates inside this store
    private async Task<(string Name, string? Phone, IActionResult? Error)> Check(int storeId, CustomerRequest req, int? ownId)
    {
        var name = string.Join(" ", (req.Name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (name.Length < 2)
            return (name, null, BadRequest(new { field = "name", message = "Enter the customer's full name." }));
        if (name.Length > 80 || !Validation.PlainText(name))
            return (name, null, BadRequest(new { field = "name", message = "Use a name of 80 characters or fewer, without < or > symbols." }));

        var digits = new string((req.Phone ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length == 12 && digits.StartsWith("63")) digits = "0" + digits.Substring(2);
        string? phone = null;
        if (digits.Length > 0)
        {
            if (!Regex.IsMatch(digits, @"^09\d{9}$"))
                return (name, null, BadRequest(new { field = "phone", message = "Enter a valid mobile number, like 0917 123 4567." }));
            phone = digits;
        }

        var others = _db.Customers.Where(c => c.StoreId == storeId && (ownId == null || c.Id != ownId));
        var sameName = await others.FirstOrDefaultAsync(c => c.Name.ToLower() == name.ToLower());
        if (sameName != null)
            return (name, phone, Conflict(new { field = "name", message = "A customer with this name already exists" + (sameName.IsArchived ? " (archived)" : "") + ". Add a last name or nickname to tell them apart." }));
        if (phone != null)
        {
            var samePhone = await others.FirstOrDefaultAsync(c => c.Phone == phone);
            if (samePhone != null)
                return (name, phone, Conflict(new { field = "phone", message = "This number already belongs to " + samePhone.Name + (samePhone.IsArchived ? " (archived)" : "") + "." }));
        }
        return (name, phone, null);
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        var list = await _db.Customers.Where(c => c.StoreId == storeId).OrderBy(c => c.Name).ToListAsync();
        var balances = await Ledger.Balances(_db, storeId.Value);
        var photos = await Ledger.Photos(_db, list);
        var overdue = await OverdueRule.OverdueCustomerDays(_db, storeId.Value);
        return Ok(list.Select(c => Ledger.CustomerDto(c, balances.GetValueOrDefault(c.Id), photos.GetValueOrDefault(c.Id), overdue.GetValueOrDefault(c.Id))));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var storeId = await MyStoreId();
        var c = await _db.Customers.FirstOrDefaultAsync(x => x.Id == id && x.StoreId == storeId);
        return c == null ? NotFound(new { message = "Customer not found." }) : Ok(await Dto(c));
    }

    [HttpPost]
    public async Task<IActionResult> Add(CustomerRequest req)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        if (!string.IsNullOrWhiteSpace(req.CustomerCode)) return await AddWithAccount(storeId.Value, req);

        var (name, phone, error) = await Check(storeId.Value, req, null);
        if (error != null) return error;

        var customer = new Customer
        {
            StoreId = storeId.Value,
            Code = await Ledger.NextCustomerCode(_db, storeId.Value),   // never repeats a code, even after an empty record was removed
            Name = name,
            Phone = phone
        };
        _db.Customers.Add(customer);
        await _db.SaveChangesAsync();
        return Ok(await Dto(customer));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, CustomerRequest req)
    {
        var storeId = await MyStoreId();
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });

        var (name, phone, error) = await Check(storeId!.Value, req, id);
        if (error != null) return error;

        customer.Name = name;
        customer.Phone = phone;
        customer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await Dto(customer));
    }

    [HttpPost("{id:int}/archive")]
    public Task<IActionResult> Archive(int id) => SetArchived(id, true);

    [HttpPost("{id:int}/restore")]
    public Task<IActionResult> Restore(int id) => SetArchived(id, false);

    private async Task<IActionResult> SetArchived(int id, bool archived)
    {
        var storeId = await MyStoreId();
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });
        customer.IsArchived = archived;
        customer.ArchivedAt = archived ? DateTime.UtcNow : null;   // restoring clears the archive info
        customer.ArchivedByUserId = archived ? int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!) : null;
        customer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await Dto(customer));
    }

    // ---------- Search / filter / sort / pagination ----------
    // GET /api/owner/customers/query?search=ana&status=active|archived&balance=all|debt|paid
    //     &sort=name|code|balance|created|updated&dir=asc|desc&page=1&pageSize=20
    // The existing GET /api/owner/customers (whole list) is unchanged.
    public class CustomerQuery
    {
        public string? Search { get; set; }
        public string? Status { get; set; }
        public string? Balance { get; set; }
        public string? Sort { get; set; }
        public string? Dir { get; set; }
        public int? Page { get; set; }
        public int? PageSize { get; set; }
    }

    [HttpGet("query")]
    public async Task<IActionResult> Query([FromQuery] CustomerQuery q)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });

        var archived = Paging.Pick(q.Status, new[] { "active", "archived" }, "active") == "archived";
        var balanceFilter = Paging.Pick(q.Balance, new[] { "all", "debt", "paid" }, "all");
        var sort = Paging.Pick(q.Sort, new[] { "name", "code", "balance", "created", "updated" }, "name");
        var desc = Paging.Pick(q.Dir, new[] { "asc", "desc" }, "asc") == "desc";
        var (page, pageSize) = Paging.Normalize(q.Page, q.PageSize);
        var search = Paging.Search(q.Search);

        // Every customer of the store with their balance, calculated in the database
        var totals = _db.Transactions.Where(t => t.StoreId == storeId && !t.IsVoided)
            .GroupBy(t => t.CustomerId)
            .Select(g => new { CustomerId = g.Key, Total = g.Sum(t => t.Type == "credit" ? t.Amount : -t.Amount) });
        var rows = from c in _db.Customers.Where(c => c.StoreId == storeId)
                   join bal in totals on c.Id equals bal.CustomerId into joined
                   from b in joined.DefaultIfEmpty()
                   select new { Customer = c, Balance = (decimal?)b.Total ?? 0m };

        // Chip counts: Active / Archived ignore everything else; All / Debt / Paid cover the chosen status only
        var pool = rows.Where(r => r.Customer.IsArchived == archived);
        var counts = new
        {
            active = await rows.CountAsync(r => !r.Customer.IsArchived),
            archived = await rows.CountAsync(r => r.Customer.IsArchived),
            all = await pool.CountAsync(),
            debt = await pool.CountAsync(r => r.Balance > 0),
            paid = await pool.CountAsync(r => r.Balance <= 0)
        };
        var totalAll = await _db.Customers.CountAsync(c => c.StoreId == storeId);

        var matches = pool;
        if (balanceFilter == "debt") matches = matches.Where(r => r.Balance > 0);
        else if (balanceFilter == "paid") matches = matches.Where(r => r.Balance <= 0);

        if (search.Length > 0)
        {
            var like = Paging.Like(search);
            var digits = new string(search.Where(char.IsDigit).ToArray());
            if (digits.Length > 1)
                matches = matches.Where(r => EF.Functions.ILike(r.Customer.Name, like, "\\")
                    || EF.Functions.ILike(r.Customer.Code, like, "\\")
                    || (r.Customer.Phone != null && r.Customer.Phone.Contains(digits)));
            else
                matches = matches.Where(r => EF.Functions.ILike(r.Customer.Name, like, "\\")
                    || EF.Functions.ILike(r.Customer.Code, like, "\\"));
        }

        var totalCount = await matches.CountAsync();

        // Only these columns can be sorted on; the id keeps the order stable between pages
        var ordered = (sort, desc) switch
        {
            ("code", false) => matches.OrderBy(r => r.Customer.Code),
            ("code", true) => matches.OrderByDescending(r => r.Customer.Code),
            ("balance", false) => matches.OrderBy(r => r.Balance),
            ("balance", true) => matches.OrderByDescending(r => r.Balance),
            ("created", false) => matches.OrderBy(r => r.Customer.CreatedAt),
            ("created", true) => matches.OrderByDescending(r => r.Customer.CreatedAt),
            ("updated", false) => matches.OrderBy(r => r.Customer.UpdatedAt),
            ("updated", true) => matches.OrderByDescending(r => r.Customer.UpdatedAt),
            (_, true) => matches.OrderByDescending(r => r.Customer.Name),
            _ => matches.OrderBy(r => r.Customer.Name)
        };
        var pageRows = await ordered.ThenBy(r => r.Customer.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();

        var photos = await Ledger.Photos(_db, pageRows.Select(r => r.Customer));
        var overdue = await OverdueRule.OverdueCustomerDays(_db, storeId.Value);   // the Part 4A rule: same source as the Dashboard count
        var result = Paging.Result(pageRows.Select(r => Ledger.CustomerDto(r.Customer, r.Balance, photos.GetValueOrDefault(r.Customer.Id), overdue.GetValueOrDefault(r.Customer.Id))), totalCount, page, pageSize);
        result["counts"] = counts;
        result["totalAll"] = totalAll;
        return Ok(result);
    }

    // ---------- Customer account link (a customer's CT-CUS code ties a record to their login) ----------
    public record LinkRequest(string? CustomerCode);

    private static string MaskEmail(string email)
    {
        var at = email.IndexOf('@');
        return at <= 1 ? email : email[0] + new string('*', Math.Min(at - 1, 6)) + email[at..];
    }

    private static object? AccountDto(User? u) => u == null ? null : new
    {
        fullName = u.FullName,
        customerCode = u.CustomerCode,
        email = MaskEmail(u.Email),
        contactNumber = u.ContactNumber,
        memberSince = u.CreatedAt
    };

    // "ct-cus-123456", " CT-CUS-123456 " or the QR text "CREDITRACK:CUSTOMER:CT-CUS-123456" -> "CT-CUS-123456". null when it is not a customer code.
    private static string? NormalizeCustomerCode(string? raw)
    {
        var code = new string((raw ?? "").Where(ch => !char.IsWhiteSpace(ch)).ToArray()).ToUpperInvariant();
        if (code.StartsWith("CREDITRACK:CUSTOMER:")) code = code.Substring("CREDITRACK:CUSTOMER:".Length);   // read from the customer's QR
        return Regex.IsMatch(code, @"^CT-CUS-\d{6}$") ? code : null;
    }

    // GET /api/owner/customers/{id}/account : the linked customer account (email partly hidden), or null
    [HttpGet("{id:int}/account")]
    public async Task<IActionResult> Account(int id)
    {
        var storeId = await MyStoreId();
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });
        var user = customer.LinkedUserId == null ? null : await _db.Users.FindAsync(customer.LinkedUserId.Value);

        // A link request still waiting for the customer's answer (they must accept it before anything is linked)
        await Consent.ExpireStaleAsync(_db, storeId);
        var waiting = customer.LinkedUserId != null ? null : await _db.ConsentRequests.AsNoTracking()
            .Where(r => r.Kind == "link" && r.CustomerId == id && r.Status == ConsentRequest.Pending).FirstOrDefaultAsync();
        var waitingUser = waiting == null ? null : await _db.Users.FindAsync(waiting.UserId);
        return Ok(new
        {
            linked = user != null && !customer.IsDisconnected, disconnected = customer.IsDisconnected, linkedAt = customer.LinkedAt, account = AccountDto(user),
            pendingLink = waiting == null ? null : new { id = waiting.Id, createdAt = waiting.CreatedAt, expiresAt = waiting.ExpiresAt, account = AccountDto(waitingUser) }
        });
    }

    // What the code points to, and whether linking it first needs to remove an empty record.
    // Joining a store always makes a NEW record for the customer. If the owner already had a record for that person,
    // the customer ends up with two. The new one is removed when linking IF it is empty (no utang, no payments, no
    // payment requests), so nothing of value is ever deleted. A record that already has history is never touched.
    private record LinkCheck(Customer? Customer, User? Account, Customer? EmptyDuplicate, IActionResult? Error);

    private async Task<LinkCheck> CheckLink(int id, string? rawCode)
    {
        var storeId = await MyStoreId();
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.StoreId == storeId);
        if (customer == null) return new(null, null, null, NotFound(new { message = "Customer not found." }));
        if (customer.LinkedUserId != null)
            return new(customer, null, null, Conflict(new { field = "code", message = "This customer record is already linked to an account." }));

        var code = NormalizeCustomerCode(rawCode);
        if (code == null)
            return new(customer, null, null, BadRequest(new { field = "code", message = "Enter a customer code like CT-CUS-123456." }));

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Role == "customer" && u.CustomerCode == code);
        if (user == null)
            return new(customer, null, null, NotFound(new { field = "code", message = "No customer account matches that code." }));

        var already = await _db.Customers.FirstOrDefaultAsync(c => c.StoreId == customer.StoreId && c.LinkedUserId == user.Id);
        if (already == null) return new(customer, user, null, null);

        var hasHistory = await _db.Transactions.AnyAsync(t => t.CustomerId == already.Id)
            || await _db.PaymentRequests.IgnoreQueryFilters().AnyAsync(r => r.CustomerId == already.Id);
        if (hasHistory)
            return new(customer, user, null, Conflict(new { field = "code", message = "This account is already linked to " + already.Name + ", which already has records, so it cannot be moved here." }));
        return new(customer, user, already, null);
    }

    // ---------- Add Customer with a CrediTrack account (code or QR on the Add Customer page) ----------
    // The account behind a code, or why it cannot be added to this store right now.
    private record AccountLookup(User? Account, IActionResult? Error);

    private async Task<AccountLookup> FindAccountForStore(int storeId, string? rawCode)
    {
        var code = NormalizeCustomerCode(rawCode);
        if (code == null)
            return new(null, BadRequest(new { field = "code", message = "Enter a customer code like CT-CUS-123456." }));
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Role == "customer" && u.CustomerCode == code);
        if (user == null)
            return new(null, NotFound(new { field = "code", message = "No customer account matches that code." }));

        var already = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.StoreId == storeId && c.LinkedUserId == user.Id);
        if (already != null)
            return new(user, Conflict(new { field = "code", message = already.IsDisconnected
                ? user.FullName + " is already in your store as " + already.Name + " (" + already.Code + ") but left it. They can reconnect from their app."
                : user.FullName + " is already in your store as " + already.Name + " (" + already.Code + ")." }));

        await Consent.ExpireStaleAsync(_db, storeId);
        await Consent.ExpireStaleAsync(_db, userId: user.Id);
        if (await _db.ConsentRequests.AnyAsync(r => r.StoreId == storeId && r.UserId == user.Id && r.Kind == "join" && r.Status == ConsentRequest.Pending))
            return new(user, Conflict(new { field = "code", message = user.FullName + " already asked to join your store. Approve it in Customers > Join requests, where you can also attach it to an existing record." }));
        if (await _db.ConsentRequests.AnyAsync(r => r.StoreId == storeId && r.UserId == user.Id && r.Kind == "link" && r.Status == ConsentRequest.Pending))
            return new(user, Conflict(new { field = "code", message = "You already asked this account to link to a record of your store. Cancel that request first." }));
        return new(user, null);
    }

    public record AccountCodeRequest(string? CustomerCode);

    // POST /api/owner/customers/account/verify { customerCode } : which account does this code (or QR) belong to? Nothing is changed.
    [HttpPost("account/verify")]
    public async Task<IActionResult> VerifyAccountCode(AccountCodeRequest req)
    {
        if (Throttle("add-verify", 30, TimeSpan.FromMinutes(10)) is { } slow) return slow;
        var storeId = await MyStoreId();
        if (storeId == null) return BadRequest(new { message = "No store found for this account." });
        var found = await FindAccountForStore(storeId.Value, req.CustomerCode);
        if (found.Error != null) return found.Error;
        return Ok(new { account = AccountDto(found.Account) });
    }

    // POST /api/owner/customers with { name, phone, customerCode }
    // Adds the record AND asks that account to link to it, in one step. As with every link, the customer has to accept the
    // request (Customer > Stores > Requests) before the record is tied to their login: knowing a code is not enough.
    private async Task<IActionResult> AddWithAccount(int storeId, CustomerRequest req)
    {
        if (Throttle("add-by-code", 10, TimeSpan.FromHours(1)) is { } slow) return slow;
        var found = await FindAccountForStore(storeId, req.CustomerCode);
        if (found.Error != null) return found.Error;
        var user = found.Account!;

        // The account's own name is the default (the owner may have typed a nickname instead)
        var typed = string.Join(" ", (req.Name ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var wanted = typed.Length > 0 ? typed : user.FullName;
        var sameName = await _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.StoreId == storeId && c.Name.ToLower() == wanted.ToLower());
        if (sameName != null)
            return Conflict(new { field = "name", message = "You already have a record named " + sameName.Name + " (" + sameName.Code + "). If it is the same person, open it and use Link Customer Account. If not, add a last name or nickname to tell them apart." });
        var (name, phone, error) = await Check(storeId, new CustomerRequest(wanted, req.Phone), null);
        if (error != null) return error;

        if (await _db.ConsentRequests.CountAsync(r => r.UserId == user.Id && r.Status == ConsentRequest.Pending) >= Consent.MaxPendingPerAccount)
            return Conflict(new { field = "code", message = "This account has too many requests waiting. Try again later." });
        var dayAgo = DateTime.UtcNow.AddHours(-24);
        if (await _db.ConsentRequests.CountAsync(r => r.StoreId == storeId && r.Kind == "link" && r.CreatedAt > dayAgo) >= Consent.MaxNewPerStorePerDay)
            return StatusCode(429, new { message = "You have sent many link requests today. Please try again tomorrow." });

        Customer customer;
        ConsentRequest request;
        await using (var tx = await StoreLock.BeginAsync(_db, storeId))
        {
            // The lock is held now: look again, a second tap or another device may have just added this account
            if (await _db.Customers.AnyAsync(c => c.StoreId == storeId && c.LinkedUserId == user.Id)
                || await _db.ConsentRequests.AnyAsync(r => r.StoreId == storeId && r.UserId == user.Id && r.Status == ConsentRequest.Pending))
                return Conflict(new { field = "code", message = "This account is already in your store or has a request waiting." });

            var now = DateTime.UtcNow;
            customer = new Customer { StoreId = storeId, Code = await Ledger.NextCustomerCode(_db, storeId), Name = name, Phone = phone };
            _db.Customers.Add(customer);
            await _db.SaveChangesAsync();
            request = new ConsentRequest
            {
                Kind = "link", StoreId = storeId, UserId = user.Id, CustomerId = customer.Id,
                CreatedAt = now, ExpiresAt = now.Add(ConsentRequest.Lifetime)
            };
            _db.ConsentRequests.Add(request);
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException ex) when (StoreLock.IsUniqueViolation(ex))
            {
                return Conflict(new { field = "code", message = "A link request for this account is already waiting." });
            }
            await tx.CommitAsync();
        }

        var storeName = await _db.Stores.Where(s => s.Id == storeId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, user.Id, "link_request", "Link request",
            storeName + " asked to link your account to their record of you. Review it in Stores to accept or decline.",
            "link_request", request.Id);
        return Ok(new
        {
            linkRequested = true,
            customer = await Dto(customer),
            request = new { id = request.Id, createdAt = request.CreatedAt, expiresAt = request.ExpiresAt },
            account = AccountDto(user)
        });
    }

    // POST /api/owner/customers/{id}/link/verify { customerCode } : checks the code and shows the account. Nothing is changed.
    [HttpPost("{id:int}/link/verify")]
    public async Task<IActionResult> VerifyLink(int id, LinkRequest req)
    {
        if (Throttle("link-verify", 20, TimeSpan.FromMinutes(10)) is { } slow) return slow;
        var check = await CheckLink(id, req.CustomerCode);
        if (check.Error != null) return check.Error;
        return Ok(new { account = AccountDto(check.Account), willMerge = check.EmptyDuplicate != null, emptyRecordName = check.EmptyDuplicate?.Name });
    }

    // POST /api/owner/customers/{id}/link { customerCode: "CT-CUS-123456" }
    // The owner can only ASK: this makes a link request that the customer account must accept (Customer > Stores > Requests).
    // Nothing on the record changes until they do, so typing someone's code can no longer attach them to a store on its own.
    [HttpPost("{id:int}/link")]
    public async Task<IActionResult> Link(int id, LinkRequest req)
    {
        if (Throttle("link", 10, TimeSpan.FromHours(1)) is { } slow) return slow;
        var check = await CheckLink(id, req.CustomerCode);
        if (check.Error != null) return check.Error;
        var customer = check.Customer!;
        var user = check.Account!;

        await Consent.ExpireStaleAsync(_db, customer.StoreId);
        await Consent.ExpireStaleAsync(_db, userId: user.Id);

        if (await _db.ConsentRequests.AnyAsync(r => r.Kind == "link" && r.CustomerId == customer.Id && r.Status == ConsentRequest.Pending))
            return Conflict(new { field = "code", message = "A link request for this record is already waiting for the customer to accept. Cancel it first to send a new one." });
        if (await _db.ConsentRequests.AnyAsync(r => r.Kind == "link" && r.StoreId == customer.StoreId && r.UserId == user.Id && r.Status == ConsentRequest.Pending))
            return Conflict(new { field = "code", message = "You already asked this account to link to another record of your store. Cancel that request first." });
        if (await _db.ConsentRequests.CountAsync(r => r.UserId == user.Id && r.Status == ConsentRequest.Pending) >= Consent.MaxPendingPerAccount)
            return Conflict(new { field = "code", message = "This account has too many requests waiting. Try again later." });
        var dayAgo = DateTime.UtcNow.AddHours(-24);
        if (await _db.ConsentRequests.CountAsync(r => r.StoreId == customer.StoreId && r.Kind == "link" && r.CreatedAt > dayAgo) >= Consent.MaxNewPerStorePerDay)
            return StatusCode(429, new { message = "You have sent many link requests today. Please try again tomorrow." });

        var now = DateTime.UtcNow;
        var request = new ConsentRequest
        {
            Kind = "link", StoreId = customer.StoreId, UserId = user.Id, CustomerId = customer.Id,
            CreatedAt = now, ExpiresAt = now.Add(ConsentRequest.Lifetime)
        };
        _db.ConsentRequests.Add(request);
        try { await _db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (StoreLock.IsUniqueViolation(ex))
        {
            return Conflict(new { field = "code", message = "A link request for this record or account is already waiting." });
        }

        var storeName = await _db.Stores.Where(s => s.Id == customer.StoreId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, user.Id, "link_request", "Link request",
            storeName + " asked to link your account to their record of you. Review it in Stores to accept or decline.",
            "link_request", request.Id);
        return Ok(new
        {
            requested = true,
            request = new { id = request.Id, createdAt = request.CreatedAt, expiresAt = request.ExpiresAt },
            account = AccountDto(user),
            customer = await Dto(customer)
        });
    }

    // POST /api/owner/customers/{id}/link/cancel : take back a link request that is still waiting
    [HttpPost("{id:int}/link/cancel")]
    public async Task<IActionResult> CancelLink(int id)
    {
        var storeId = await MyStoreId();
        var request = await _db.ConsentRequests.FirstOrDefaultAsync(r =>
            r.Kind == "link" && r.CustomerId == id && r.StoreId == storeId && r.Status == ConsentRequest.Pending);
        if (request == null) return NotFound(new { message = "There is no waiting link request for this customer." });
        Consent.Close(request, ConsentRequest.Cancelled);
        await _db.SaveChangesAsync();
        return Ok(new { cancelled = true });
    }

    // ---------- Join requests: a customer asked to join my store (found with the store code) ----------
    private static object JoinDto(ConsentRequest r, User u) => new
    {
        id = r.Id, createdAt = r.CreatedAt, expiresAt = r.ExpiresAt,
        account = AccountDto(u)
    };

    // GET /api/owner/customers/join-requests : people waiting for my yes
    [HttpGet("join-requests")]
    public async Task<IActionResult> JoinRequests()
    {
        var storeId = await MyStoreId();
        if (storeId == null) return Ok(new { requests = Array.Empty<object>(), records = Array.Empty<object>() });
        await Consent.ExpireStaleAsync(_db, storeId);
        var rows = await _db.ConsentRequests.AsNoTracking()
            .Where(r => r.Kind == "join" && r.StoreId == storeId && r.Status == ConsentRequest.Pending)
            .OrderBy(r => r.CreatedAt).Take(100)
            .Join(_db.Users, r => r.UserId, u => u.Id, (r, u) => new { r, u }).ToListAsync();

        // The store's own records an approved join can be attached to: active, not linked to any account yet and with no
        // link request waiting. (Nothing is chosen for the owner, see ApproveJoin.)
        var records = rows.Count == 0 ? new List<object>() : (await _db.Customers.AsNoTracking()
            .Where(c => c.StoreId == storeId && c.LinkedUserId == null && !c.IsArchived
                && !_db.ConsentRequests.Any(r => r.Kind == "link" && r.CustomerId == c.Id && r.Status == ConsentRequest.Pending))
            .OrderBy(c => c.Name).Take(500)
            .Select(c => new { id = c.Id, code = c.Code, name = c.Name }).ToListAsync()).Cast<object>().ToList();
        return Ok(new { requests = rows.Select(x => JoinDto(x.r, x.u)).ToList(), records });
    }

    public record ApproveJoinRequest(int? CustomerId);

    // POST /api/owner/customers/join-requests/{requestId}/approve  { customerId? }
    // Without customerId the customer becomes a NEW record of my store. With customerId the approved account is attached to
    // that EXISTING record, so the utang and payments I already wrote down for this person stay in one place.
    // The owner always picks the record: nothing is attached by matching a name or a mobile number, because both are typed
    // by the customer and unverified (anyone could type another person's name to read their credit history).
    [HttpPost("join-requests/{requestId:int}/approve")]
    public async Task<IActionResult> ApproveJoin(int requestId, [FromBody] ApproveJoinRequest? body = null)
    {
        var storeId = await MyStoreId();
        if (storeId == null) return NotFound(new { message = "Request not found." });

        Customer? record;
        User? user;
        await using (var tx = await StoreLock.BeginAsync(_db, storeId.Value))
        {
            var request = await _db.ConsentRequests.FirstOrDefaultAsync(r =>
                r.Id == requestId && r.StoreId == storeId && r.Kind == "join");
            if (request == null) return NotFound(new { message = "Request not found." });
            if (request.Status != ConsentRequest.Pending || request.ExpiresAt <= DateTime.UtcNow)
                return Conflict(new { message = "This request is no longer waiting (it was cancelled or expired)." });
            user = await _db.Users.FindAsync(request.UserId);
            if (user == null) return NotFound(new { message = "Request not found." });

            record = await _db.Customers.FirstOrDefaultAsync(c => c.StoreId == storeId && c.LinkedUserId == user.Id);

            Customer? attachTo = null;
            if (body?.CustomerId is int attachId)
            {
                if (record != null)
                    return Conflict(new { message = user.FullName + " already has a record in your store (" + record.Name + "). Approve without choosing another record." });
                attachTo = await _db.Customers.FirstOrDefaultAsync(c => c.Id == attachId && c.StoreId == storeId);
                if (attachTo == null) return NotFound(new { message = "That customer record was not found." });
                if (attachTo.IsArchived) return Conflict(new { message = attachTo.Name + " is archived. Restore the record first, or choose another one." });
                if (attachTo.LinkedUserId != null) return Conflict(new { message = attachTo.Name + " is already linked to an account." });
                if (await _db.ConsentRequests.AnyAsync(r => r.Kind == "link" && r.CustomerId == attachTo.Id && r.Status == ConsentRequest.Pending))
                    return Conflict(new { message = "A link request for " + attachTo.Name + " is waiting for the customer. Cancel it first." });
                // A link request this account had for ANOTHER record of the store is replaced by this choice
                var otherLinks = await _db.ConsentRequests.Where(r => r.Kind == "link" && r.StoreId == storeId && r.UserId == user.Id && r.Status == ConsentRequest.Pending).ToListAsync();
                foreach (var l in otherLinks) Consent.Close(l, ConsentRequest.Cancelled);
            }

            if (record == null)
            {
                // A brand-new record (or the one the owner chose), and the unverified mobile number is not copied onto it.
                record = await Consent.AdmitAsync(_db, storeId.Value, user, attachTo);
            }
            else if (record.IsDisconnected)
            {
                record.IsDisconnected = false;
                record.UpdatedAt = DateTime.UtcNow;
            }
            Consent.Close(request, ConsentRequest.Accepted);
            await _db.SaveChangesAsync();
            await tx.CommitAsync();
        }

        var storeName = await _db.Stores.Where(s => s.Id == storeId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, user!.Id, "join_approved", "Join approved",
            storeName + " approved your request. You can now see your credits and payments there.", "history", record!.Id);
        return Ok(new { approved = true, customer = await Dto(record) });
    }

    // POST /api/owner/customers/join-requests/{requestId}/decline
    [HttpPost("join-requests/{requestId:int}/decline")]
    public async Task<IActionResult> DeclineJoin(int requestId)
    {
        var storeId = await MyStoreId();
        var request = await _db.ConsentRequests.FirstOrDefaultAsync(r =>
            r.Id == requestId && r.StoreId == storeId && r.Kind == "join");
        if (request == null) return NotFound(new { message = "Request not found." });
        if (request.Status != ConsentRequest.Pending)
            return Conflict(new { message = "This request is no longer waiting." });
        Consent.Close(request, ConsentRequest.Declined);
        await _db.SaveChangesAsync();
        var storeName = await _db.Stores.Where(s => s.Id == storeId).Select(s => s.Name).FirstAsync();
        await Notifier.Add(_db, request.UserId, "join_declined", "Join request declined",
            storeName + " did not accept your request to join.");
        return Ok(new { declined = true });
    }

    // POST /api/owner/customers/{id}/unlink : the record and its history stay, only the link is removed
    [HttpPost("{id:int}/unlink")]
    public async Task<IActionResult> Unlink(int id)
    {
        var storeId = await MyStoreId();
        var customer = await _db.Customers.FirstOrDefaultAsync(c => c.Id == id && c.StoreId == storeId);
        if (customer == null) return NotFound(new { message = "Customer not found." });
        if (customer.LinkedUserId == null)
            return Conflict(new { message = "This customer record is not linked to an account." });
        var pending = await _db.PaymentRequests.AnyAsync(r => r.CustomerId == id && r.Status == "pending");
        if (pending)
            return Conflict(new { message = "Review this customer's pending payment requests before unlinking the account." });

        customer.LinkedUserId = null;
        customer.LinkedAt = null;
        customer.IsDisconnected = false;
        customer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(await Dto(customer));
    }
}
