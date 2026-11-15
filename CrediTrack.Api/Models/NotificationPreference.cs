namespace CrediTrack.Api.Models;

// One on/off choice of one person on the Notifications settings page (key like "payments", "overdue").
// No row = the default, which is ON. The key of the table is (UserId, PrefKey).
public class NotificationPreference
{
    public int UserId { get; set; }
    public string PrefKey { get; set; } = "";
    public bool IsEnabled { get; set; }
    public User? User { get; set; }
}
