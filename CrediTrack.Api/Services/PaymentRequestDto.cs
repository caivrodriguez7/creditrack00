using CrediTrack.Api.Models;

namespace CrediTrack.Api.Services;

// A payment request without its (large) proof picture, built inside the database query
public class PaymentRequestRow
{
    public int Id { get; set; }
    public int StoreId { get; set; }
    public string StoreName { get; set; } = "";
    public int CustomerId { get; set; }
    public string CustomerName { get; set; } = "";
    public string CustomerCode { get; set; } = "";
    public decimal Amount { get; set; }
    public string Method { get; set; } = "";
    public string? Reference { get; set; }
    public string? Message { get; set; }
    public bool HasProof { get; set; }
    public string Status { get; set; } = "";
    public string? RejectReason { get; set; }
    public DateTime SubmittedAt { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public int? TransactionId { get; set; }
    public bool IsArchived { get; set; }
    public DateTime? ArchivedAt { get; set; }
}

public record TxInfo(bool Voided, int Number);

public static class PaymentRequests
{
    public static readonly string[] Methods = { "Cash", "GCash", "Maya", "Bank Transfer", "Other" };
    public static readonly string[] ReferenceRequired = { "GCash", "Maya", "Bank Transfer" };
    public static readonly string[] ProofRequired = { "GCash", "Maya", "Bank Transfer", "Other" };   // only cash can go without a picture

    public static bool IsValidAmount(decimal amount, decimal outstanding) =>
        amount > 0 && amount == decimal.Round(amount, 2) && outstanding > 0 && amount <= outstanding;

    public static string Code(int id) => "PR-" + id.ToString("0000");

    public static IQueryable<PaymentRequestRow> Project(IQueryable<PaymentRequest> q) =>
        q.Select(r => new PaymentRequestRow
        {
            Id = r.Id,
            StoreId = r.StoreId,
            StoreName = r.Store.Name,
            CustomerId = r.CustomerId,
            CustomerName = r.Customer.Name,
            CustomerCode = r.Customer.Code,
            Amount = r.Amount,
            Method = r.Method,
            Reference = r.Reference,
            Message = r.Message,
            HasProof = r.ProofPath != null,
            Status = r.Status,
            RejectReason = r.RejectReason,
            SubmittedAt = r.SubmittedAt,
            ReviewedAt = r.ReviewedAt,
            TransactionId = r.TransactionId,
            IsArchived = r.IsArchived,
            ArchivedAt = r.ArchivedAt
        });

    // status: pending | approved | rejected.  paymentStatus (owner screens): pending | confirmed | rejected | voided.
    // customerStatus (customer screens): pending | completed | rejected.
    public static object Dto(PaymentRequestRow r, TxInfo? tx, string? proof = null) => new
    {
        id = r.Id,
        code = Code(r.Id),
        storeId = r.StoreId,
        storeName = r.StoreName,
        customerId = r.CustomerId,
        customer = r.CustomerName,
        customerCode = r.CustomerCode,
        amount = r.Amount,
        method = r.Method,
        reference = r.Reference,
        message = r.Message,
        hasProof = r.HasProof,
        proof,
        status = r.Status,
        paymentStatus = r.Status == "approved" ? (tx?.Voided == true ? "voided" : "confirmed") : r.Status,
        customerStatus = r.Status == "approved" ? "completed" : r.Status,
        rejectReason = r.RejectReason,
        submittedAt = r.SubmittedAt,
        reviewedAt = r.ReviewedAt,
        transactionId = r.TransactionId,
        transactionCode = tx == null ? null : Ledger.Code(tx.Number),
        archived = r.IsArchived,
        archivedAt = r.ArchivedAt
    };
}
