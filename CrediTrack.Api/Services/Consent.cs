using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Services;

// Shared rules for consent requests (join a store / link a customer record), see Models/ConsentRequest.cs.
public static class Consent
{
    public const int MaxPendingPerAccount = 20;      // pending requests one customer account may have waiting (spam guard)
    public const int MaxNewPerStorePerDay = 50;      // new requests one store may send in 24 hours
    public const int MaxPendingJoinsPerStore = 200;  // join requests waiting for one owner
    public const int MaxAutoApprovedPerStorePerDay = 50;   // customers one store lets in by itself (auto-approve) in 24 hours; more wait for the owner

    // Pending requests whose time is over become "expired" (this also frees the one-pending-per-pair unique index).
    public static async Task ExpireStaleAsync(AppDb db, int? storeId = null, int? userId = null)
    {
        var now = DateTime.UtcNow;
        var stale = await db.ConsentRequests
            .Where(r => r.Status == ConsentRequest.Pending && r.ExpiresAt <= now
                        && (storeId == null || r.StoreId == storeId) && (userId == null || r.UserId == userId))
            .ToListAsync();
        if (stale.Count == 0) return;
        foreach (var r in stale) { r.Status = ConsentRequest.Expired; r.DecidedAt = now; }
        await db.SaveChangesAsync();
    }

    public static void Close(ConsentRequest r, string status)
    {
        r.Status = status;
        r.DecidedAt = DateTime.UtcNow;
    }

    // True when this customer account already has an empty duplicate or a record with history in the store.
    // Same rule the owner's link check always used: a record with utang / payments / payment requests is never touched.
    public static async Task<bool> HasHistoryAsync(AppDb db, int customerId) =>
        await db.Transactions.AnyAsync(t => t.CustomerId == customerId)
        || await db.PaymentRequests.IgnoreQueryFilters().AnyAsync(r => r.CustomerId == customerId);

    // Lets a customer account into a store. Call it inside StoreLock.BeginAsync and save + commit afterwards.
    //   attachTo == null : a brand-new record (the customer's unverified mobile number is never copied onto it)
    //   attachTo != null : the account is attached to that EXISTING record of the store (the caller already checked that it
    //                      belongs to the store, is not archived and is not linked), so its utang and payments are kept
    public static async Task<Customer> AdmitAsync(AppDb db, int storeId, User user, Customer? attachTo)
    {
        var now = DateTime.UtcNow;
        if (attachTo != null)
        {
            attachTo.LinkedUserId = user.Id;
            attachTo.LinkedAt = now;
            attachTo.IsDisconnected = false;
            attachTo.UpdatedAt = now;
            return attachTo;
        }
        var record = new Customer
        {
            StoreId = storeId,
            Code = await Ledger.NextCustomerCode(db, storeId),
            Name = user.FullName,
            LinkedUserId = user.Id,
            LinkedAt = now,
            UpdatedAt = now
        };
        db.Customers.Add(record);
        return record;
    }
}
