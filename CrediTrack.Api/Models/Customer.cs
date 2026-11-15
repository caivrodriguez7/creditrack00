namespace CrediTrack.Api.Models;

public class Customer
{
    public int Id { get; set; }
    public int StoreId { get; set; }
    public Store Store { get; set; } = null!;
    public string Code { get; set; } = "";        // CUS-001, numbered per store
    public string Name { get; set; } = "";
    public string? Phone { get; set; }            // 11 digits like 09171234567
    public bool IsArchived { get; set; }
    public DateTime? ArchivedAt { get; set; }     // when it was archived (null = active)
    public int? ArchivedByUserId { get; set; }    // the owner account that archived it
    public int? LinkedUserId { get; set; }        // set later when linked to a customer account
    public bool IsDisconnected { get; set; }      // the linked customer left the store (records are kept)
    public DateTime? LinkedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}