namespace CrediTrack.Api.Models;

// One notification for one person (an owner or a customer). Made by the server when something happens
// (a payment request, a joined customer, a recorded utang or bayad ...), see Services/Notifier.cs.
public class Notification
{
    public int Id { get; set; }

    public int UserId { get; set; }               // who receives it

    public string Type { get; set; } = "";        // payment_request | payment_approved | payment_rejected | customer_joined | store_joined | credit_recorded | payment_recorded | overdue (customers: a credit became overdue, Part 6B)
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";

    // Where tapping it goes: customer | transaction | request | history  (the id of that record)
    public string? TargetKind { get; set; }
    public int? TargetId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ReadAt { get; set; }         // null = unread

    public User? User { get; set; }
}
