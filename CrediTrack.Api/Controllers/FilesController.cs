using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Serves the saved pictures. They live in a folder outside wwwroot, so this is the only way to open one,
// and only a signed-in person who is allowed to see that picture gets it.
[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly AppDb _db;
    private readonly FileStorage _files;
    public FilesController(AppDb db, FileStorage files) { _db = db; _files = files; }

    private int UserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    private async Task<IActionResult> Serve(string path)
    {
        var picture = await _files.ReadAsync(path);
        if (picture == null) return NotFound();
        // The file name changes with every new upload, so the browser may keep its copy (private = not shared caches).
        Response.Headers.CacheControl = "private, max-age=86400";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(picture.Data, picture.ContentType);
    }

    // GET /api/files/profiles/{name} : my own photo, the photo of a customer linked in my store (owner),
    // or the photo of the owner of a store I joined (customer)
    [HttpGet("profiles/{name}")]
    public async Task<IActionResult> Profile(string name)
    {
        var path = FileStorage.ProfilesFolder + "/" + name;
        if (!FileStorage.IsStoredPath(path)) return NotFound();

        var photoOwner = await _db.Users.Where(u => u.PhotoPath == path).Select(u => (int?)u.Id).FirstOrDefaultAsync();
        if (photoOwner == null) return NotFound();

        var me = UserId();
        if (photoOwner != me)
        {
            var allowed = await _db.Customers.IgnoreQueryFilters().AnyAsync(c =>
                (c.LinkedUserId == photoOwner && !c.IsDisconnected && c.Store.OwnerId == me)      // I am the owner, this is my customer
                || (c.LinkedUserId == me && !c.IsDisconnected && c.Store.OwnerId == photoOwner)); // I am the customer, this is my store's owner
            if (!allowed) return NotFound();
        }
        return await Serve(path);
    }

    // GET /api/files/proofs/{name} : only the customer who sent the payment request and the owner of that store
    [HttpGet("proofs/{name}")]
    public async Task<IActionResult> Proof(string name)
    {
        var path = FileStorage.ProofsFolder + "/" + name;
        if (!FileStorage.IsStoredPath(path)) return NotFound();

        var me = UserId();
        var allowed = await _db.PaymentRequests.IgnoreQueryFilters()
            .AnyAsync(r => r.ProofPath == path && (r.UserId == me || r.Store.OwnerId == me));
        if (!allowed) return NotFound();
        return await Serve(path);
    }
}
