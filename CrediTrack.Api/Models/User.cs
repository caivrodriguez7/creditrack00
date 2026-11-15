namespace CrediTrack.Api.Models;

public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "";        // "owner" or "customer"
    public string FullName { get; set; } = "";
    public string? ContactNumber { get; set; }
    public string? CustomerCode { get; set; }     // CT-CUS-123456 (customers only)
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PasswordChangedAt { get; set; }
    public bool EmailVerified { get; set; } = false;   // new accounts start unverified
    public DateTime? EmailVerifiedAt { get; set; }      // set when the email is verified
    public string? PhotoPath { get; set; }           // profile photo: path of the saved file, like "profiles/<id>.jpg" (the file is in the uploads folder, not in the database); null = no photo
    public DateTime? TermsAcceptedAt { get; set; }
    public string? TermsVersion { get; set; }
    public string? PrivacyPolicyVersion { get; set; }
}