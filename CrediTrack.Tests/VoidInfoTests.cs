using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// Void audit: the owner sees who voided a record, the customer sees only when and why.
public class VoidInfoTests
{
    private static Transaction Voided() => new()
    {
        Id = 1, CustomerId = 1, Type = "payment", Amount = 100, Date = new DateTime(2026, 11, 1, 4, 0, 0, DateTimeKind.Utc),
        IsVoided = true, VoidedAt = new DateTime(2026, 11, 2, 4, 0, 0, DateTimeKind.Utc),
        VoidReason = "Incorrect entry", VoidedByUserId = 7, VoidedBy = new User { Id = 7, FullName = "Maria Santos" }
    };

    [Fact] public void Owner_row_names_who_voided_it()
    {
        var row = Ledger.BuildRow(Voided(), null, null);
        var info = Assert.IsType<Dictionary<string, object?>>(row["voidInfo"]);
        Assert.Equal("Incorrect entry", info["reasonLabel"]);
        Assert.NotNull(info["by"]);
        Assert.Contains("Maria Santos", info["by"]!.ToString());
    }

    [Fact] public void Customer_row_hides_the_staff_name()
    {
        var row = Ledger.BuildRow(Voided(), null, null, forCustomer: true);
        var info = Assert.IsType<Dictionary<string, object?>>(row["voidInfo"]);
        Assert.Equal("Incorrect entry", info["reasonLabel"]);
        Assert.Null(info["by"]);
    }

    [Fact] public void Active_record_has_no_void_info()
    {
        var t = Voided(); t.IsVoided = false;
        Assert.False(Ledger.BuildRow(t, null, null).ContainsKey("voidInfo"));
    }

    [Fact] public void Old_void_without_a_name_has_no_by()
    {
        var t = Voided(); t.VoidedBy = null; t.VoidedByUserId = null;
        var info = Assert.IsType<Dictionary<string, object?>>(Ledger.BuildRow(t, null, null)["voidInfo"]);
        Assert.Null(info["by"]);   // the page falls back to the store owner's name
    }
}
