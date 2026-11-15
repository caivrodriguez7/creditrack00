using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// The per-email / per-account limiter. Run with:  dotnet test CrediTrack.Tests
public class AttemptLimiterTests
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);

    [Fact] public void Allows_up_to_the_limit_then_refuses()
    {
        var l = new AttemptLimiter();
        Assert.True(l.TryHit("a", 3, Window));
        Assert.True(l.TryHit("a", 3, Window));
        Assert.True(l.TryHit("a", 3, Window));
        Assert.False(l.TryHit("a", 3, Window));
    }

    [Fact] public void Keys_are_counted_separately()
    {
        var l = new AttemptLimiter();
        for (var i = 0; i < 3; i++) l.TryHit("a", 3, Window);
        Assert.False(l.TryHit("a", 3, Window));
        Assert.True(l.TryHit("b", 3, Window));
    }

    [Fact] public void Hits_stop_counting_after_the_window()
    {
        var now = new DateTime(2026, 11, 14, 8, 0, 0, DateTimeKind.Utc);
        var l = new AttemptLimiter(() => now);
        for (var i = 0; i < 3; i++) l.TryHit("a", 3, Window);
        Assert.False(l.TryHit("a", 3, Window));
        now = now.AddMinutes(16);
        Assert.True(l.TryHit("a", 3, Window));
    }

    [Fact] public void A_refused_hit_is_not_recorded()
    {
        var l = new AttemptLimiter();
        for (var i = 0; i < 3; i++) l.TryHit("a", 3, Window);
        l.TryHit("a", 3, Window);
        l.TryHit("a", 3, Window);
        Assert.Equal(3, l.Count("a", Window));
    }

    [Fact] public void Record_and_Count_track_failures_and_Clear_resets_them()
    {
        var l = new AttemptLimiter();
        l.Record("pw:1"); l.Record("pw:1");
        Assert.Equal(2, l.Count("pw:1", Window));
        l.Clear("pw:1");
        Assert.Equal(0, l.Count("pw:1", Window));
    }

    [Fact] public void Old_keys_are_swept_away()
    {
        var now = new DateTime(2026, 11, 14, 8, 0, 0, DateTimeKind.Utc);
        var l = new AttemptLimiter(() => now);
        l.Record("a");
        now = now.AddHours(2);
        Assert.Equal(0, l.Count("a", Window));
    }
}
