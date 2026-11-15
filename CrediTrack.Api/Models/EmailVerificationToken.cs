namespace CrediTrack.Api.Models;

public class EmailVerificationToken
{
    public int Id { get; set; }

    public int UserId { get; set; }

    // Only the hash is stored, never the raw token that is emailed to the user
    public string TokenHash { get; set; } = "";

    public DateTime ExpiresAt { get; set; }

    // Set when this token confirms a CHANGE of email address (Edit Profile): the new address waits here, and only replaces
    // Users.Email when the link is opened. null = the normal sign-up verification of the address the user already has.
    public string? PendingEmail { get; set; }

    public DateTime? UsedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public User? User { get; set; }
}