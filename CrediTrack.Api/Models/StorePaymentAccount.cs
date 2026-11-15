namespace CrediTrack.Api.Models;

// How a customer can pay a store OUTSIDE CrediTrack (the app only records the payment, it never moves money).
// One row per store and per method: a store has at most one GCash, one Maya and one Bank account. The owner sets them in
// Settings > Store Information > Payment Accounts, and a customer sees them on Make a Payment for the store they chose.
public class StorePaymentAccount
{
    public int Id { get; set; }
    public int StoreId { get; set; }
    public Store Store { get; set; } = null!;
    public string Method { get; set; } = Gcash;        // gcash | maya | bank
    public string AccountName { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string? BankName { get; set; }              // only for Method "bank" (like "BDO"); null for gcash and maya
    public string? QrPath { get; set; }                // like "qrs/<32 hex>.png", the key of the picture in StoredFiles; null = no QR
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public const string Gcash = "gcash";
    public const string Maya = "maya";
    public const string Bank = "bank";
    public static readonly string[] Methods = { Gcash, Maya, Bank };
}
