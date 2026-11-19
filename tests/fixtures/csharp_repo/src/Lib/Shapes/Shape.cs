using System;

namespace Shop.Shapes;

public interface IShape
{
    double Area();
}

public abstract class Shape : IShape
{
    public abstract double Area();

    public virtual string Describe() => $"{GetType().Name}: {Area()}";

    public static Shape Unit() => new Circle(1);
}

public class Circle : Shape
{
    public Circle(double radius)
    {
        Radius = radius;
    }

    public double Radius { get; }

    public override double Area() => Math.PI * Radius * Radius;

    public override string Describe() => base.Describe() + "!";
}

public class Square : Shape
{
    public Square(double side)
        : this(side, side)
    {
    }

    public Square(double width, double height)
    {
        Width = width;
        Height = height;
    }

    public double Width { get; }

    public double Height { get; }

    public override double Area() => Width * Height;
}
