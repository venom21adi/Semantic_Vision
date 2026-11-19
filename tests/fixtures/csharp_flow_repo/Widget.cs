using System;
using System.Collections.Generic;

namespace Flow;

public class Widget
{
    private int _count;

    public int Trivial() => 1;

    public int SimpleBranch(int x)
    {
        if (x > 0)
        {
            return 1;
        }
        else
        {
            return -1;
        }
    }

    public int Loops(List<int> xs)
    {
        var total = 0;
        foreach (var x in xs)
        {
            for (var i = 0; i < x; i++)
            {
                total += i;
            }
        }

        return total;
    }

    public bool Logical(bool a, bool b, bool c) => (a && b) || c;

    public string Classify(int n)
    {
        switch (n)
        {
            case 0:
                return "zero";
            case 1:
            case 2:
                return "small";
            default:
                return "many";
        }
    }

    public int Guarded(string? s) => s?.Length ?? 0;

    public int Ternary(int a) => a > 0 ? a : -a;

    public void Catches()
    {
        try
        {
            Work();
        }
        catch (InvalidOperationException)
        {
            Work();
        }
    }

    public void BreaksAndContinues(List<int> xs)
    {
        foreach (var x in xs)
        {
            if (x < 0)
            {
                continue;
            }

            if (x > 100)
            {
                break;
            }

            Console.WriteLine(x);
        }
    }

    public void UsesUsing()
    {
        using (var sw = new System.IO.StringWriter())
        {
            sw.Write("x");
            Work();
        }
    }

    public void DoLoop()
    {
        var i = 0;
        do
        {
            i++;
        }
        while (i < 3);
    }

    public int Value
    {
        get { return _count; }
        set { _count = value; }
    }

    public int Computed => _count * 2;

    public static Widget operator +(Widget a, Widget b) => a;

    private void Work()
    {
    }

    public void Calls()
    {
        Work();
        Console.WriteLine("hi");
    }
}

public abstract class Base
{
    public abstract void Run();

    public virtual int Twice(int x) => x * 2;
}

public class Table<T>
{
    public void Add(T item)
    {
    }
}

public class Table<T, TId>
{
    public void Add(T item, TId id)
    {
    }
}
