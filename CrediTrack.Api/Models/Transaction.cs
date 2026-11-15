namespace CrediTrack.Api.Models;

public class Transaction
{
    public int Id { get; set; }
    public int StoreId { get; set; }
    public int Number { get; set; }               // counter per store, shown as TRX-0001
    public int CustomerId { get; set; }
    public Customer Customer { get; set; } = null!;
    public string Type { get; set; } = "";        // "credit" or "payment"
    public decimal Amount { get; set; }
    public DateTime Date { get; set; }
    public DateOnly? DueDate { get; set; }        // credit only: the agreed payment date. null = "No due date" (can never be overdue)
    public string? Note { get; set; }             // payment: the owner's notes. A credit has no note of its own: its item names are read from Items (stored once)
    public string? Method { get; set; }           // payments only
    public string? Reference { get; set; }        // payments only
    public decimal? BalanceBefore { get; set; }   // payments only
    public string? RequestId { get; set; }        // makes saving safe to repeat (double click)
    public bool IsVoided { get; set; }
    public DateTime? VoidedAt { get; set; }
    public string? VoidReason { get; set; }
    public string? VoidRemarks { get; set; }
    public int? VoidedByUserId { get; set; }      // who voided it (the signed-in owner)
    public User? VoidedBy { get; set; }           // the account's name is read from Users (not copied here)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public List<TransactionItem> Items { get; set; } = new();
}

public class TransactionItem
{
    public int Id { get; set; }
    public int TransactionId { get; set; }
    public Transaction Transaction { get; set; } = null!;
    public string Name { get; set; } = "";
    public decimal Qty { get; set; }
    public string? QtyText { get; set; }          // as typed, e.g. "1/2"
    public string Unit { get; set; } = "";
    public decimal Price { get; set; }
}