using CrediTrack.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Data;

public class AppDb : DbContext
{
    public AppDb(DbContextOptions<AppDb> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Store> Stores => Set<Store>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<TransactionItem> TransactionItems => Set<TransactionItem>();
    public DbSet<TransactionChange> TransactionChanges => Set<TransactionChange>();
    public DbSet<PaymentRequest> PaymentRequests => Set<PaymentRequest>();
    public DbSet<PasswordResetToken> PasswordResetTokens => Set<PasswordResetToken>();
    public DbSet<EmailVerificationToken> EmailVerificationTokens => Set<EmailVerificationToken>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ConsentRequest> ConsentRequests => Set<ConsentRequest>();
    public DbSet<StoredFile> StoredFiles => Set<StoredFile>();
    public DbSet<NotificationPreference> NotificationPreferences => Set<NotificationPreference>();
    public DbSet<TransactionChangeDetail> TransactionChangeDetails => Set<TransactionChangeDetail>();
    public DbSet<StorePaymentAccount> StorePaymentAccounts => Set<StorePaymentAccount>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<StoredFile>().HasKey(f => f.Path);
        b.Entity<User>().HasIndex(u => u.Email).IsUnique();
        b.Entity<User>().HasIndex(u => u.CustomerCode).IsUnique();
        b.Entity<Store>().HasIndex(s => s.StoreCode).IsUnique();
        b.Entity<Customer>().HasIndex(c => new { c.StoreId, c.Phone }).IsUnique();

        b.Entity<Transaction>().HasIndex(t => new { t.StoreId, t.Number }).IsUnique();
        b.Entity<Transaction>().HasIndex(t => new { t.StoreId, t.RequestId }).IsUnique();
        // Money is stored with exactly 2 decimals
        b.Entity<Transaction>().Property(t => t.Amount).HasPrecision(12, 2);
        b.Entity<Transaction>().Property(t => t.BalanceBefore).HasPrecision(12, 2);
        b.Entity<TransactionItem>().Property(i => i.Price).HasPrecision(12, 2);
        b.Entity<TransactionItem>().Property(i => i.Qty).HasPrecision(18, 6);

        // Indexes for the new search / filter / sort queries
        b.Entity<Customer>().HasIndex(c => c.LinkedUserId);
        b.Entity<Customer>().HasIndex(c => new { c.StoreId, c.Name });
        b.Entity<Transaction>().HasIndex(t => new { t.StoreId, t.Date });
        b.Entity<Transaction>().HasIndex(t => t.CustomerId);

        b.Entity<TransactionChange>().HasIndex(c => c.TransactionId);

        b.Entity<PaymentRequest>().Property(r => r.Amount).HasPrecision(12, 2);
        b.Entity<PaymentRequest>().HasIndex(r => new { r.StoreId, r.Status });
        b.Entity<PaymentRequest>().HasIndex(r => r.CustomerId);
        b.Entity<PaymentRequest>().HasIndex(r => r.UserId);

        // Soft delete: an archived payment request is hidden from every query unless the query says IgnoreQueryFilters()
        // (the Archived tab, the archive/restore actions, and the customer's own view, where nothing they sent disappears).
        b.Entity<PaymentRequest>().HasQueryFilter(r => !r.IsArchived);
        
        // Password reset token configuration
        b.Entity<PasswordResetToken>().HasIndex(t => t.TokenHash).IsUnique();

        b.Entity<PasswordResetToken>()
            .HasOne(t => t.User)
            .WithMany()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Email verification token configuration
        b.Entity<EmailVerificationToken>().HasIndex(t => t.TokenHash).IsUnique();

        b.Entity<EmailVerificationToken>()
            .HasOne(t => t.User)
            .WithMany()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Consent requests (join a store / link a customer record): at most ONE pending request per store + account + kind,
        // and one pending link request per customer record. The database enforces it, so two quick taps cannot make two.
        b.Entity<ConsentRequest>().HasIndex(r => new { r.Kind, r.StoreId, r.UserId }).IsUnique().HasFilter("\"Status\" = 'pending'");
        b.Entity<ConsentRequest>().HasIndex(r => r.CustomerId).IsUnique().HasFilter("\"Status\" = 'pending' AND \"Kind\" = 'link'");
        b.Entity<ConsentRequest>().HasIndex(r => new { r.StoreId, r.Status });
        b.Entity<ConsentRequest>().HasIndex(r => new { r.UserId, r.Status });
        b.Entity<ConsentRequest>().HasOne(r => r.Store).WithMany().HasForeignKey(r => r.StoreId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ConsentRequest>().HasOne(r => r.User).WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<ConsentRequest>().HasOne(r => r.Customer).WithMany().HasForeignKey(r => r.CustomerId).OnDelete(DeleteBehavior.Cascade);

        // Notifications: a person's list, newest first (and the unread count for the bell)
        b.Entity<Notification>().HasIndex(n => new { n.UserId, n.CreatedAt });
        b.Entity<Notification>()
            .HasOne(n => n.User)
            .WithMany()
            .HasForeignKey(n => n.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Deleting a customer record must never silently delete its payment requests
        b.Entity<PaymentRequest>().HasOne(r => r.Customer).WithMany().HasForeignKey(r => r.CustomerId).OnDelete(DeleteBehavior.Restrict);

        // ---- Third normal form ----
        // 1NF: notification choices and the fields of a history entry are ROWS (one value per cell), not JSON text.
        b.Entity<NotificationPreference>().HasKey(p => new { p.UserId, p.PrefKey });
        b.Entity<NotificationPreference>()
            .HasOne(p => p.User).WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TransactionChangeDetail>()
            .HasOne(d => d.TransactionChange).WithMany(c => c.Details).HasForeignKey(d => d.TransactionChangeId).OnDelete(DeleteBehavior.Cascade);

        // 3NF: a person's name lives only in Users. History rows keep the user's id and the name is read with a join.
        b.Entity<Transaction>().HasOne(t => t.VoidedBy).WithMany().HasForeignKey(t => t.VoidedByUserId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<TransactionChange>().HasOne(c => c.Actor).WithMany().HasForeignKey(c => c.ActorUserId).OnDelete(DeleteBehavior.SetNull);

        // Every "...Id" column is a real foreign key, so the database itself refuses a row that points at nothing.
        b.Entity<Transaction>().HasOne<Store>().WithMany().HasForeignKey(t => t.StoreId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Customer>().HasOne<User>().WithMany().HasForeignKey(c => c.LinkedUserId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<Customer>().HasOne<User>().WithMany().HasForeignKey(c => c.ArchivedByUserId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<PaymentRequest>().HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<PaymentRequest>().HasOne<User>().WithMany().HasForeignKey(r => r.ReviewedByUserId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<PaymentRequest>().HasOne<User>().WithMany().HasForeignKey(r => r.ArchivedByUserId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<PaymentRequest>().HasOne<Transaction>().WithMany().HasForeignKey(r => r.TransactionId).OnDelete(DeleteBehavior.SetNull);

        // Payment accounts (GCash / Maya / Bank) a store shows to its customers: one row per store and method.
        // Deleting a store deletes its payment accounts. The QR picture itself lives in StoredFiles (QrPath is its key).
        b.Entity<StorePaymentAccount>().HasIndex(a => new { a.StoreId, a.Method }).IsUnique();
        b.Entity<StorePaymentAccount>().HasOne(a => a.Store).WithMany().HasForeignKey(a => a.StoreId).OnDelete(DeleteBehavior.Cascade);
    }
}