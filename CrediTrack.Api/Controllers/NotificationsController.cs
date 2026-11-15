using System.Security.Claims;
using CrediTrack.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// The signed-in person's own notifications (owner or customer). Nobody can read or change someone else's.
[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController : ControllerBase
{
    private readonly AppDb _db;
    public NotificationsController(AppDb db) { _db = db; }

    private int UserId() => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    // GET /api/notifications : the latest 100, newest first, with the total and unread counts
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var uid = UserId();
        var mine = _db.Notifications.AsNoTracking().Where(n => n.UserId == uid);
        var rows = await mine.OrderByDescending(n => n.CreatedAt).ThenByDescending(n => n.Id).Take(100).ToListAsync();
        return Ok(new
        {
            notifications = rows.Select(n => new
            {
                id = n.Id, type = n.Type, title = n.Title, message = n.Message, createdAt = n.CreatedAt,
                read = n.ReadAt != null,
                target = n.TargetKind == null || n.TargetId == null ? null : new { kind = n.TargetKind, id = n.TargetId }
            }),
            total = await mine.CountAsync(),
            unread = await mine.CountAsync(n => n.ReadAt == null)
        });
    }

    // GET /api/notifications/unread-count : for the red dot on the bell (called often, so it is tiny)
    [HttpGet("unread-count")]
    public async Task<IActionResult> UnreadCount()
    {
        var uid = UserId();
        return Ok(new { unread = await _db.Notifications.CountAsync(n => n.UserId == uid && n.ReadAt == null) });
    }

    // POST /api/notifications/{id}/read
    [HttpPost("{id:int}/read")]
    public async Task<IActionResult> Read(int id)
    {
        var uid = UserId();
        if (!await _db.Notifications.AnyAsync(n => n.Id == id && n.UserId == uid))
            return NotFound(new { message = "Notification not found." });
        await _db.Notifications.Where(n => n.Id == id && n.UserId == uid && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, (DateTime?)DateTime.UtcNow));
        return Ok(new { unread = await _db.Notifications.CountAsync(n => n.UserId == uid && n.ReadAt == null) });
    }

    // POST /api/notifications/read-all
    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll()
    {
        var uid = UserId();
        var changed = await _db.Notifications.Where(n => n.UserId == uid && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, (DateTime?)DateTime.UtcNow));
        return Ok(new { changed, unread = 0 });
    }
}
