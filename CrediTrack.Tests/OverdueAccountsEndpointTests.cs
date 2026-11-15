using System.Security.Claims;
using System.Text.Json;
using CrediTrack.Api.Controllers;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace CrediTrack.Tests;

// Part 5A: GET /api/owner/overdue-accounts against a REAL PostgreSQL database (store isolation, search, filter, sort, paging).
// It needs an EMPTY database that is only for tests. The test DROPS and re-creates it, so its name must contain "test":
//   set CREDITRACK_TEST_DB="Host=localhost;Database=creditrack_test;Username=postgres;Password=..."   then   dotnet test CrediTrack.Tests
// Without that variable the test does nothing (it returns straight away), so a plain `dotnet test` still works.
public class OverdueAccountsEndpointTests
{
    private static DateTime Utc(int day) => new(2026, 10, day, 4, 0, 0, DateTimeKind.Utc);

    private static OwnerOverdueAccountsController As(AppDb db, int ownerId) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, ownerId.ToString()) }, "test"))
            }
        }
    };

    private static async Task<JsonElement> Get(AppDb db, int ownerId, OverdueAccountQuery q)
    {
        var ok = Assert.IsType<OkObjectResult>(await As(db, ownerId).Get(q));
        return JsonSerializer.SerializeToElement(ok.Value);
    }

    private static List<string> Names(JsonElement r) => r.GetProperty("items").EnumerateArray().Select(i => i.GetProperty("name").GetString()!).ToList();

    [Fact] public async Task Endpoint_with_real_database_records()
    {
        var cs = Environment.GetEnvironmentVariable("CREDITRACK_TEST_DB");
        if (string.IsNullOrWhiteSpace(cs)) return;   // not configured: nothing to run
        Assert.Contains("test", cs, StringComparison.OrdinalIgnoreCase);   // never touch a real database

        var options = new DbContextOptionsBuilder<AppDb>().UseNpgsql(cs).Options;
        await using var db = new AppDb(options);
        await db.Database.EnsureDeletedAsync();
        await db.Database.EnsureCreatedAsync();

        var today = OverdueRule.Today();
        var ownerA = new User { Email = "a@test.local", Role = "owner", FullName = "Owner A", PasswordHash = "x" };
        var ownerB = new User { Email = "b@test.local", Role = "owner", FullName = "Owner B", PasswordHash = "x" };
        var ownerC = new User { Email = "c@test.local", Role = "owner", FullName = "Owner C (no store)", PasswordHash = "x" };
        db.Users.AddRange(ownerA, ownerB, ownerC);
        await db.SaveChangesAsync();
        var storeA = new Store { OwnerId = ownerA.Id, Name = "Store A", StoreCode = "CT-AAAAAA" };
        var storeB = new Store { OwnerId = ownerB.Id, Name = "Store B", StoreCode = "CT-BBBBBB" };
        db.Stores.AddRange(storeA, storeB);
        await db.SaveChangesAsync();

        var counter = new Dictionary<int, int>();
        Customer NewCustomer(Store s, string name, int n) { var c = new Customer { StoreId = s.Id, Code = "CUS-" + n.ToString("000"), Name = name }; db.Customers.Add(c); return c; }
        void Credit(Store s, Customer c, decimal amount, int? daysOverdue, bool dueInFuture = false, bool voided = false, int day = 1)
        {
            counter[s.Id] = counter.GetValueOrDefault(s.Id) + 1;
            db.Transactions.Add(new Transaction
            {
                StoreId = s.Id, Number = counter[s.Id], CustomerId = c.Id, Type = "credit", Amount = amount, Date = Utc(day), IsVoided = voided,
                DueDate = dueInFuture ? today.AddDays(5) : daysOverdue == null ? null : today.AddDays(-daysOverdue.Value)
            });
        }
        void Payment(Store s, Customer c, decimal amount)
        {
            counter[s.Id] = counter.GetValueOrDefault(s.Id) + 1;
            db.Transactions.Add(new Transaction { StoreId = s.Id, Number = counter[s.Id], CustomerId = c.Id, Type = "payment", Amount = amount, Date = Utc(20) });
        }

        // Store A: 3 overdue customers and 4 who are not
        var ana = NewCustomer(storeA, "Ana Cruz", 1); var mariana = NewCustomer(storeA, "Mariana Lopez", 2); var zed = NewCustomer(storeA, "Zed Late", 3);
        var future = NewCustomer(storeA, "Not Yet Due", 4); var noDue = NewCustomer(storeA, "No Due Date", 5);
        var paid = NewCustomer(storeA, "Fully Paid", 6); var voided = NewCustomer(storeA, "Voided Credit", 7);
        // Store B: overdue customers with the same kind of names, which must never show up for owner A
        var anaB = NewCustomer(storeB, "Ana Belmonte", 1); var bigB = NewCustomer(storeB, "Biggest Debtor B", 2);
        await db.SaveChangesAsync();

        Credit(storeA, ana, 500, 12);
        Credit(storeA, mariana, 300, 3); Payment(storeA, mariana, 100);
        Credit(storeA, zed, 1000, 45);
        Credit(storeA, future, 400, null, dueInFuture: true);
        Credit(storeA, noDue, 600, null);
        Credit(storeA, paid, 700, 20); Payment(storeA, paid, 700);
        Credit(storeA, voided, 900, 9, voided: true);
        Credit(storeB, anaB, 250, 20);
        Credit(storeB, bigB, 99999, 100);
        await db.SaveChangesAsync();

        // Owner A sees only Store A, ordered oldest due date first
        var a = await Get(db, ownerA.Id, new OverdueAccountQuery());
        Assert.Equal(new[] { "Zed Late", "Ana Cruz", "Mariana Lopez" }, Names(a));
        Assert.Equal(3, a.GetProperty("totalCount").GetInt32());
        Assert.Equal(3, a.GetProperty("totalAll").GetInt32());
        Assert.Equal(1700m, a.GetProperty("summary").GetProperty("total").GetDecimal());   // 1000 + 500 + 200
        var m = a.GetProperty("items").EnumerateArray().First(i => i.GetProperty("name").GetString() == "Mariana Lopez");
        Assert.Equal(200m, m.GetProperty("balance").GetDecimal());
        Assert.Equal(3, m.GetProperty("daysOverdue").GetInt32());
        Assert.Equal(today.AddDays(-3).ToString("yyyy-MM-dd"), m.GetProperty("dueDate").GetString());

        // The same endpoint agrees with the Dashboard rule
        Assert.Equal((await OverdueRule.OverdueCustomerDays(db, storeA.Id)).Count, a.GetProperty("totalAll").GetInt32());

        // Isolation: searching for Store B's names finds nothing for owner A, and Store B's debtor is invisible
        Assert.Empty(Names(await Get(db, ownerA.Id, new OverdueAccountQuery { Search = "Belmonte" })));
        Assert.Empty(Names(await Get(db, ownerA.Id, new OverdueAccountQuery { Search = "Biggest" })));
        Assert.DoesNotContain("Biggest Debtor B", Names(await Get(db, ownerA.Id, new OverdueAccountQuery { SortBy = "amount-desc" })));
        var b = await Get(db, ownerB.Id, new OverdueAccountQuery { SortBy = "amount-desc" });
        Assert.Equal(new[] { "Biggest Debtor B", "Ana Belmonte" }, Names(b));

        // Search, filters, sorting and paging on real rows
        Assert.Equal(new[] { "Ana Cruz", "Mariana Lopez" }.OrderBy(x => x), Names(await Get(db, ownerA.Id, new OverdueAccountQuery { Search = "ANA" })).OrderBy(x => x));
        Assert.Equal(new[] { "Mariana Lopez" }, Names(await Get(db, ownerA.Id, new OverdueAccountQuery { OverdueRange = "1-7" })));
        Assert.Equal(new[] { "Ana Cruz" }, Names(await Get(db, ownerA.Id, new OverdueAccountQuery { OverdueRange = "8-30" })));
        Assert.Equal(new[] { "Zed Late" }, Names(await Get(db, ownerA.Id, new OverdueAccountQuery { OverdueRange = "30+" })));
        Assert.Equal(new[] { "Zed Late", "Ana Cruz", "Mariana Lopez" }, Names(await Get(db, ownerA.Id, new OverdueAccountQuery { SortBy = "amount-desc" })));
        Assert.Equal(new[] { "Zed Late", "Mariana Lopez", "Ana Cruz" }, Names(await Get(db, ownerA.Id, new OverdueAccountQuery { SortBy = "name-desc" })));
        var page2 = await Get(db, ownerA.Id, new OverdueAccountQuery { Page = 2, PageSize = 2 });
        Assert.Equal(new[] { "Mariana Lopez" }, Names(page2));
        Assert.Equal(3, page2.GetProperty("totalCount").GetInt32());
        Assert.Equal(2, page2.GetProperty("totalPages").GetInt32());

        // An owner without a store gets a clean 400, not someone else's data
        Assert.IsType<BadRequestObjectResult>(await As(db, ownerC.Id).Get(new OverdueAccountQuery()));
    }
}
