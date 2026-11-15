namespace CrediTrack.Api.Models;

// One entry of a transaction's Change History: every edit and the void.
// The fields that changed are rows in TransactionChangeDetails (one row per field), and the person's name is read from Users.
public class TransactionChange
{
    public int Id { get; set; }
    public int TransactionId { get; set; }
    public Transaction Transaction { get; set; } = null!;
    public DateTime At { get; set; } = DateTime.UtcNow;
    public int? ActorUserId { get; set; }
    public User? Actor { get; set; }
    public string Kind { get; set; } = "edit";    // "edit" or "void"
    public string Summary { get; set; } = "";
    public List<TransactionChangeDetail> Details { get; set; } = new();
}

// One changed field of one history entry, e.g. Field "Amount", OldValue "₱100.00", NewValue "₱150.00".
public class TransactionChangeDetail
{
    public int Id { get; set; }
    public int TransactionChangeId { get; set; }
    public TransactionChange TransactionChange { get; set; } = null!;
    public string Field { get; set; } = "";
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
}
