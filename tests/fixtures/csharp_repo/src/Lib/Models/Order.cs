using System.Collections.Generic;
using Shop.Util;

namespace Shop.Models;

public partial class Order : Entity
{
    private readonly List<OrderLine> _lines = new();

    public int Id { get; set; }

    public IReadOnlyList<OrderLine> Lines => _lines;

    public decimal Discount { get; private set; }

    public decimal Total
    {
        get { return ComputeTotal(); }
        set { Discount = value; }
    }

    public void AddLine(OrderLine line)
    {
        _lines.Add(line);
        Recalculate();
    }

    public void AddLine(string sku, int quantity)
    {
        AddLine(new OrderLine(sku, quantity));
    }

    public string Describe2() => $"#{Id}";
}
