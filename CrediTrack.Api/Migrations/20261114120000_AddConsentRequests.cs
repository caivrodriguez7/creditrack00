using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261114120000_AddConsentRequests")]
    public partial class AddConsentRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ConsentRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    StoreId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    CustomerId = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConsentRequests", x => x.Id);
                    table.ForeignKey(name: "FK_ConsentRequests_Customers_CustomerId", column: x => x.CustomerId,
                        principalTable: "Customers", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(name: "FK_ConsentRequests_Stores_StoreId", column: x => x.StoreId,
                        principalTable: "Stores", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(name: "FK_ConsentRequests_Users_UserId", column: x => x.UserId,
                        principalTable: "Users", principalColumn: "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(name: "IX_ConsentRequests_Kind_StoreId_UserId", table: "ConsentRequests",
                columns: new[] { "Kind", "StoreId", "UserId" }, unique: true, filter: "\"Status\" = 'pending'");
            migrationBuilder.CreateIndex(name: "IX_ConsentRequests_CustomerId", table: "ConsentRequests",
                column: "CustomerId", unique: true, filter: "\"Status\" = 'pending' AND \"Kind\" = 'link'");
            migrationBuilder.CreateIndex(name: "IX_ConsentRequests_StoreId_Status", table: "ConsentRequests",
                columns: new[] { "StoreId", "Status" });
            migrationBuilder.CreateIndex(name: "IX_ConsentRequests_UserId_Status", table: "ConsentRequests",
                columns: new[] { "UserId", "Status" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ConsentRequests");
        }
    }
}
