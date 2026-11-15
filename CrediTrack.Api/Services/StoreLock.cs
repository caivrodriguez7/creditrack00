using CrediTrack.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace CrediTrack.Api.Services;

// One writer at a time per store. Everything that changes a store's money (record credit, record payment, approve a
// payment request, edit, void) first opens a database transaction and takes this lock, THEN reads the balance, takes
// the next transaction number, inserts, and commits. Two requests for the same store therefore run one after the
// other, so two payments can no longer both pass the "balance is enough" check, and two saves can no longer both
// pick the same number. Different stores never wait for each other.
//
// pg_advisory_xact_lock is held until the surrounding transaction commits or rolls back (disposing the transaction
// without a commit is a rollback), so there is nothing to unlock by hand and a crashed request cannot leave it stuck.
public static class StoreLock
{
    public static async Task<IDbContextTransaction> BeginAsync(AppDb db, int storeId, CancellationToken ct = default)
    {
        var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({(long)storeId})", ct);
        }
        catch
        {
            await tx.DisposeAsync();
            throw;
        }
        return tx;
    }

    // True when the database refused a row because of a UNIQUE index (SQLSTATE 23505), for example the same
    // (StoreId, RequestId) saved twice.
    public static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}
