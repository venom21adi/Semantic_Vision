using System.Threading.Tasks;
using Shop.Models;
using Shop.Services;
using Shop.Util;

namespace App.Tests;

public class OrderServiceTests
{
    [Fact]
    public async Task Creates()
    {
        var svc = new OrderService(new Repo<Order>());
        var order = await svc.CreateAsync("a", 1);
        Assert.NotNull(order);
    }
}
