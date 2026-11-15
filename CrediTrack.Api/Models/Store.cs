namespace CrediTrack.Api.Models;

public class Store
{
    public int Id { get; set; }
    public int OwnerId { get; set; }
    public User Owner { get; set; } = null!;
    public string Name { get; set; } = "";
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? BusinessType { get; set; }
    public string? StoreHours { get; set; }
    public string StoreCode { get; set; } = "";   // CT-AB12CD, customers use it to join
    public bool AutoApproveJoins { get; set; }    // true = a customer who enters the store code joins at once (no approval needed)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}