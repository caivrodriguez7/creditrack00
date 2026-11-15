namespace CrediTrack.Api.Models;

// A payment a customer says they made. It only becomes a real payment Transaction when the owner approves it.
public class PaymentRequest
{
    public int Id { get; set; }
    public int StoreId { get; set; }
    public Store Store { get; set; } = null!;
    public int CustomerId { get; set; }           // the store's customer record (linked to the user)
    public Customer Customer { get; set; } = null!;
    public int UserId { get; set; }               // the customer account that sent it
    public decimal Amount { get; set; }
    public string Method { get; set; } = "";
    public string? Reference { get; set; }
    public string? Message { get; set; }
    public string? ProofPath { get; set; }        // optional picture (JPG/PNG, up to 5 MB): path of the saved file, like "proofs/<id>.jpg" (the file is in the uploads folder, not in the database)
    public string Status { get; set; } = "pending";   // pending | approved | rejected
    public string? RejectReason { get; set; }
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAt { get; set; }
    public int? ReviewedByUserId { get; set; }
    public int? TransactionId { get; set; }       // the payment recorded when approved
    public bool IsArchived { get; set; }
    public DateTime? ArchivedAt { get; set; }     // when it was archived (null = not archived)
    public int? ArchivedByUserId { get; set; }    // the owner account that archived it
}
