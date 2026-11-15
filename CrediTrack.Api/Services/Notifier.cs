using System.Globalization;
using System.Text.Json;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Services;

// Makes notifications. A notification is only made when the receiver has not switched that kind off
// (Notification Preferences: everything is ON until the person turns it off).
// It never breaks the action that caused it: if saving the notification fails, the action still succeeds.
public static class Notifier
{
    public static string Peso(decimal amount) => "₱" + amount.ToString("N2", CultureInfo.InvariantCulture);

    // Owner switches:    payments, overdue, customers, activity
    // Customer switches: payments, activity, stores, account
    private static string PrefKey(string role, string type) => type switch
    {
        "payment_request" or "payment_approved" or "payment_rejected" => "payments",
        "customer_joined" => role == "owner" ? "customers" : "stores",
        "store_joined" => "stores",
        "join_request" or "link_accepted" or "link_declined" => "customers",          // to the owner
        "join_approved" or "join_declined" or "link_request" => "stores",              // to the customer
        "credit_recorded" or "payment_recorded" => "activity",
        "overdue" => role == "owner" ? "overdue" : "activity",
        _ => "account"
    };

    private static bool Wanted(string role, Dictionary<string, bool> prefs, string type) =>
        !prefs.TryGetValue(PrefKey(role, type), out var on) || on;

    public static async Task Add(AppDb db, int userId, string type, string title, string message,
        string? targetKind = null, int? targetId = null)
    {
        var user = await db.Users.Where(u => u.Id == userId).Select(u => new { u.Role }).FirstOrDefaultAsync();
        if (user == null) return;
        var prefs = await db.NotificationPreferences.Where(p => p.UserId == userId).ToDictionaryAsync(p => p.PrefKey, p => p.IsEnabled);
        if (!Wanted(user.Role, prefs, type)) return;

        var note = new Notification
        {
            UserId = userId,
            Type = type,
            Title = title,
            Message = message.Length > 300 ? message[..300] : message,
            TargetKind = targetKind,
            TargetId = targetId
        };
        db.Notifications.Add(note);
        try { await db.SaveChangesAsync(); }
        catch { db.Entry(note).State = EntityState.Detached; }
    }
}
