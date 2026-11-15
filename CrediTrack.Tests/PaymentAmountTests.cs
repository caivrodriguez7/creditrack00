using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

public class PaymentAmountTests
{
    [Theory]
    [InlineData(125.50, 125.50)]
    [InlineData(25.25, 125.50)]
    public void Accepts_full_and_partial_payments(decimal amount, decimal outstanding)
        => Assert.True(PaymentRequests.IsValidAmount(amount, outstanding));

    [Theory]
    [InlineData(0, 125.50)]
    [InlineData(-1, 125.50)]
    [InlineData(125.51, 125.50)]
    [InlineData(1.001, 125.50)]
    [InlineData(1, 0)]
    public void Rejects_invalid_or_overpayment_amounts(decimal amount, decimal outstanding)
        => Assert.False(PaymentRequests.IsValidAmount(amount, outstanding));
}
