namespace CrediTrack.Api.Models;

// A request that needs the OTHER side's yes before anything is connected.
//   Kind "join": a customer account asks to join a store (found with the store code). The store owner approves or declines.
//   Kind "link": a store owner asks to link a customer record to a customer account (found with the CT-CUS code).
//                CustomerId is that record. The customer account accepts or declines.
// Nothing is changed on the Customer row until the request is accepted / approved.
public class ConsentRequest
{
    public int Id { get; set; }
    public string Kind { get; set; } = "join";            // join | link
    public int StoreId { get; set; }
    public Store Store { get; set; } = null!;
    public int UserId { get; set; }                       // the customer account
    public User User { get; set; } = null!;
    public int? CustomerId { get; set; }                  // link requests: the record to link
    public Customer? Customer { get; set; }
    public string Status { get; set; } = Pending;         // pending | accepted | declined | cancelled | expired
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; }
    public DateTime? DecidedAt { get; set; }

    public const string Pending = "pending";
    public const string Accepted = "accepted";
    public const string Declined = "declined";
    public const string Cancelled = "cancelled";
    public const string Expired = "expired";
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(14);
}
