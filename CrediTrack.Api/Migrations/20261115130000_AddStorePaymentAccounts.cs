using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    // New table StorePaymentAccounts: the GCash / Maya / Bank details a store shows to its customers (one row per store and method).
    // Nothing existing is changed or removed, so it is safe for the live data. Down() just drops the table.
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261115130000_AddStorePaymentAccounts")]
    public partial class AddStorePaymentAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StorePaymentAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    StoreId = table.Column<int>(type: "integer", nullable: false),
                    Method = table.Column<string>(type: "text", nullable: false),
                    AccountName = table.Column<string>(type: "text", nullable: false),
                    AccountNumber = table.Column<string>(type: "text", nullable: false),
                    BankName = table.Column<string>(type: "text", nullable: true),
                    QrPath = table.Column<string>(type: "text", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StorePaymentAccounts", x => x.Id);
                    table.ForeignKey(name: "FK_StorePaymentAccounts_Stores_StoreId", column: x => x.StoreId,
                        principalTable: "Stores", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(name: "IX_StorePaymentAccounts_StoreId_Method", table: "StorePaymentAccounts",
                columns: new[] { "StoreId", "Method" }, unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "StorePaymentAccounts");
        }
    }
}
