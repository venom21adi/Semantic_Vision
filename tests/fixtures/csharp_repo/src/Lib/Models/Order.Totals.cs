using System;
using System.Linq;

namespace Shop.Models;

public partial class Order
{
    private decimal ComputeTotal() => _lines.Sum(l => l.Price()) - Discount;

    private void Recalculate()
    {
        Discount = Math.Max(0, Discount);
    }
}
