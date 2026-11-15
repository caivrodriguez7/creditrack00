using System.Security.Claims;
using CrediTrack.Api.Controllers;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace CrediTrack.Tests;

// Money races, against a REAL PostgreSQL database (same setup as OverdueAccountsEndpointTests: an EMPTY test-only
// database whose name contains "test", given in CREDITRACK_TEST_DB). Without that variable the test returns at once.
public class StoreLockTests
{
    private static OwnerTransactionsController As(AppDb db, int ownerId) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim(ClaimTypes.NameIdentifier, ownerId.ToString()), new Claim(ClaimTypes.Name, "Owner")
                }, "test"))
            }
        }
    };

    [Fact] public async Task Two_payments_at_once_cannot_overpay_and_double_clicks_save_once()
    {
        var cs = Environment.GetEnvironmentVariable("CREDITRACK_TEST_DB");
        if (string.IsNullOrWhiteSpace(cs)) return;
        Assert.Contains("test", cs, StringComparison.OrdinalIgnoreCase);
        var options = new DbContextOptionsBuilder<AppDb>().UseNpgsql(cs).Options;

        int ownerId, customerId;
        await using (var db = new AppDb(options))
        {
            await db.Database.EnsureDeletedAsync();
            await db.Database.EnsureCreatedAsync();
            var owner = new User { Email = "lock@test.local", Role = "owner", FullName = "Lock Owner", PasswordHash = "x" };
            db.Users.Add(owner);
            await db.SaveChangesAsync();
            var store = new Store { OwnerId = owner.Id, Name = "Lock Store", StoreCode = "CT-LOCKAA" };
            db.Stores.Add(store);
            await db.SaveChangesAsync();
            var customer = new Customer { StoreId = store.Id, Code = "CUS-001", Name = "Ana" };
            db.Customers.Add(customer);
            await db.SaveChangesAsync();
            db.Transactions.Add(new Transaction { StoreId = store.Id, Number = 1, CustomerId = customer.Id, Type = "credit", Amount = 100, Date = DateTime.UtcNow });
            await db.SaveChangesAsync();
            ownerId = owner.Id; customerId = customer.Id;
        }

        var today = DateTime.UtcNow.AddHours(8).ToString("yyyy-MM-dd");
        async Task<IActionResult> Pay(string requestId)
        {
            await using var db = new AppDb(options);   // one DbContext per request, like the real app
            return await As(db, ownerId).AddPayment(new OwnerTransactionsController.PaymentRequest(customerId, 100, today, "Cash", null, null, requestId));
        }

        // Two DIFFERENT payments of the full 100 at the same time: exactly one may succeed
        var results = await Task.WhenAll(Pay("r-1"), Pay("r-2"));
        Assert.Equal(1, results.Count(r => r is OkObjectResult));
        Assert.Equal(1, results.Count(r => r is BadRequestObjectResult));

        await using (var db = new AppDb(options))
        {
            var rows = await db.Transactions.ToListAsync();
            Assert.Equal(2, rows.Count);                                          // the credit + ONE payment
            Assert.Equal(rows.Count, rows.Select(t => t.Number).Distinct().Count());
            Assert.Equal(0, rows.Where(t => !t.IsVoided).Sum(t => t.Type == "credit" ? t.Amount : -t.Amount));
        }
    }

    // A customer sends the SAME full-balance payment request twice at once (double click / two tabs): only one may be saved
    [Fact] public async Task Two_payment_requests_at_once_cannot_cover_more_than_the_balance()
    {
        var cs = Environment.GetEnvironmentVariable("CREDITRACK_TEST_DB");
        if (string.IsNullOrWhiteSpace(cs)) return;
        Assert.Contains("test", cs, StringComparison.OrdinalIgnoreCase);
        var options = new DbContextOptionsBuilder<AppDb>().UseNpgsql(cs).Options;

        int userId, customerId;
        await using (var db = new AppDb(options))
        {
            await db.Database.EnsureDeletedAsync();
            await db.Database.EnsureCreatedAsync();
            var owner = new User { Email = "owner-req@test.local", Role = "owner", FullName = "Owner", PasswordHash = "x" };
            var customerUser = new User { Email = "cust-req@test.local", Role = "customer", FullName = "Ana Customer", PasswordHash = "x" };
            db.Users.AddRange(owner, customerUser);
            await db.SaveChangesAsync();
            var store = new Store { OwnerId = owner.Id, Name = "Request Store", StoreCode = "CT-REQAAA" };
            db.Stores.Add(store);
            await db.SaveChangesAsync();
            var customer = new Customer { StoreId = store.Id, Code = "CUS-001", Name = "Ana", LinkedUserId = customerUser.Id };
            db.Customers.Add(customer);
            await db.SaveChangesAsync();
            db.Transactions.Add(new Transaction { StoreId = store.Id, Number = 1, CustomerId = customer.Id, Type = "credit", Amount = 100, Date = DateTime.UtcNow });
            await db.SaveChangesAsync();
            userId = customerUser.Id; customerId = customer.Id;
        }

        async Task<IActionResult> Send()
        {
            await using var db = new AppDb(options);   // one DbContext per request, like the real app
            var controller = new CustomerPortalController(db, null!, new CrediTrack.Api.Services.AttemptLimiter())   // cash: no picture, so no file storage is touched
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                        {
                            new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Name, "Customer")
                        }, "test"))
                    }
                }
            };
            return await controller.Submit(new CustomerPortalController.PaymentRequestRequest(customerId, 100, "Cash", null, null, null));
        }

        var results = await Task.WhenAll(Send(), Send());
        Assert.Equal(1, results.Count(r => r is OkObjectResult));
        Assert.Equal(1, results.Count(r => r is ConflictObjectResult));

        await using (var db = new AppDb(options))
            Assert.Equal(1, await db.PaymentRequests.CountAsync(r => r.Status == "pending"));
    }
}
