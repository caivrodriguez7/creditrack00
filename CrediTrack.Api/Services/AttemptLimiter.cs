namespace CrediTrack.Api.Services;

// A small in-memory "N tries per time window" counter, keyed by any text (an email, a user id ...).
// It backs the PER-ACCOUNT limits that the per-IP rate limiter in Program.cs cannot give: someone who rotates IP
// addresses still cannot email-bomb one victim or guess one account's password without end.
//
// It lives in the memory of ONE app instance. With several instances each has its own counters, so the real limit
// becomes (limit x instances); move the counters to Redis or the database if the app is ever scaled out.
public class AttemptLimiter
{
    // Hits older than this are always forgotten (longer than any window used by the controllers).
    private static readonly TimeSpan Retention = TimeSpan.FromHours(1);

    private readonly Dictionary<string, List<DateTime>> _hits = new();
    private readonly object _lock = new();
    private readonly Func<DateTime> _now;
    private DateTime _lastSweep;

    public AttemptLimiter() : this(() => DateTime.UtcNow) { }
    public AttemptLimiter(Func<DateTime> now) { _now = now; _lastSweep = now(); }

    // How many hits for this key fall inside the window.
    public int Count(string key, TimeSpan window)
    {
        lock (_lock)
        {
            Sweep();
            if (!_hits.TryGetValue(key, out var list)) return 0;
            var since = _now() - window;
            return list.Count(t => t > since);
        }
    }

    // Writes one hit down.
    public void Record(string key)
    {
        lock (_lock)
        {
            Sweep();
            if (!_hits.TryGetValue(key, out var list)) _hits[key] = list = new List<DateTime>();
            list.Add(_now());
        }
    }

    // Counts the hit and tells whether it is still allowed: true = under the limit (the hit is recorded),
    // false = over the limit (nothing is recorded, so a flood does not keep extending the wait).
    public bool TryHit(string key, int limit, TimeSpan window)
    {
        lock (_lock)
        {
            Sweep();
            if (!_hits.TryGetValue(key, out var list)) _hits[key] = list = new List<DateTime>();
            var now = _now();
            var since = now - window;
            if (list.Count(t => t > since) >= limit) return false;
            list.Add(now);
            return true;
        }
    }

    // Forgets a key (for example after the right password was entered).
    public void Clear(string key)
    {
        lock (_lock) _hits.Remove(key);
    }

    // Drops old hits and empty keys now and then so the dictionary cannot grow without end.
    private void Sweep()
    {
        var now = _now();
        if (now - _lastSweep < TimeSpan.FromMinutes(5)) return;
        _lastSweep = now;
        var cutoff = now - Retention;
        foreach (var key in _hits.Keys.ToList())
        {
            var list = _hits[key];
            list.RemoveAll(t => t <= cutoff);
            if (list.Count == 0) _hits.Remove(key);
        }
    }
}
