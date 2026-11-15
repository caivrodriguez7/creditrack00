using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddBackendExpansion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NotificationPrefsJson",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "PasswordChangedAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDisconnected",
                table: "Customers",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "LinkedAt",
                table: "Customers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PaymentRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    StoreId = table.Column<int>(type: "integer", nullable: false),
                    CustomerId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    Method = table.Column<string>(type: "text", nullable: false),
                    Reference = table.Column<string>(type: "text", nullable: true),
                    Message = table.Column<string>(type: "text", nullable: true),
                    ProofDataUrl = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    RejectReason = table.Column<string>(type: "text", nullable: true),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReviewedByUserId = table.Column<int>(type: "integer", nullable: true),
                    TransactionId = table.Column<int>(type: "integer", nullable: true),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentRequests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentRequests_Customers_CustomerId",
                        column: x => x.CustomerId,
                        principalTable: "Customers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PaymentRequests_Stores_StoreId",
                        column: x => x.StoreId,
                        principalTable: "Stores",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TransactionChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TransactionId = table.Column<int>(type: "integer", nullable: false),
                    At = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    ActorName = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    Summary = table.Column<string>(type: "text", nullable: false),
                    ChangesJson = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TransactionChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TransactionChanges_Transactions_TransactionId",
                        column: x => x.TransactionId,
                        principalTable: "Transactions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Transactions_StoreId_Date",
                table: "Transactions",
                columns: new[] { "StoreId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_Customers_LinkedUserId",
                table: "Customers",
                column: "LinkedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Customers_StoreId_Name",
                table: "Customers",
                columns: new[] { "StoreId", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRequests_CustomerId",
                table: "PaymentRequests",
                column: "CustomerId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRequests_StoreId_Status",
                table: "PaymentRequests",
                columns: new[] { "StoreId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRequests_UserId",
                table: "PaymentRequests",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_TransactionChanges_TransactionId",
                table: "TransactionChanges",
                column: "TransactionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PaymentRequests");

            migrationBuilder.DropTable(
                name: "TransactionChanges");

            migrationBuilder.DropIndex(
                name: "IX_Transactions_StoreId_Date",
                table: "Transactions");

            migrationBuilder.DropIndex(
                name: "IX_Customers_LinkedUserId",
                table: "Customers");

            migrationBuilder.DropIndex(
                name: "IX_Customers_StoreId_Name",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "NotificationPrefsJson",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "PasswordChangedAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "IsDisconnected",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "LinkedAt",
                table: "Customers");
        }
    }
}
