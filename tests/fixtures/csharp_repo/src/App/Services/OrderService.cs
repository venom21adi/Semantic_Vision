using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Shop.Models;
using Shop.Shapes;
using Shop.Util;

namespace Shop.Services;

public interface IOrderService
{
    Task<Order> CreateAsync(string sku, int quantity);
}

public class OrderService : IOrderService
{
    private readonly Repo<Order> _repo;

    public OrderService(Repo<Order> repo)
    {
        _repo = repo;
    }

    public async Task<Order> CreateAsync(string sku, int quantity)
    {
        var order = new Order();
        order.AddLine(sku, quantity);
        order.AddLine(new OrderLine(sku, quantity));
        await _repo.SaveAsync(order);
        var title = sku.Truncate(8);
        Log(title);
        Audit(async: true);
        return order;
    }

    public Task<Order> Find(int id) => _repo.GetAsync(id);

    public string? Describe(object? o)
    {
        if (o is Order ord && ord.Lines.Count > 0)
        {
            return ord.Describe2();
        }

        return o?.ToString();
    }

    public static decimal Sum(IEnumerable<Order> orders)
    {
        var total = 0m;
        foreach (var o in orders)
        {
            total += o.Total;
        }

        return total;
    }

    public bool HasLetter(string text) => text.Contains('a');

    public double ShapeArea() => Shape.Unit().Area();

    private static void Log(string message) => Console.WriteLine(message);

    private void Audit(bool async)
    {
        if (async)
        {
            Log("audit");
        }
    }
}
