using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    // Pictures are no longer kept in the database. The two columns now hold the PATH of a saved file
    // ("profiles/<id>.jpg", "proofs/<id>.png"). Rows that still contain old base64 text are converted to files
    // the next time the app starts (FileStorage.MigrateLegacyAsync), so no picture is lost.
    [DbContext(typeof(AppDb))]
    [Migration("20261112110000_MoveImagesToFiles")]
    public partial class MoveImagesToFiles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "PhotoDataUrl",
                table: "Users",
                newName: "PhotoPath");

            migrationBuilder.RenameColumn(
                name: "ProofDataUrl",
                table: "PaymentRequests",
                newName: "ProofPath");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Going back leaves the file paths in the old column names (files are not turned back into base64 text)
            migrationBuilder.RenameColumn(
                name: "PhotoPath",
                table: "Users",
                newName: "PhotoDataUrl");

            migrationBuilder.RenameColumn(
                name: "ProofPath",
                table: "PaymentRequests",
                newName: "ProofDataUrl");
        }
    }
}
