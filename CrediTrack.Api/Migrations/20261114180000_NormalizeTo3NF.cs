using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    // Brings the database to Third Normal Form. See NORMALIZATION.md in the project root for the explanation.
    //   1NF: Users.NotificationPrefsJson      -> NotificationPreferences (one row per setting)
    //        TransactionChanges.ChangesJson   -> TransactionChangeDetails (one row per changed field)
    //        Transactions.Note on credits     -> removed (it was a copy of TransactionItems.Name)
    //   3NF: Transactions.VoidedByName, TransactionChanges.ActorName -> removed (the name is read from Users by id)
    //   Integrity: every "...Id" column that points to another table is now a real FOREIGN KEY.
    // Existing data is copied first, then the old columns are dropped.
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261114180000_NormalizeTo3NF")]
    public partial class NormalizeTo3NF : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---------- 1. New tables ----------
            migrationBuilder.CreateTable(
                name: "NotificationPreferences",
                columns: table => new
                {
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    PrefKey = table.Column<string>(type: "text", nullable: false),
                    IsEnabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationPreferences", x => new { x.UserId, x.PrefKey });
                    table.ForeignKey(
                        name: "FK_NotificationPreferences_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TransactionChangeDetails",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TransactionChangeId = table.Column<int>(type: "integer", nullable: false),
                    Field = table.Column<string>(type: "text", nullable: false),
                    OldValue = table.Column<string>(type: "text", nullable: true),
                    NewValue = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TransactionChangeDetails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TransactionChangeDetails_TransactionChanges_TransactionChangeId",
                        column: x => x.TransactionChangeId,
                        principalTable: "TransactionChanges",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TransactionChangeDetails_TransactionChangeId",
                table: "TransactionChangeDetails",
                column: "TransactionChangeId");

            // ---------- 2. Copy the existing data into the new tables ----------
            // A row whose JSON cannot be read is skipped (the old code treated unreadable JSON as "no choices" too).
            migrationBuilder.Sql("""
                DO $$
                DECLARE r RECORD;
                BEGIN
                  FOR r IN SELECT "Id" AS uid, "NotificationPrefsJson" AS j FROM "Users"
                           WHERE "NotificationPrefsJson" IS NOT NULL AND btrim("NotificationPrefsJson") <> '' LOOP
                    BEGIN
                      INSERT INTO "NotificationPreferences" ("UserId", "PrefKey", "IsEnabled")
                      SELECT r.uid, e.key, (e.value = 'true')
                      FROM jsonb_each_text(r.j::jsonb) AS e
                      WHERE e.value IN ('true', 'false');
                    EXCEPTION WHEN others THEN NULL;
                    END;
                  END LOOP;
                END $$;
                """);

            migrationBuilder.Sql("""
                DO $$
                DECLARE r RECORD;
                BEGIN
                  FOR r IN SELECT "Id" AS cid, "ChangesJson" AS j FROM "TransactionChanges"
                           WHERE "ChangesJson" IS NOT NULL AND btrim("ChangesJson") <> '' LOOP
                    BEGIN
                      INSERT INTO "TransactionChangeDetails" ("TransactionChangeId", "Field", "OldValue", "NewValue")
                      SELECT r.cid, COALESCE(x.item->>'field', ''), x.item->>'from', x.item->>'to'
                      FROM jsonb_array_elements(r.j::jsonb) WITH ORDINALITY AS x(item, ord)
                      ORDER BY x.ord;
                    EXCEPTION WHEN others THEN NULL;
                    END;
                  END LOOP;
                END $$;
                """);

            // A credit's note was only its item names joined with commas (a copy of TransactionItems). Payments keep their notes.
            migrationBuilder.Sql("""UPDATE "Transactions" SET "Note" = NULL WHERE "Type" = 'credit';""");

            // ---------- 3. Clear ids that point at nothing, so the new foreign keys can be created ----------
            migrationBuilder.Sql("""UPDATE "Transactions" SET "VoidedByUserId" = NULL WHERE "VoidedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Id" = "Transactions"."VoidedByUserId");""");
            migrationBuilder.Sql("""UPDATE "TransactionChanges" SET "ActorUserId" = NULL WHERE "ActorUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Id" = "TransactionChanges"."ActorUserId");""");
            migrationBuilder.Sql("""UPDATE "Customers" SET "LinkedUserId" = NULL WHERE "LinkedUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Id" = "Customers"."LinkedUserId");""");
            migrationBuilder.Sql("""UPDATE "Customers" SET "ArchivedByUserId" = NULL WHERE "ArchivedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Id" = "Customers"."ArchivedByUserId");""");
            migrationBuilder.Sql("""UPDATE "PaymentRequests" SET "ReviewedByUserId" = NULL WHERE "ReviewedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Id" = "PaymentRequests"."ReviewedByUserId");""");
            migrationBuilder.Sql("""UPDATE "PaymentRequests" SET "ArchivedByUserId" = NULL WHERE "ArchivedByUserId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Id" = "PaymentRequests"."ArchivedByUserId");""");
            migrationBuilder.Sql("""UPDATE "PaymentRequests" SET "TransactionId" = NULL WHERE "TransactionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Transactions" t WHERE t."Id" = "PaymentRequests"."TransactionId");""");

            // ---------- 4. Drop the columns that broke 1NF / 3NF ----------
            migrationBuilder.DropColumn(name: "NotificationPrefsJson", table: "Users");
            migrationBuilder.DropColumn(name: "VoidedByName", table: "Transactions");
            migrationBuilder.DropColumn(name: "ActorName", table: "TransactionChanges");
            migrationBuilder.DropColumn(name: "ChangesJson", table: "TransactionChanges");

            // ---------- 5. Indexes for the new foreign keys ----------
            migrationBuilder.CreateIndex(name: "IX_Customers_ArchivedByUserId", table: "Customers", column: "ArchivedByUserId");
            migrationBuilder.CreateIndex(name: "IX_PaymentRequests_ArchivedByUserId", table: "PaymentRequests", column: "ArchivedByUserId");
            migrationBuilder.CreateIndex(name: "IX_PaymentRequests_ReviewedByUserId", table: "PaymentRequests", column: "ReviewedByUserId");
            migrationBuilder.CreateIndex(name: "IX_PaymentRequests_TransactionId", table: "PaymentRequests", column: "TransactionId");
            migrationBuilder.CreateIndex(name: "IX_Transactions_VoidedByUserId", table: "Transactions", column: "VoidedByUserId");
            migrationBuilder.CreateIndex(name: "IX_TransactionChanges_ActorUserId", table: "TransactionChanges", column: "ActorUserId");

            // ---------- 6. The foreign keys ----------
            migrationBuilder.AddForeignKey(name: "FK_Transactions_Stores_StoreId", table: "Transactions", column: "StoreId",
                principalTable: "Stores", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_Transactions_Users_VoidedByUserId", table: "Transactions", column: "VoidedByUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_TransactionChanges_Users_ActorUserId", table: "TransactionChanges", column: "ActorUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_Customers_Users_LinkedUserId", table: "Customers", column: "LinkedUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_Customers_Users_ArchivedByUserId", table: "Customers", column: "ArchivedByUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_PaymentRequests_Users_UserId", table: "PaymentRequests", column: "UserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(name: "FK_PaymentRequests_Users_ReviewedByUserId", table: "PaymentRequests", column: "ReviewedByUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_PaymentRequests_Users_ArchivedByUserId", table: "PaymentRequests", column: "ArchivedByUserId",
                principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
            migrationBuilder.AddForeignKey(name: "FK_PaymentRequests_Transactions_TransactionId", table: "PaymentRequests", column: "TransactionId",
                principalTable: "Transactions", principalColumn: "Id", onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Foreign keys and their indexes
            migrationBuilder.DropForeignKey(name: "FK_Transactions_Stores_StoreId", table: "Transactions");
            migrationBuilder.DropForeignKey(name: "FK_Transactions_Users_VoidedByUserId", table: "Transactions");
            migrationBuilder.DropForeignKey(name: "FK_TransactionChanges_Users_ActorUserId", table: "TransactionChanges");
            migrationBuilder.DropForeignKey(name: "FK_Customers_Users_LinkedUserId", table: "Customers");
            migrationBuilder.DropForeignKey(name: "FK_Customers_Users_ArchivedByUserId", table: "Customers");
            migrationBuilder.DropForeignKey(name: "FK_PaymentRequests_Users_UserId", table: "PaymentRequests");
            migrationBuilder.DropForeignKey(name: "FK_PaymentRequests_Users_ReviewedByUserId", table: "PaymentRequests");
            migrationBuilder.DropForeignKey(name: "FK_PaymentRequests_Users_ArchivedByUserId", table: "PaymentRequests");
            migrationBuilder.DropForeignKey(name: "FK_PaymentRequests_Transactions_TransactionId", table: "PaymentRequests");

            migrationBuilder.DropIndex(name: "IX_Customers_ArchivedByUserId", table: "Customers");
            migrationBuilder.DropIndex(name: "IX_PaymentRequests_ArchivedByUserId", table: "PaymentRequests");
            migrationBuilder.DropIndex(name: "IX_PaymentRequests_ReviewedByUserId", table: "PaymentRequests");
            migrationBuilder.DropIndex(name: "IX_PaymentRequests_TransactionId", table: "PaymentRequests");
            migrationBuilder.DropIndex(name: "IX_Transactions_VoidedByUserId", table: "Transactions");
            migrationBuilder.DropIndex(name: "IX_TransactionChanges_ActorUserId", table: "TransactionChanges");

            // Bring the old columns back
            migrationBuilder.AddColumn<string>(name: "NotificationPrefsJson", table: "Users", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "VoidedByName", table: "Transactions", type: "text", nullable: true);
            migrationBuilder.AddColumn<string>(name: "ActorName", table: "TransactionChanges", type: "text", nullable: false, defaultValue: "");
            migrationBuilder.AddColumn<string>(name: "ChangesJson", table: "TransactionChanges", type: "text", nullable: true);

            // ...and fill them again from the tables
            migrationBuilder.Sql("""
                UPDATE "Users" u SET "NotificationPrefsJson" = p.j
                FROM (SELECT "UserId" AS id, json_object_agg("PrefKey", "IsEnabled")::text AS j
                      FROM "NotificationPreferences" GROUP BY "UserId") p
                WHERE p.id = u."Id";
                """);
            migrationBuilder.Sql("""
                UPDATE "TransactionChanges" c SET "ChangesJson" = d.j
                FROM (SELECT "TransactionChangeId" AS id,
                             json_agg(json_build_object('field', "Field", 'from', "OldValue", 'to', "NewValue") ORDER BY "Id")::text AS j
                      FROM "TransactionChangeDetails" GROUP BY "TransactionChangeId") d
                WHERE d.id = c."Id";
                """);
            migrationBuilder.Sql("""
                UPDATE "TransactionChanges" c SET "ActorName" = COALESCE(NULLIF(u."FullName", ''), 'Store Owner')
                FROM "Users" u WHERE u."Id" = c."ActorUserId";
                """);
            migrationBuilder.Sql("""UPDATE "TransactionChanges" SET "ActorName" = 'Store Owner' WHERE "ActorName" = '';""");
            migrationBuilder.Sql("""
                UPDATE "Transactions" t SET "VoidedByName" = u."FullName"
                FROM "Users" u WHERE u."Id" = t."VoidedByUserId";
                """);
            migrationBuilder.Sql("""
                UPDATE "Transactions" t SET "Note" = n.names
                FROM (SELECT "TransactionId" AS id, string_agg("Name", ', ' ORDER BY "Id") AS names
                      FROM "TransactionItems" GROUP BY "TransactionId") n
                WHERE n.id = t."Id" AND t."Type" = 'credit';
                """);

            migrationBuilder.DropTable(name: "TransactionChangeDetails");
            migrationBuilder.DropTable(name: "NotificationPreferences");
        }
    }
}
