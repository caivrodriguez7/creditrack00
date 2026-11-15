namespace CrediTrack.Api.Models;

// A saved picture (profile photo or proof of payment). The bytes live in the DATABASE, not in a folder on the server,
// so they survive restarts and redeploys on any host. Users.PhotoPath / PaymentRequests.ProofPath hold the Path.
public class StoredFile
{
    public string Path { get; set; } = "";          // like "profiles/<32 hex>.jpg" or "proofs/<32 hex>.png" (the key)
    public string ContentType { get; set; } = "image/jpeg";
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
