namespace Shop.Models;

public class OrderLine
{
    public OrderLine(string sku, int quantity)
    {
        Sku = sku;
        Quantity = quantity;
    }

    public string Sku { get; }

    public int Quantity { get; }

    public decimal Price() => Quantity * PriceList.Lookup(Sku);
}

public static class PriceList
{
    public static decimal Lookup(string sku) => sku.Length;
}

public record Point(int X, int Y)
{
    public double Distance() => System.Math.Sqrt((X * X) + (Y * Y));
}
